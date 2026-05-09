export const API_BASE =
    process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

const TOKEN_KEY = "bizcontrol_token";

export function getToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
    localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
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
    const url = path.startsWith("http") ? path : `${API_BASE}${path}`;

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
        if (res.status === 401 && typeof window !== "undefined" && !url.includes("/api/auth/login")) {
            clearToken();
            window.location.href = "/login";
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
    amount: number;
    vat_amount: number;
    expense_date: string;
    receipt_url?: string;
    is_ai_parsed: boolean;
    created_at: string;
    updated_at: string;
}

export interface ExpenseSummary {
    total_expenses: number;
    total_vat: number;
    invoice_count: number;
}

export interface ExpenseCreate {
    title: string;
    supplier_name?: string;
    category?: string;
    invoice_number?: string;
    amount: number;
    vat_amount?: number;
    expense_date: string;
    is_ai_parsed?: boolean;
}

export interface InvoiceScanResult {
    business_name?: string;
    invoice_number?: string;
    total_amount?: number;
    vat_amount?: number;
    invoice_date?: string;
}

export function getExpenses(params?: { month?: number; year?: number }): Promise<Expense[]> {
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
