"use client";
import { toast } from "@/lib/toast";
import dynamic from "next/dynamic";

const DocumentScanner = dynamic(() => import("@/components/DocumentScanner"), { ssr: false });

import { useState, useEffect, useCallback } from "react";
import {
    getExpenses,
    getExpenseSummary,
    createExpense,
    deleteExpense,
    scanInvoice,
    markExpenseSent,
    markMonthSent,
    downloadExpenseExcel,
    Expense,
    ExpenseSummary,
    InvoiceScanResult,
    ExpenseCreate,
    getDashboardStats,
    DashboardStats,
    API_BASE,
} from "@/lib/api";
import GoalWidget from "@/components/GoalWidget";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    Legend,
} from "recharts";

const CATEGORIES = [
    "ציוד ומשרד",
    "שכר דירה",
    "שיווק ופרסום",
    "תוכנה ושירותים",
    "חשמל ומים",
    "רכב ותחבורה",
    "ספקים וחומרים",
    "אחר",
];

function fmt(n: number) {
    return n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Modal: Upload / AI Scan ───────────────────────────────────────────────────
function InvoiceUploadModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
    const [file, setFile] = useState<File | null>(null);
    const [scanResult, setScanResult] = useState<InvoiceScanResult | null>(null);
    const [scanning, setScanning] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [showScanner, setShowScanner] = useState(false);

    // Editable fields after AI scan
    const [title, setTitle] = useState("");
    const [amount, setAmount] = useState("");
    const [vat, setVat] = useState("");
    const [pretax, setPretax] = useState("");
    const [invoiceDate, setInvoiceDate] = useState("");
    const [invoiceNum, setInvoiceNum] = useState("");
    const [category, setCategory] = useState("");
    const [categoryOther, setCategoryOther] = useState("");
    const [paymentMethod, setPaymentMethod] = useState("");

    const handleScan = async () => {
        if (!file) return;
        setScanning(true);
        setError("");
        try {
            const res = await scanInvoice(file);
            setScanResult(res);
            setTitle(res.business_name || "");
            setAmount(res.total_amount != null ? String(res.total_amount) : "");
            setVat(res.vat_amount != null ? String(res.vat_amount) : "");
            setPretax((res as any).pretax_amount != null ? String((res as any).pretax_amount) : "");
            setInvoiceDate(res.invoice_date || "");
            setInvoiceNum(res.invoice_number || "");
            setPaymentMethod((res as any).payment_method || "");
        } catch (e: any) {
            setError(e.message || "שגיאה בסריקה");
        } finally {
            setScanning(false);
        }
    };

    const handleSave = async () => {
        if (!title || !amount || !invoiceDate) {
            setError("יש למלא: שם עסק/ספק, סכום, תאריך");
            return;
        }
        setSaving(true);
        try {
            const payload: ExpenseCreate = {
                title,
                supplier_name: title,
                invoice_number: invoiceNum || undefined,
                category: category || undefined,
                amount: parseFloat(amount),
                vat_amount: vat ? parseFloat(vat) : undefined,
                expense_date: invoiceDate,
                is_ai_parsed: !!scanResult,
            };
            await createExpense({
                ...payload,
                category: category === "אחר" && categoryOther ? `אחר: ${categoryOther}` : category || undefined,
            });
            onSaved();
            onClose();
        } catch (e: any) {
            setError(e.message || "שגיאה בשמירה");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
        {showScanner && (
            <DocumentScanner
                onCapture={(f) => { setFile(f); setShowScanner(false); }}
                onClose={() => setShowScanner(false)}
            />
        )}
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-panel" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>📄 סריקת חשבונית AI</h2>
                    <button className="close-btn" onClick={onClose}>✕</button>
                </div>

                {!scanResult ? (
                    <div className="upload-area">
                        {/* Hidden inputs */}
                        <input
                            id="invoice-file-input"
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/heic"
                            style={{ display: "none" }}
                            onChange={e => setFile(e.target.files?.[0] || null)}
                        />
                        <input
                            id="invoice-camera-input"
                            type="file"
                            accept="image/*"
                            capture="environment"
                            style={{ display: "none" }}
                            onChange={e => setFile(e.target.files?.[0] || null)}
                        />

                        {!file ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                                <button
                                    onClick={() => setShowScanner(true)}
                                    style={{ border: "2px dashed rgba(167,139,250,.5)", borderRadius: 14, padding: "2rem", textAlign: "center", background: "rgba(167,139,250,.05)", cursor: "pointer" }}
                                >
                                    <span style={{ fontSize: "2.5rem", display: "block", marginBottom: ".5rem" }}>📷</span>
                                    <div style={{ color: "#a78bfa", fontWeight: 700, fontSize: "1rem" }}>סריקת מסמך חכמה</div>
                                    <div style={{ color: "#94a3b8", fontSize: ".8rem", marginTop: ".3rem" }}>מצלמה עם שיפור תמונה אוטומטי</div>
                                </button>

                                <button
                                    onClick={() => document.getElementById("invoice-file-input")?.click()}
                                    style={{ border: "2px dashed rgba(96,165,250,.4)", borderRadius: 14, padding: "2rem", textAlign: "center", background: "rgba(96,165,250,.04)", cursor: "pointer" }}
                                >
                                    <span style={{ fontSize: "2.5rem", display: "block", marginBottom: ".5rem" }}>📁</span>
                                    <div style={{ color: "#60a5fa", fontWeight: 700, fontSize: "1rem" }}>העלאה מהגלריה / קבצים</div>
                                    <div style={{ color: "#94a3b8", fontSize: ".8rem", marginTop: ".3rem" }}>JPG, PNG, WEBP</div>
                                </button>
                            </div>
                        ) : (
                            <div>
                                <div style={{ border: "2px dashed rgba(74,222,128,.4)", borderRadius: 14, padding: "1.2rem", textAlign: "center", marginBottom: "1rem", background: "rgba(74,222,128,.04)" }}>
                                    <span style={{ fontSize: "1.8rem" }}>✅</span>
                                    <div style={{ color: "#4ade80", fontWeight: 600, marginTop: ".3rem" }}>{file.name}</div>
                                    <button onClick={() => setFile(null)} style={{ marginTop: ".5rem", background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: ".8rem" }}>החלף ✕</button>
                                </div>
                                <button className="btn-primary" onClick={handleScan} disabled={scanning} style={{ width: "100%" }}>
                                    {scanning ? "⏳ מנתח עם AI..." : "🔍 נתח עם AI"}
                                </button>
                            </div>
                        )}
                        {error && <p className="error-msg">{error}</p>}
                    </div>
                ) : (
                    <div className="scan-result">
                        <p className="scan-success">✅ AI הצליח לחלץ נתונים – אנא אשר / ערוך:</p>
                        <div className="form-grid">
                            <label>שם עסק / ספק
                                <input value={title} onChange={e => setTitle(e.target.value)} />
                            </label>
                            <label>מספר חשבונית
                                <input value={invoiceNum} onChange={e => setInvoiceNum(e.target.value)} />
                            </label>
                            <label>סכום כולל מע"מ (₪)
                                <input type="number" value={amount} onChange={e => setAmount(e.target.value)} />
                            </label>
                            <label>לפני מע"מ (₪)
                                <input type="number" value={pretax} onChange={e => setPretax(e.target.value)} readOnly style={{ opacity: 0.7 }} />
                            </label>
                            <label>מע"מ (₪)
                                <input type="number" value={vat} onChange={e => setVat(e.target.value)} />
                            </label>
                            <label>תאריך חשבונית
                                <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
                            </label>
                            {paymentMethod && (
                                <label>אמצעי תשלום
                                    <input value={paymentMethod} readOnly style={{ opacity: 0.7 }} />
                                </label>
                            )}
                            <label>קטגוריה
                                <select value={category} onChange={e => setCategory(e.target.value)}>
                                    <option value="">-- בחר קטגוריה --</option>
                                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </label>
                            {category === "אחר" && (
                                <label>פירוט קטגוריה
                                    <input
                                        value={categoryOther}
                                        onChange={e => setCategoryOther(e.target.value)}
                                        placeholder="לדוגמה: דלק, ציוד משרדי, חניה..."
                                    />
                                </label>
                            )}
                        </div>
                        {error && <p className="error-msg">{error}</p>}
                        <div className="modal-actions">
                            <button className="btn-secondary" onClick={() => setScanResult(null)}>חזור</button>
                            <button className="btn-primary" onClick={handleSave} disabled={saving}>
                                {saving ? "שומר..." : "💾 שמור הוצאה"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
        </div>
    );
}

// ── Modal: Manual Entry ────────────────────────────────────────────────────────
function ManualExpenseModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
    const [form, setForm] = useState<ExpenseCreate>({
        title: "",
        amount: 0,
        vat_amount: 0,
        expense_date: new Date().toISOString().split("T")[0],
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    const set = (k: keyof ExpenseCreate, v: any) => setForm(f => ({ ...f, [k]: v }));

    const handleSave = async () => {
        if (!form.title || !form.amount || !form.expense_date) {
            setError("שם/ספק, סכום ותאריך הם שדות חובה");
            return;
        }
        setSaving(true);
        try {
            await createExpense(form);
            onSaved();
            onClose();
        } catch (e: any) {
            setError(e.message || "שגיאה");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-panel" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>✏️ הזנת הוצאה ידנית</h2>
                    <button className="close-btn" onClick={onClose}>✕</button>
                </div>
                <div className="form-grid">
                    <label>שם עסק / ספק *
                        <input value={form.title} onChange={e => set("title", e.target.value)} placeholder="לדוגמה: חנות ציוד" />
                    </label>
                    <label>מספר חשבונית
                        <input value={form.invoice_number || ""} onChange={e => set("invoice_number", e.target.value)} />
                    </label>
                    <label>סכום כולל מע"מ (₪) *
                        <input type="number" step="0.01" min="0" value={form.amount || ""} onChange={e => set("amount", parseFloat(e.target.value))} />
                    </label>
                    <label>מע"מ (₪)
                        <input type="number" step="0.01" min="0" value={form.vat_amount || ""} onChange={e => set("vat_amount", parseFloat(e.target.value))} />
                    </label>
                    <label>תאריך *
                        <input type="date" value={form.expense_date} onChange={e => set("expense_date", e.target.value)} />
                    </label>
                    <label>קטגוריה
                        <select value={form.category || ""} onChange={e => set("category", e.target.value)}>
                            <option value="">-- בחר קטגוריה --</option>
                            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </label>
                </div>
                {error && <p className="error-msg">{error}</p>}
                <div className="modal-actions">
                    <button className="btn-secondary" onClick={onClose}>ביטול</button>
                    <button className="btn-primary" onClick={handleSave} disabled={saving}>
                        {saving ? "שומר..." : "💾 שמור"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Document Viewer Modal ─────────────────────────────────────────────────────
function ExpenseViewerModal({ expense, onClose, onUpdated }: { expense: Expense; onClose: () => void; onUpdated: () => void }) {
    const [sending, setSending] = useState(false);
    const imgUrl = expense.receipt_url ? `${API_BASE}${expense.receipt_url}` : null;

    const toggleSent = async () => {
        setSending(true);
        try {
            await markExpenseSent(expense.id, !expense.sent_to_accountant);
            onUpdated();
            onClose();
        } catch (e: any) { toast.error(e.message); }
        finally { setSending(false); }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-panel" style={{ maxWidth: 700 }} onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>📄 {expense.supplier_name || expense.title}</h2>
                    <button className="close-btn" onClick={onClose}>✕</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: imgUrl ? "1fr 1fr" : "1fr", gap: "1.5rem" }}>
                    {/* Receipt image */}
                    {imgUrl && (
                        <div>
                            <div style={{ color: "#94a3b8", fontSize: ".8rem", marginBottom: ".5rem" }}>תמונת קבלה מקורית</div>
                            <img src={imgUrl} alt="receipt" style={{ width: "100%", borderRadius: 12, border: "1px solid rgba(255,255,255,.1)" }} />
                            <a href={imgUrl} target="_blank" rel="noopener" style={{ display: "block", textAlign: "center", marginTop: ".5rem", color: "#a78bfa", fontSize: ".8rem" }}>
                                🔍 פתח בגודל מלא
                            </a>
                        </div>
                    )}
                    {/* Data */}
                    <div style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
                        {[
                            ["תאריך", new Date(expense.expense_date).toLocaleDateString("he-IL")],
                            ["ספק", expense.supplier_name || expense.title],
                            ["מספר מסמך", expense.invoice_number || "—"],
                            ["קטגוריה", expense.category || "—"],
                            ["אמצעי תשלום", expense.payment_method || "—"],
                            ["לפני מע\"מ", expense.pretax_amount ? `₪${fmt(expense.pretax_amount)}` : "—"],
                            ["מע\"מ", `₪${fmt(expense.vat_amount)}`],
                            ["סה\"כ כולל", `₪${fmt(expense.amount)}`],
                            ["הערות", expense.notes || "—"],
                        ].map(([label, val]) => (
                            <div key={label} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,.06)", paddingBottom: ".5rem" }}>
                                <span style={{ color: "#94a3b8", fontSize: ".85rem" }}>{label}</span>
                                <span style={{ color: "#e2e8f0", fontWeight: 600, fontSize: ".9rem" }}>{val}</span>
                            </div>
                        ))}
                        <div style={{ marginTop: ".5rem" }}>
                            {expense.sent_to_accountant ? (
                                <div style={{ background: "rgba(74,222,128,.1)", border: "1px solid rgba(74,222,128,.3)", borderRadius: 10, padding: ".75rem", textAlign: "center" }}>
                                    <div style={{ color: "#4ade80", fontWeight: 700 }}>✅ נשלח לרו"ח</div>
                                    {expense.sent_to_accountant_at && (
                                        <div style={{ color: "#64748b", fontSize: ".75rem" }}>{new Date(expense.sent_to_accountant_at).toLocaleDateString("he-IL")}</div>
                                    )}
                                </div>
                            ) : (
                                <div style={{ background: "rgba(251,191,36,.1)", border: "1px solid rgba(251,191,36,.3)", borderRadius: 10, padding: ".75rem", textAlign: "center" }}>
                                    <div style={{ color: "#fbbf24", fontWeight: 700 }}>⏳ טרם נשלח לרו"ח</div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <div className="modal-actions">
                    <button onClick={toggleSent} disabled={sending} style={{
                        background: expense.sent_to_accountant ? "rgba(251,191,36,.15)" : "rgba(74,222,128,.15)",
                        border: `1px solid ${expense.sent_to_accountant ? "rgba(251,191,36,.3)" : "rgba(74,222,128,.3)"}`,
                        color: expense.sent_to_accountant ? "#fbbf24" : "#4ade80",
                        borderRadius: 10, padding: ".6rem 1.2rem", cursor: "pointer", fontWeight: 600,
                    }}>
                        {sending ? "..." : expense.sent_to_accountant ? "↩️ בטל שליחה" : "✅ סמן נשלח לרו\"ח"}
                    </button>
                    <button className="btn-secondary" onClick={onClose}>סגור</button>
                </div>
            </div>
        </div>
    );
}

// ── Chart helpers ─────────────────────────────────────────────────────────────
const RADIAN = Math.PI / 180;
const PIE_COLORS = ["#7c3aed", "#3b82f6", "#10b981", "#f97316", "#f43f5e", "#f59e0b", "#14b8a6", "#64748b"];

function renderCustomizedLabel({
    cx, cy, midAngle, innerRadius, outerRadius, percent,
}: {
    cx: number; cy: number; midAngle: number;
    innerRadius: number; outerRadius: number; percent: number;
}) {
    if (percent < 0.05) return null;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    return (
        <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700}>
            {`${(percent * 100).toFixed(0)}%`}
        </text>
    );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ExpensesPage() {
    const now = new Date();
    const [month, setMonth] = useState(now.getMonth() + 1);
    const [year, setYear] = useState(now.getFullYear());
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [summary, setSummary] = useState<ExpenseSummary | null>(null);
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [modal, setModal] = useState<"scan" | "manual" | null>(null);
    const [viewExpense, setViewExpense] = useState<Expense | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [exp, sum, st] = await Promise.all([
                getExpenses({ month, year }),
                getExpenseSummary(month, year),
                getDashboardStats(month, year),
            ]);
            setExpenses(exp);
            setSummary(sum);
            setStats(st);
        } catch { } finally {
            setLoading(false);
        }
    }, [month, year]);

    useEffect(() => { load(); }, [load]);

    const handleDelete = async (id: string) => {
        if (!confirm("למחוק הוצאה זו?")) return;
        await deleteExpense(id);
        load();
    };

    const MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

    // Derived chart data
    const grossIncome = stats ? stats.financials.gross_income_cents / 100 : 0;
    const totalExpenses = summary ? summary.total_expenses : 0;

    const barData = [
        { name: "הכנסות vs הוצאות", הכנסות: grossIncome, הוצאות: totalExpenses },
    ];

    // Group expenses by category for pie chart
    const categoryMap: Record<string, number> = {};
    expenses.forEach(e => {
        const cat = e.category || "אחר";
        categoryMap[cat] = (categoryMap[cat] || 0) + e.amount;
    });
    const pieData = Object.entries(categoryMap).map(([name, value]) => ({ name, value }));

    return (
        <RequireAuth>
            <AppShell title="ניהול עסק">
                <div dir="rtl" style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'Segoe UI', Arial, sans-serif" }}>

                    {/* Modal CSS (kept unchanged for modals) */}
                    <style>{`
                        .btn-primary { background: linear-gradient(135deg, #7c3aed, #4c1d95); color:#fff; border:none; padding:0.7rem 1.4rem; border-radius:12px; font-size:0.95rem; font-weight:600; cursor:pointer; transition:all .2s; }
                        .btn-primary:hover { transform:translateY(-2px); box-shadow:0 8px 20px rgba(124,58,237,.5); }
                        .btn-primary:disabled { opacity:.5; cursor:default; transform:none; }
                        .btn-secondary { background:rgba(255,255,255,.1); color:#fff; border:1px solid rgba(255,255,255,.2); padding:0.7rem 1.4rem; border-radius:12px; font-size:0.95rem; cursor:pointer; transition:all .2s; }
                        .btn-secondary:hover { background:rgba(255,255,255,.2); }
                        .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,.7); backdrop-filter:blur(6px); display:flex; align-items:center; justify-content:center; z-index:1000; padding:1rem; }
                        .modal-panel { background:linear-gradient(145deg,#1e1b4b,#312e81); border:1px solid rgba(167,139,250,.3); border-radius:20px; width:100%; max-width:560px; padding:2rem; max-height:90vh; overflow-y:auto; }
                        .modal-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; }
                        .modal-header h2 { font-size:1.3rem; font-weight:700; color:#a78bfa; }
                        .close-btn { background:rgba(255,255,255,.1); border:none; color:#fff; width:32px; height:32px; border-radius:8px; cursor:pointer; font-size:1rem; }
                        .upload-area .btn-primary { width:100%; }
                        .scan-success { color:#4ade80; margin-bottom:1rem; font-size:.9rem; font-weight:600; }
                        .form-grid { display:grid; grid-template-columns:1fr 1fr; gap:1rem; }
                        .form-grid label { display:flex; flex-direction:column; gap:.4rem; font-size:.85rem; color:#94a3b8; font-weight:600; }
                        .form-grid input, .form-grid select { background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.15); border-radius:10px; padding:.65rem .9rem; color:#fff; font-size:.9rem; }
                        .form-grid input:focus, .form-grid select:focus { outline:none; border-color:#a78bfa; }
                        .form-grid select option { background:#1e1b4b; }
                        .modal-actions { display:flex; gap:1rem; justify-content:flex-end; margin-top:1.5rem; }
                        .error-msg { color:#f87171; font-size:.85rem; margin-top:.8rem; background:rgba(239,68,68,.1); padding:.6rem 1rem; border-radius:8px; }
                        @media(max-width:640px) { .form-grid { grid-template-columns:1fr; } }
                    `}</style>

                    {/* ── Hero Header ── */}
                    <div style={{
                        background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #1e1b4b 100%)",
                        padding: "2rem 2rem 2.5rem",
                        position: "relative",
                        overflow: "hidden",
                    }}>
                        {/* decorative blobs */}
                        <div style={{ position: "absolute", top: -60, left: -60, width: 220, height: 220, background: "radial-gradient(circle, rgba(124,58,237,0.25) 0%, transparent 70%)", borderRadius: "50%", pointerEvents: "none" }} />
                        <div style={{ position: "absolute", bottom: -40, right: 80, width: 160, height: 160, background: "radial-gradient(circle, rgba(59,130,246,0.2) 0%, transparent 70%)", borderRadius: "50%", pointerEvents: "none" }} />

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1.5rem", position: "relative", zIndex: 1 }}>
                            <div>
                                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.4rem" }}>
                                    <span style={{ fontSize: "1.8rem" }}>💼</span>
                                    <h1 style={{ fontSize: "2rem", fontWeight: 900, color: "#fff", margin: 0, letterSpacing: "-0.02em" }}>ניהול עסק</h1>
                                </div>
                                <p style={{ color: "#94a3b8", margin: 0, fontSize: "0.95rem" }}>מעקב הוצאות, מע&quot;מ וחשבוניות – בזמן אמת</p>
                            </div>
                            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                                <button
                                    onClick={() => downloadExpenseExcel(month, year)}
                                    style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.4)", color: "#34d399", padding: "0.65rem 1.25rem", borderRadius: "12px", fontWeight: 600, fontSize: "0.9rem", cursor: "pointer", backdropFilter: "blur(6px)" }}
                                >
                                    📊 Excel לרו&quot;ח
                                </button>
                                <button
                                    onClick={async () => {
                                        if (!confirm(`לסמן את כל הוצאות ${month}/${year} כ"נשלחו לרו"ח"?`)) return;
                                        await markMonthSent(month, year);
                                        load();
                                        toast.success("כל ההוצאות סומנו כנשלחו!");
                                    }}
                                    style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.4)", color: "#fbbf24", padding: "0.65rem 1.25rem", borderRadius: "12px", fontWeight: 600, fontSize: "0.9rem", cursor: "pointer", backdropFilter: "blur(6px)" }}
                                >
                                    ✅ סמן חודש נשלח
                                </button>
                                <button
                                    onClick={() => setModal("manual")}
                                    style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "#e2e8f0", padding: "0.65rem 1.25rem", borderRadius: "12px", fontWeight: 600, fontSize: "0.9rem", cursor: "pointer", backdropFilter: "blur(6px)" }}
                                >
                                    ✏️ הזנה ידנית
                                </button>
                                <button
                                    onClick={() => setModal("scan")}
                                    style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: "linear-gradient(135deg, #7c3aed, #4f46e5)", border: "none", color: "#fff", padding: "0.65rem 1.4rem", borderRadius: "12px", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer", boxShadow: "0 4px 15px rgba(124,58,237,0.4)" }}
                                >
                                    🤖 העלאת חשבונית AI
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* ── Page Body ── */}
                    <div style={{ padding: "2rem", maxWidth: 1280, margin: "0 auto" }}>

                        {/* ── Period Selector ── */}
                        <div style={{ background: "#fff", borderRadius: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e2e8f0", padding: "1.25rem 1.5rem", marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
                            <span style={{ color: "#475569", fontWeight: 700, fontSize: "0.9rem" }}>📅 תקופה:</span>
                            <select
                                value={month}
                                onChange={e => setMonth(Number(e.target.value))}
                                style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "0.5rem 1rem", fontSize: "0.9rem", color: "#1e293b", cursor: "pointer", fontWeight: 600 }}
                            >
                                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                            </select>
                            <select
                                value={year}
                                onChange={e => setYear(Number(e.target.value))}
                                style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "0.5rem 1rem", fontSize: "0.9rem", color: "#1e293b", cursor: "pointer", fontWeight: 600 }}
                            >
                                {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                            </select>
                            <span style={{ color: "#94a3b8", fontSize: "0.85rem", marginRight: "auto" }}>
                                {MONTHS[month - 1]} {year}
                            </span>
                        </div>

                        {/* ── Goal Widget ── */}
                        <div style={{ background: "#fff", borderRadius: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e2e8f0", padding: "1.25rem 1.5rem", marginBottom: "1.5rem" }}>
                            <GoalWidget month={month} year={year} />
                        </div>

                        {/* ── KPI Cards ── */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "1.25rem", marginBottom: "1.5rem" }}>
                            {/* Gross Income */}
                            <div style={{ background: "#fff", borderRadius: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e2e8f0", borderLeft: "4px solid #10b981", padding: "1.4rem 1.5rem" }}>
                                <div style={{ fontSize: "1.4rem", marginBottom: "0.5rem" }}>💰</div>
                                <div style={{ color: "#64748b", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>הכנסות ברוטו</div>
                                <div style={{ fontSize: "1.8rem", fontWeight: 900, color: "#10b981" }}>
                                    ₪{stats ? (stats.financials.gross_income_cents / 100).toLocaleString() : "—"}
                                </div>
                                <div style={{ color: "#94a3b8", fontSize: "0.75rem", marginTop: "0.3rem" }}>עסקאות שנסגרו</div>
                            </div>

                            {/* Net Income */}
                            <div style={{ background: "#fff", borderRadius: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e2e8f0", borderLeft: "4px solid #7c3aed", padding: "1.4rem 1.5rem" }}>
                                <div style={{ fontSize: "1.4rem", marginBottom: "0.5rem" }}>✨</div>
                                <div style={{ color: "#64748b", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>רווח נקי</div>
                                <div style={{ fontSize: "1.8rem", fontWeight: 900, color: "#7c3aed" }}>
                                    ₪{stats ? (stats.financials.net_income_cents / 100).toLocaleString() : "—"}
                                </div>
                                <div style={{ color: "#94a3b8", fontSize: "0.75rem", marginTop: "0.3rem" }}>אחרי כל המיסים</div>
                            </div>

                            {/* Taxes */}
                            <div style={{ background: "#fff", borderRadius: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e2e8f0", borderLeft: "4px solid #f59e0b", padding: "1.4rem 1.5rem" }}>
                                <div style={{ fontSize: "1.4rem", marginBottom: "0.5rem" }}>📉</div>
                                <div style={{ color: "#64748b", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>מיסים והפרשות</div>
                                <div style={{ fontSize: "1.8rem", fontWeight: 900, color: "#f59e0b" }}>
                                    ₪{stats ? ((stats.financials.vat_amount_cents + stats.financials.income_tax_cents + stats.financials.social_security_cents) / 100).toLocaleString() : "—"}
                                </div>
                                <div style={{ color: "#94a3b8", fontSize: "0.75rem", marginTop: "0.3rem" }}>מע&quot;מ + מס הכנסה + ביטוח לאומי</div>
                            </div>

                            {/* Total Expenses */}
                            <div style={{ background: "#fff", borderRadius: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e2e8f0", borderLeft: "4px solid #f43f5e", padding: "1.4rem 1.5rem" }}>
                                <div style={{ fontSize: "1.4rem", marginBottom: "0.5rem" }}>🛍️</div>
                                <div style={{ color: "#64748b", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>סך הוצאות</div>
                                <div style={{ fontSize: "1.8rem", fontWeight: 900, color: "#f43f5e" }}>
                                    ₪{summary ? fmt(summary.total_expenses) : "—"}
                                </div>
                                <div style={{ color: "#94a3b8", fontSize: "0.75rem", marginTop: "0.3rem" }}>
                                    {summary ? `${summary.invoice_count} חשבוניות` : "החודש"}
                                </div>
                            </div>
                        </div>

                        {/* ── Charts Row ── */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", marginBottom: "1.5rem" }}>

                            {/* Bar Chart */}
                            <div style={{ background: "#fff", borderRadius: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e2e8f0", padding: "1.5rem" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1.25rem" }}>
                                    <div style={{ width: 4, height: 20, background: "#3b82f6", borderRadius: 4 }} />
                                    <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "#1e293b" }}>הכנסות מול הוצאות</span>
                                </div>
                                <ResponsiveContainer width="100%" height={220}>
                                    <BarChart data={barData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#64748b" }} />
                                        <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(v: number) => `₪${(v / 1000).toFixed(0)}k`} />
                                        <Tooltip
                                            formatter={(value: number) => [`₪${value.toLocaleString()}`, ""]}
                                            contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 13 }}
                                        />
                                        <Bar dataKey="הכנסות" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                                        <Bar dataKey="הוצאות" fill="#f97316" radius={[6, 6, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Pie Chart */}
                            <div style={{ background: "#fff", borderRadius: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e2e8f0", padding: "1.5rem" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1.25rem" }}>
                                    <div style={{ width: 4, height: 20, background: "#7c3aed", borderRadius: 4 }} />
                                    <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "#1e293b" }}>הוצאות לפי קטגוריה</span>
                                </div>
                                {pieData.length === 0 ? (
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 220, color: "#94a3b8", fontSize: "0.9rem" }}>
                                        אין נתונים לתצוגה
                                    </div>
                                ) : (
                                    <ResponsiveContainer width="100%" height={220}>
                                        <PieChart>
                                            <Pie
                                                data={pieData}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={55}
                                                outerRadius={90}
                                                dataKey="value"
                                                labelLine={false}
                                                label={renderCustomizedLabel}
                                            >
                                                {pieData.map((_, index) => (
                                                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip
                                                formatter={(value: number) => [`₪${value.toLocaleString()}`, ""]}
                                                contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 13 }}
                                            />
                                            <Legend iconType="circle" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                )}
                            </div>
                        </div>

                        {/* ── Expense Table ── */}
                        <div style={{ background: "#fff", borderRadius: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e2e8f0", overflow: "hidden" }}>
                            <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                <div style={{ width: 4, height: 20, background: "#f43f5e", borderRadius: 4 }} />
                                <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "#1e293b" }}>רשימת הוצאות</span>
                                {summary && (
                                    <span style={{ marginRight: "auto", background: "#f8fafc", border: "1px solid #e2e8f0", color: "#64748b", borderRadius: "20px", padding: "0.2rem 0.75rem", fontSize: "0.78rem", fontWeight: 600 }}>
                                        {summary.invoice_count} רשומות
                                    </span>
                                )}
                            </div>

                            {loading ? (
                                <div style={{ textAlign: "center", padding: "4rem 1rem", color: "#94a3b8" }}>
                                    <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>⏳</div>
                                    <p style={{ fontWeight: 600 }}>טוען נתונים...</p>
                                </div>
                            ) : expenses.length === 0 ? (
                                <div style={{ textAlign: "center", padding: "4rem 1rem", color: "#94a3b8" }}>
                                    <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>📭</div>
                                    <p style={{ fontWeight: 600, color: "#64748b" }}>אין הוצאות לתקופה זו</p>
                                    <p style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>העלה חשבונית עם AI או הזן ידנית</p>
                                </div>
                            ) : (
                                <div style={{ overflowX: "auto" }}>
                                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                        <thead>
                                            <tr style={{ background: "#f8fafc" }}>
                                                {["ספק / שם", "קטגוריה", "מספר חשבונית", "תאריך", "סכום", 'מע"מ', "סטטוס", ""].map(h => (
                                                    <th key={h} style={{ padding: "0.85rem 1.2rem", textAlign: "right", fontSize: "0.75rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid #f1f5f9" }}>
                                                        {h}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {expenses.map((e, idx) => (
                                                <tr
                                                    key={e.id}
                                                    onClick={() => setViewExpense(e)}
                                                    style={{ cursor: "pointer", background: idx % 2 === 0 ? "#fff" : "#fafbfc", transition: "background 0.15s" }}
                                                    onMouseEnter={ev => (ev.currentTarget.style.background = "#f0f7ff")}
                                                    onMouseLeave={ev => (ev.currentTarget.style.background = idx % 2 === 0 ? "#fff" : "#fafbfc")}
                                                >
                                                    <td style={{ padding: "0.9rem 1.2rem", fontWeight: 600, color: "#1e293b", fontSize: "0.9rem", borderBottom: "1px solid #f1f5f9" }}>
                                                        {e.receipt_url && <span style={{ marginLeft: 4, color: "#94a3b8" }}>📎</span>}
                                                        {e.supplier_name || e.title}
                                                    </td>
                                                    <td style={{ padding: "0.9rem 1.2rem", borderBottom: "1px solid #f1f5f9" }}>
                                                        {e.category ? (
                                                            <span style={{ display: "inline-block", padding: "0.2rem 0.7rem", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 600, background: "rgba(124,58,237,0.08)", color: "#7c3aed", border: "1px solid rgba(124,58,237,0.15)" }}>
                                                                {e.category}
                                                            </span>
                                                        ) : (
                                                            <span style={{ color: "#cbd5e1" }}>—</span>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: "0.9rem 1.2rem", color: "#94a3b8", fontSize: "0.85rem", borderBottom: "1px solid #f1f5f9" }}>
                                                        {e.invoice_number || "—"}
                                                    </td>
                                                    <td style={{ padding: "0.9rem 1.2rem", color: "#64748b", fontSize: "0.85rem", borderBottom: "1px solid #f1f5f9" }}>
                                                        {new Date(e.expense_date).toLocaleDateString("he-IL")}
                                                    </td>
                                                    <td style={{ padding: "0.9rem 1.2rem", fontWeight: 700, color: "#7c3aed", fontSize: "0.95rem", borderBottom: "1px solid #f1f5f9" }}>
                                                        ₪{fmt(e.amount)}
                                                    </td>
                                                    <td style={{ padding: "0.9rem 1.2rem", color: "#3b82f6", fontSize: "0.9rem", borderBottom: "1px solid #f1f5f9" }}>
                                                        ₪{fmt(e.vat_amount)}
                                                    </td>
                                                    <td style={{ padding: "0.9rem 1.2rem", borderBottom: "1px solid #f1f5f9" }}>
                                                        {e.sent_to_accountant ? (
                                                            <span style={{ display: "inline-block", padding: "0.2rem 0.7rem", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 600, background: "rgba(16,185,129,0.08)", color: "#10b981", border: "1px solid rgba(16,185,129,0.2)" }}>
                                                                ✅ נשלח
                                                            </span>
                                                        ) : (
                                                            <span style={{ display: "inline-block", padding: "0.2rem 0.7rem", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 600, background: "rgba(245,158,11,0.08)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.2)" }}>
                                                                ⏳ ממתין
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: "0.9rem 1.2rem", borderBottom: "1px solid #f1f5f9" }} onClick={ev => ev.stopPropagation()}>
                                                        <button
                                                            onClick={() => handleDelete(e.id)}
                                                            style={{ background: "rgba(239,68,68,0.08)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)", padding: "0.35rem 0.75rem", borderRadius: "8px", fontSize: "0.8rem", cursor: "pointer", transition: "all 0.2s" }}
                                                            onMouseEnter={ev => { ev.currentTarget.style.background = "rgba(239,68,68,0.18)"; }}
                                                            onMouseLeave={ev => { ev.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
                                                        >
                                                            🗑️
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Modals */}
                    {modal === "scan" && <InvoiceUploadModal onClose={() => setModal(null)} onSaved={load} />}
                    {modal === "manual" && <ManualExpenseModal onClose={() => setModal(null)} onSaved={load} />}
                    {viewExpense && (
                        <ExpenseViewerModal
                            expense={viewExpense}
                            onClose={() => setViewExpense(null)}
                            onUpdated={() => { setViewExpense(null); load(); }}
                        />
                    )}
                </div>
            </AppShell>
        </RequireAuth>
    );
}
