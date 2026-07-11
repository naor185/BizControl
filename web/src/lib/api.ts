export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE || "").replace(/^http:\/\//, "https://");

const TOKEN_KEY = "bizcontrol_token";
const REFRESH_TOKEN_KEY = "bizcontrol_refresh_token";

export function getToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(TOKEN_KEY);
}

export function setToken(access: string, refresh?: string) {
    localStorage.setItem(TOKEN_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
}

export function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
}

// Single in-flight refresh promise — prevents race condition where multiple
// simultaneous 401s each try to refresh and only the first succeeds.
let _refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
    if (_refreshPromise) return _refreshPromise;
    const refresh = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refresh) return false;
    _refreshPromise = (async () => {
        try {
            const res = await fetch(`${API_BASE}/api/auth/refresh`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ refresh_token: refresh }),
            });
            if (!res.ok) return false;
            const data = await res.json();
            setToken(data.access_token, data.refresh_token);
            return true;
        } catch {
            return false;
        } finally {
            _refreshPromise = null;
        }
    })();
    return _refreshPromise;
}

export function getCurrentUserRole(): string | null {
    const token = getToken();
    if (!token) return null;
    try {
        const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        return payload.role || null;
    } catch {
        return null;
    }
}

type ApiOptions = RequestInit & { auth?: boolean };

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
    let url = path.startsWith("http") ? path : `${API_BASE}${path}`;
    if (url.startsWith("http://")) url = "https://" + url.slice(7);

    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");

    const hasBody = typeof options.body !== "undefined" && options.body !== null;
    if (hasBody && !(options.body instanceof FormData)) {
        if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    }

    if (options.auth !== false) {
        const token = getToken();
        if (token) headers.set("Authorization", `Bearer ${token}`);
    }

    const res = await fetch(url, { ...options, headers });
    const text = await res.text();
    const data = text ? safeJson(text) : null;

    if (!res.ok) {
        if (res.status === 401 && typeof window !== "undefined" && !url.includes("/api/auth/")) {
            const refreshed = await tryRefresh();
            if (refreshed) {
                // retry once with new token
                const newHeaders = new Headers(headers);
                newHeaders.set("Authorization", `Bearer ${getToken()}`);
                const retry = await fetch(url, { ...options, headers: newHeaders });
                if (retry.ok) {
                    const retryText = await retry.text();
                    return (retryText ? safeJson(retryText) : {}) as T;
                }
                // Retry also returned 401 — only NOW clear and redirect
            }
            // Don't redirect on background/non-critical endpoints — only on auth-critical ones
            const isCritical = url.includes("/api/auth/me") || url.includes("/api/auth/studio-info");
            if (isCritical) {
                clearToken();
                window.location.href = "/login";
                throw new Error("Session expired");
            }
            // For non-critical endpoints, just throw without clearing the token
            throw new Error("Session expired");
        }

        if (res.status === 402 && typeof window !== "undefined") {
            const detail = data?.detail || "";
            window.location.href = detail === "STUDIO_SUSPENDED"
                ? "/suspended?reason=suspended"
                : "/suspended?reason=expired";
            throw new Error("Plan expired");
        }

        const msg =
            (data && (data.detail || data.message)) ||
            text ||
            `HTTP ${res.status}`;
        throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }

    return (data ?? ({} as any)) as T;
}

function safeJson(text: string) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

// ─── Expense API Helpers ──────────────────────────────────────────────────────

export interface Expense {
    id: string;
    studio_id: string;
    title: string;
    supplier_name?: string;
    category?: string;
    invoice_number?: string;
    notes?: string;
    payment_method?: string;
    amount: number;
    vat_amount: number;
    pretax_amount?: number;
    expense_date: string;
    receipt_url?: string;
    file_size_bytes?: number;
    is_ai_parsed: boolean;
    sent_to_accountant: boolean;
    sent_to_accountant_at?: string;
    created_at: string;
    updated_at: string;
}

export interface ExpenseSummary {
    total_expenses: number;
    total_vat: number;
    invoice_count: number;
    unsent_count?: number;
}

export interface ExpenseCreate {
    title: string;
    supplier_name?: string;
    category?: string;
    invoice_number?: string;
    notes?: string;
    payment_method?: string;
    amount: number;
    vat_amount?: number;
    pretax_amount?: number;
    expense_date: string;
    receipt_url?: string;
    file_size_bytes?: number;
    is_ai_parsed?: boolean;
}

export interface InvoiceScanResult {
    business_name?: string;
    invoice_number?: string;
    total_amount?: number;
    vat_amount?: number;
    pretax_amount?: number;
    invoice_date?: string;
    payment_method?: string;
    receipt_url?: string;
    receipt_size_bytes?: number;
    ai_provider?: string;
}

export interface ExpenseStorageUsage {
    total_bytes: number;
    count: number;
    unknown_count: number;
}

export function markExpenseSent(id: string, sent: boolean): Promise<Expense> {
    return apiFetch<Expense>(`/api/expenses/${id}/${sent ? "mark-sent" : "unmark-sent"}`, { method: "POST" });
}

export function markMonthSent(month: number, year: number): Promise<void> {
    return apiFetch<void>(`/api/expenses/mark-month-sent?month=${month}&year=${year}`, { method: "POST" });
}

export function downloadExpenseExcel(month: number, year: number): void {
    const token = typeof window !== "undefined" ? localStorage.getItem("bizcontrol_token") : null;
    const url = `${API_BASE}/api/expenses/export/excel?month=${month}&year=${year}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses_${year}_${String(month).padStart(2, "0")}.xlsx`;
    // Add auth header via fetch+blob for Railway
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        .then(r => r.blob())
        .then(blob => {
            a.href = URL.createObjectURL(blob);
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });
}

export function getExpenses(params?: { month?: number; year?: number; limit?: number }): Promise<Expense[]> {
    const query = params
        ? "?" + new URLSearchParams(
            Object.entries(params)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => [k, String(v)])
          ).toString()
        : "";
    return apiFetch<Expense[]>(`/api/expenses${query}`);
}

export function getExpenseSummary(month: number, year: number): Promise<ExpenseSummary> {
    return apiFetch<ExpenseSummary>(`/api/expenses/summary?month=${month}&year=${year}`);
}

export function createExpense(data: ExpenseCreate): Promise<Expense> {
    return apiFetch<Expense>("/api/expenses", {
        method: "POST",
        body: JSON.stringify(data),
    });
}

export function deleteExpense(id: string): Promise<void> {
    return apiFetch<void>(`/api/expenses/${id}`, { method: "DELETE" });
}

export async function scanInvoice(file: File): Promise<InvoiceScanResult> {
    const formData = new FormData();
    formData.append("file", file);
    return apiFetch<InvoiceScanResult>("/api/expenses/scan", {
        method: "POST",
        body: formData,
    });
}

export async function uploadExpenseImage(expenseId: string, file: File): Promise<{ receipt_url: string }> {
    const formData = new FormData();
    formData.append("file", file);
    return apiFetch<{ receipt_url: string }>(`/api/expenses/${expenseId}/upload-image`, {
        method: "POST",
        body: formData,
    });
}

export function getExpenseStorageUsage(): Promise<ExpenseStorageUsage> {
    return apiFetch<ExpenseStorageUsage>("/api/expenses/storage/usage");
}

export function deleteExpenseReceiptImage(id: string): Promise<void> {
    return apiFetch<void>(`/api/expenses/${id}/receipt-image`, { method: "DELETE" });
}

// ─── Staff & Payroll API Helpers ─────────────────────────────────────────────

export interface WorkSession {
    id: string;
    user_id: string;
    start_time: string;
    end_time?: string;
    session_pay: number;
}

export interface ClockStatus {
    is_clocked_in: boolean;
    active_session?: WorkSession;
    pay_type: "hourly" | "commission" | "none" | "global";
}

export interface PayrollItem {
    user_id: string;
    display_name: string;
    pay_type: "hourly" | "commission" | "none";
    hourly_rate: number;
    commission_rate: number;
    total_hours: number;
    hourly_pay: number;
    commission_pay: number;
    total_pay: number;
}

export interface PayrollSummary {
    items: PayrollItem[];
    grand_total: number;
    period_start: string;
    period_end: string;
}

export function getClockStatus(): Promise<ClockStatus> {
    return apiFetch<ClockStatus>("/api/staff/clock-status");
}

export function clockIn(): Promise<WorkSession> {
    return apiFetch<WorkSession>("/api/staff/clock-in", { method: "POST" });
}

export function clockOut(): Promise<WorkSession> {
    return apiFetch<WorkSession>("/api/staff/clock-out", { method: "POST" });
}

export function getPayroll(startDate: string, endDate: string): Promise<PayrollSummary> {
    return apiFetch<PayrollSummary>(`/api/staff/payroll?start_date=${startDate}&end_date=${endDate}`);
}

// ─── Monthly Goals API Helpers ────────────────────────────────────────────────

export interface GoalProgress {
    year: number;
    month: number;
    target_amount: number;
    current_revenue: number;
    remaining_amount: number;
    progress_percentage: number;
    days_in_month: number;
    days_elapsed: number;
    days_remaining: number;
    required_daily_avg: number;
    current_daily_avg: number;
}

export function getGoalProgress(month?: number, year?: number): Promise<GoalProgress> {
    const params = new URLSearchParams();
    if (month) params.append("month", String(month));
    if (year) params.append("year", String(year));
    const query = params.toString() ? "?" + params.toString() : "";
    return apiFetch<GoalProgress>(`/api/goals/progress${query}`);
}

export function setMonthlyGoal(target: number, month: number, year: number): Promise<any> {
    return apiFetch(`/api/goals/?month=${month}&year=${year}`, {
        method: "POST",
        body: JSON.stringify({ target_amount: target }),
    });
}

// ─── Product Catalog API Helpers ──────────────────────────────────────────────

export interface Product {
    id: string;
    name: string;
    description?: string;
    price: number;
    category?: string;
    image_url?: string;
    stock_quantity: number;
    is_active: boolean;
    created_at: string;
}

export interface ProductSale {
    id: string;
    product_id: string;
    payment_id: string;
    user_id?: string;
    quantity: number;
    unit_price_cents: number;
    total_price_cents: number;
    created_at: string;
    product_name?: string;
    sold_by_name?: string;
}

export function getProducts(category?: string): Promise<Product[]> {
    const query = category ? `?category=${category}` : "";
    return apiFetch<Product[]>(`/api/products${query}`);
}

export function createProduct(data: Partial<Product>): Promise<Product> {
    return apiFetch<Product>("/api/products/", {
        method: "POST",
        body: JSON.stringify(data),
    });
}

export function updateProduct(id: string, data: Partial<Product>): Promise<Product> {
    return apiFetch<Product>(`/api/products/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
    });
}

export function deleteProduct(id: string): Promise<void> {
    return apiFetch<void>(`/api/products/${id}`, { method: "DELETE" });
}

export function updateProductStock(id: string, quantity: number): Promise<Product> {
    return apiFetch<Product>(`/api/products/${id}/stock?quantity=${quantity}`, {
        method: "PATCH",
    });
}

export function recordProductSale(productId: string, data: { quantity: number; unit_price_cents: number; total_price_cents: number; payment_id?: string; user_id?: string }): Promise<ProductSale> {
    return apiFetch<ProductSale>(`/api/products/${productId}/sell`, {
        method: "POST",
        body: JSON.stringify(data),
    });
}

export function getSalesHistory(): Promise<ProductSale[]> {
    return apiFetch<ProductSale[]>("/api/products/sales-history");
}

// ─── Export API Helpers ───────────────────────────────────────────────────────

export async function downloadAccountingExcel(startDate: string, endDate: string) {
    const token = getToken();
    const headers = new Headers();
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const res = await fetch(`${API_BASE}/api/exports/accounting?start_date=${startDate}&end_date=${endDate}`, {
        headers,
    });

    if (!res.ok) throw new Error("Export failed");

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Accounting_${startDate}_${endDate}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
}
async function _downloadFile(url: string, filename: string) {
    const token = getToken();
    const headers = new Headers();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error("Download failed");
    const blob = await res.blob();
    const link = document.createElement("a");
    link.href = window.URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
}

export function downloadReceipt(paymentId: string) {
    return _downloadFile(`${API_BASE}/api/payments/${paymentId}/receipt`, `receipt_${paymentId.slice(0, 8).toUpperCase()}.pdf`);
}

export function downloadInvoice(paymentId: string) {
    return _downloadFile(`${API_BASE}/api/payments/${paymentId}/invoice`, `invoice_${paymentId.slice(0, 8).toUpperCase()}.pdf`);
}

export function downloadPayrollPdf(startDate: string, endDate: string) {
    return _downloadFile(
        `${API_BASE}/api/staff/payroll/pdf?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`,
        `payroll_${startDate.slice(0, 10)}_${endDate.slice(0, 10)}.pdf`
    );
}

// ─── Dashboard & Financials API Helpers ─────────────────────────────────────

export interface DashboardStats {
    appointments_today: number;
    total_clients: number;
    total_club_members: number;
    total_revenue_cents: number;
    pending_messages: number;
    pending_payment_verifications: number;
    financials: {
        vat_amount_cents: number;
        income_tax_cents: number;
        social_security_cents: number;
        net_income_cents: number;
        gross_income_cents: number;
        vat_rate?: number;
    };
}

export function getDashboardStats(month?: number, year?: number): Promise<DashboardStats> {
    const params = new URLSearchParams();
    if (month) params.append("month", String(month));
    if (year) params.append("year", String(year));
    const query = params.toString() ? "?" + params.toString() : "";
    return apiFetch<DashboardStats>(`/api/dashboard/stats${query}`);
}
