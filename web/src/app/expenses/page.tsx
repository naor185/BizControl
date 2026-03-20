"use client";

import { useState, useEffect, useCallback } from "react";
import {
    getExpenses,
    getExpenseSummary,
    createExpense,
    deleteExpense,
    scanInvoice,
    downloadAccountingExcel,
    Expense,
    ExpenseSummary,
    InvoiceScanResult,
    ExpenseCreate,
    getDashboardStats,
    DashboardStats,
} from "@/lib/api";
import GoalWidget from "@/components/GoalWidget";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";

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

    // Editable fields after AI scan
    const [title, setTitle] = useState("");
    const [amount, setAmount] = useState("");
    const [vat, setVat] = useState("");
    const [invoiceDate, setInvoiceDate] = useState("");
    const [invoiceNum, setInvoiceNum] = useState("");
    const [category, setCategory] = useState("");

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
            setInvoiceDate(res.invoice_date || "");
            setInvoiceNum(res.invoice_number || "");
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
            await createExpense(payload);
            onSaved();
            onClose();
        } catch (e: any) {
            setError(e.message || "שגיאה בשמירה");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-panel" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>📄 סריקת חשבונית AI</h2>
                    <button className="close-btn" onClick={onClose}>✕</button>
                </div>

                {!scanResult ? (
                    <div className="upload-area">
                        <div
                            className="drop-zone"
                            onClick={() => document.getElementById("invoice-file-input")?.click()}
                        >
                            <span className="drop-icon">🧾</span>
                            <p>{file ? file.name : "לחץ להעלאת תמונה (JPG / PNG / WEBP)"}</p>
                            <input
                                id="invoice-file-input"
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                style={{ display: "none" }}
                                onChange={e => setFile(e.target.files?.[0] || null)}
                            />
                        </div>
                        {file && (
                            <button className="btn-primary" onClick={handleScan} disabled={scanning}>
                                {scanning ? "⏳ מנתח עם AI..." : "🔍 סרוק עם AI"}
                            </button>
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
                            <label>סכום כולל (₪)
                                <input type="number" value={amount} onChange={e => setAmount(e.target.value)} />
                            </label>
                            <label>מע"מ (₪)
                                <input type="number" value={vat} onChange={e => setVat(e.target.value)} />
                            </label>
                            <label>תאריך חשבונית
                                <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
                            </label>
                            <label>קטגוריה
                                <select value={category} onChange={e => setCategory(e.target.value)}>
                                    <option value="">-- בחר קטגוריה --</option>
                                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </label>
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

    return (
        <RequireAuth>
            <AppShell title="ניהול עסק">
                <div className="expenses-page" dir="rtl">
            <style>{`
                .expenses-page { 
                    min-height: 100vh; 
                    background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
                    padding: 2rem;
                    font-family: 'Segoe UI', 'Arial', sans-serif;
                    color: #fff;
                }
                .page-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:2rem; flex-wrap:wrap; gap:1rem; }
                .page-title { font-size:2rem; font-weight:800; background: linear-gradient(135deg, #a78bfa, #60a5fa); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
                .page-subtitle { color:#94a3b8; font-size:0.9rem; margin-top:0.3rem; }
                .header-actions { display:flex; gap:1rem; flex-wrap:wrap; }
                .btn-primary { background: linear-gradient(135deg, #7c3aed, #4c1d95); color:#fff; border:none; padding:0.7rem 1.4rem; border-radius:12px; font-size:0.95rem; font-weight:600; cursor:pointer; transition:all .2s; }
                .btn-primary:hover { transform:translateY(-2px); box-shadow:0 8px 20px rgba(124,58,237,.5); }
                .btn-primary:disabled { opacity:.5; cursor:default; transform:none; }
                .btn-secondary { background:rgba(255,255,255,.1); color:#fff; border:1px solid rgba(255,255,255,.2); padding:0.7rem 1.4rem; border-radius:12px; font-size:0.95rem; cursor:pointer; transition:all .2s; }
                .btn-secondary:hover { background:rgba(255,255,255,.2); }

                /* Date filter */
                .date-filter { display:flex; gap:1rem; margin-bottom:2rem; align-items:center; flex-wrap:wrap; }
                .date-filter select { background:rgba(255,255,255,.1); color:#fff; border:1px solid rgba(255,255,255,.2); padding:0.6rem 1rem; border-radius:10px; font-size:0.9rem; cursor:pointer; }
                .date-filter select option { background:#302b63; color:#fff; }

                /* Summary cards */
                .summary-cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:1.5rem; margin-bottom:2rem; }
                .summary-card { background:rgba(255,255,255,.07); backdrop-filter:blur(10px); border:1px solid rgba(255,255,255,.1); border-radius:16px; padding:1.5rem; text-align:center; transition:all .3s; }
                .summary-card:hover { transform:translateY(-3px); border-color:rgba(167,139,250,.4); box-shadow:0 10px 30px rgba(124,58,237,.2); }
                .card-icon { font-size:2rem; margin-bottom:.6rem; }
                .card-label { color:#94a3b8; font-size:0.85rem; margin-bottom:.4rem; }
                .card-value { font-size:1.8rem; font-weight:800; background: linear-gradient(135deg, #a78bfa, #60a5fa); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
                .card-sub { color:#64748b; font-size:0.75rem; margin-top:.3rem; }
                .section-title { font-size: 1.2rem; font-weight: 700; color: #a78bfa; margin: 2rem 0 1rem; border-right: 3px solid #7c3aed; padding-right: 0.8rem; }
                .highlight-card { background: linear-gradient(135deg, #7c3aed, #4f46e5); }
                .highlight-card .card-label { color: rgba(255,255,255,0.8); }
                .highlight-card .card-value { background: none; -webkit-text-fill-color: #fff; }
                .mb-8 { margin-bottom: 2rem; }

                /* Expense table */
                .expense-table-wrap { background:rgba(255,255,255,.05); border-radius:16px; border:1px solid rgba(255,255,255,.1); overflow:hidden; }
                .table-title { padding:1.2rem 1.5rem; border-bottom:1px solid rgba(255,255,255,.08); font-weight:700; font-size:1.1rem; color:#a78bfa; }
                table { width:100%; border-collapse:collapse; }
                th { background:rgba(255,255,255,.05); padding:.9rem 1.2rem; text-align:right; font-size:.8rem; color:#94a3b8; font-weight:600; text-transform:uppercase; letter-spacing:.05em; }
                td { padding:.9rem 1.2rem; border-bottom:1px solid rgba(255,255,255,.05); font-size:.9rem; }
                tr:last-child td { border-bottom:none; }
                tr:hover td { background:rgba(255,255,255,.03); }
                .badge { display:inline-block; padding:.25rem .7rem; border-radius:20px; font-size:.75rem; font-weight:600; background:rgba(167,139,250,.15); color:#a78bfa; }
                .ai-badge { background:rgba(96,165,250,.15); color:#60a5fa; }
                .delete-btn { background:rgba(239,68,68,.15); color:#f87171; border:1px solid rgba(239,68,68,.3); padding:.35rem .8rem; border-radius:8px; font-size:.8rem; cursor:pointer; transition:all .2s; }
                .delete-btn:hover { background:rgba(239,68,68,.3); }
                .empty-state { text-align:center; padding:4rem 1rem; color:#64748b; }
                .empty-icon { font-size:3rem; margin-bottom:1rem; }

                /* Modal */
                .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,.7); backdrop-filter:blur(6px); display:flex; align-items:center; justify-content:center; z-index:1000; padding:1rem; }
                .modal-panel { background:linear-gradient(145deg,#1e1b4b,#312e81); border:1px solid rgba(167,139,250,.3); border-radius:20px; width:100%; max-width:560px; padding:2rem; max-height:90vh; overflow-y:auto; }
                .modal-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; }
                .modal-header h2 { font-size:1.3rem; font-weight:700; color:#a78bfa; }
                .close-btn { background:rgba(255,255,255,.1); border:none; color:#fff; width:32px; height:32px; border-radius:8px; cursor:pointer; font-size:1rem; }
                .drop-zone { border:2px dashed rgba(167,139,250,.4); border-radius:14px; padding:2.5rem; text-align:center; cursor:pointer; transition:all .2s; margin-bottom:1.5rem; }
                .drop-zone:hover { border-color:#a78bfa; background:rgba(167,139,250,.05); }
                .drop-icon { font-size:2.5rem; display:block; margin-bottom:.7rem; }
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

            {/* Header */}
            <div className="page-header">
                <div>
                    <h1 className="page-title">💼 ניהול עסק</h1>
                    <p className="page-subtitle">מעקב הוצאות, מע"מ וחשבוניות – בזמן אמת</p>
                </div>
                <div className="header-actions">
                    <button 
                        className="btn-secondary" 
                        style={{ background: 'rgba(52, 211, 153, 0.1)', borderColor: 'rgba(52, 211, 153, 0.3)', color: '#34d399' }}
                        onClick={async () => {
                            const lastDay = new Date(year, month, 0).getDate();
                            const start = `${year}-${String(month).padStart(2, '0')}-01T00:00:00`;
                            const end = `${year}-${String(month).padStart(2, '0')}-${lastDay}T23:59:59`;
                            try {
                                await downloadAccountingExcel(start, end);
                            } catch (err) {
                                alert("שגיאה בייצוא קובץ");
                            }
                        }}
                    >
                        📄 ייצוא לרואה חשבון
                    </button>
                    <button className="btn-secondary" onClick={() => setModal("manual")}>✏️ הזנה ידנית</button>
                    <button className="btn-primary" onClick={() => setModal("scan")}>🤖 העלאת חשבונית AI</button>
                </div>
            </div>

            {/* Month/Year Filter */}
            <div className="date-filter">
                <span style={{ color: "#94a3b8", fontWeight: 600 }}>תקופה:</span>
                <select value={month} onChange={e => setMonth(Number(e.target.value))}>
                    {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
                <select value={year} onChange={e => setYear(Number(e.target.value))}>
                    {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
            </div>

            {/* Revenue Goal */}
            <div className="mb-8">
                <GoalWidget month={month} year={year} />
            </div>

            {/* Advanced Financial Summary (Income Side) */}
            <h2 className="section-title">📊 סיכום הכנסות ומיסים</h2>
            <div className="summary-cards mb-8">
                 <div className="summary-card" style={{ borderLeft: '4px solid #10b981' }}>
                    <div className="card-icon">💸</div>
                    <div className="card-label">סה״כ הכנסות (ברוטו)</div>
                    <div className="card-value">₪{stats ? (stats.financials.gross_income_cents / 100).toLocaleString() : "—"}</div>
                    <div className="card-sub">עסקאות שנסגרו</div>
                </div>
                <div className="summary-card" style={{ borderLeft: '4px solid #f59e0b' }}>
                    <div className="card-icon">📉</div>
                    <div className="card-label">מע״מ והפרשות (לדיווח)</div>
                    <div className="card-value">₪{stats ? ((stats.financials.vat_amount_cents + stats.financials.income_tax_cents + stats.financials.social_security_cents) / 100).toLocaleString() : "—"}</div>
                    <div className="card-sub">כולל מס הכנסה וביטוח לאומי</div>
                </div>
                <div className="summary-card highlight-card">
                    <div className="card-icon">✨</div>
                    <div className="card-label">רווח נקי משוער (בכיס)</div>
                    <div className="card-value" style={{ color: '#fff' }}>₪{stats ? (stats.financials.net_income_cents / 100).toLocaleString() : "—"}</div>
                    <div className="card-sub" style={{ color: 'rgba(255,255,255,0.7)' }}>אחרי כל המיסים</div>
                </div>
            </div>

            {/* Expenses Summary (Expense Side) */}
            <h2 className="section-title">🧾 סיכום הוצאות</h2>
            <div className="summary-cards mb-8">
                <div className="summary-card">
                    <div className="card-icon">🛍️</div>
                    <div className="card-label">סך הוצאות</div>
                    <div className="card-value">₪{summary ? fmt(summary.total_expenses) : "—"}</div>
                    <div className="card-sub">החודש</div>
                </div>
                <div className="summary-card">
                    <div className="card-icon">🛡️</div>
                    <div className="card-label">מע"מ מוכר (החזר)</div>
                    <div className="card-value">₪{summary ? fmt(summary.total_vat) : "—"}</div>
                    <div className="card-sub">מתוך {summary ? summary.invoice_count : "0"} חשבוניות</div>
                </div>
                <div className="summary-card">
                    <div className="card-icon">📊</div>
                    <div className="card-label">מס הכנסה להפרשה</div>
                    <div className="card-value">₪{stats ? (stats.financials.income_tax_cents / 100).toLocaleString() : "—"}</div>
                    <div className="card-sub">לפי {stats?.financials.vat_rate?.toFixed(1) || "18"}% מע"מ</div>
                </div>
            </div>

            {/* Expense Table */}
            <div className="expense-table-wrap">
                <div className="table-title">רשימת הוצאות</div>
                {loading ? (
                    <div className="empty-state"><div className="empty-icon">⏳</div><p>טוען נתונים...</p></div>
                ) : expenses.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-icon">📭</div>
                        <p>אין הוצאות לתקופה זו</p>
                        <p style={{ fontSize: ".85rem", marginTop: ".5rem" }}>העלה חשבונית עם AI או הזן ידנית</p>
                    </div>
                ) : (
                    <table>
                        <thead>
                            <tr>
                                <th>ספק / שם</th>
                                <th>קטגוריה</th>
                                <th>מספר חשבונית</th>
                                <th>תאריך</th>
                                <th>סכום</th>
                                <th>מע"מ</th>
                                <th>מקור</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {expenses.map(e => (
                                <tr key={e.id}>
                                    <td style={{ fontWeight: 600 }}>{e.title}</td>
                                    <td>{e.category ? <span className="badge">{e.category}</span> : <span style={{ color: "#4b5563" }}>—</span>}</td>
                                    <td style={{ color: "#94a3b8", fontSize: ".85rem" }}>{e.invoice_number || "—"}</td>
                                    <td style={{ color: "#94a3b8" }}>{new Date(e.expense_date).toLocaleDateString("he-IL")}</td>
                                    <td style={{ fontWeight: 700, color: "#a78bfa" }}>₪{fmt(e.amount)}</td>
                                    <td style={{ color: "#60a5fa" }}>₪{fmt(e.vat_amount)}</td>
                                    <td>
                                        {e.is_ai_parsed
                                            ? <span className="badge ai-badge">🤖 AI</span>
                                            : <span className="badge">✏️ ידני</span>
                                        }
                                    </td>
                                    <td>
                                        <button className="delete-btn" onClick={() => handleDelete(e.id)}>🗑️</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Modals */}
            {modal === "scan" && <InvoiceUploadModal onClose={() => setModal(null)} onSaved={load} />}
            {modal === "manual" && <ManualExpenseModal onClose={() => setModal(null)} onSaved={load} />}
                </div>
            </AppShell>
        </RequireAuth>
    );
}
