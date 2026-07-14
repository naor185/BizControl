"use client";
import { toast } from "@/lib/toast";
import dynamic from "next/dynamic";

const DocumentScanner = dynamic(() => import("@/components/DocumentScanner"), { ssr: false });

import { useState, useEffect, useCallback, useRef } from "react";
import {
    getExpenses,
    getExpenseSummary,
    createExpense,
    deleteExpense,
    scanInvoice,
    markExpenseSent,
    markMonthSent,
    downloadExpenseExcel,
    uploadExpenseImage,
    getExpenseStorageUsage,
    deleteExpenseReceiptImage,
    sendExpensesToAccountant,
    checkDuplicateExpense,
    downloadExpenseReceiptsZip,
    Expense,
    ExpenseSummary,
    InvoiceScanResult,
    ExpenseCreate,
    ExpenseStorageUsage,
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

function receiptImgUrl(url: string | undefined): string | null {
    if (!url) return null;
    if (url.startsWith("http")) return url;
    return `${API_BASE}${url}`;
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
        try {
            const dup = await checkDuplicateExpense(title, invoiceDate, parseFloat(amount));
            if (dup.is_duplicate && !confirm("קבלה עם אותו ספק, תאריך וסכום כבר קיימת במערכת. לשמור בכל זאת?")) {
                return;
            }
        } catch { /* duplicate check is advisory — never block saving if it fails */ }
        setSaving(true);
        try {
            await createExpense({
                title,
                supplier_name: title,
                invoice_number: invoiceNum || undefined,
                category: category === "אחר" && categoryOther ? `אחר: ${categoryOther}` : category || undefined,
                amount: parseFloat(amount),
                vat_amount: vat ? parseFloat(vat) : undefined,
                pretax_amount: pretax ? parseFloat(pretax) : undefined,
                payment_method: paymentMethod || undefined,
                expense_date: invoiceDate,
                receipt_url: scanResult?.receipt_url || undefined,
                file_size_bytes: scanResult?.receipt_size_bytes || undefined,
                is_ai_parsed: !!scanResult,
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
                        {scanResult?.ai_provider && (
                            <p style={{ color: "#64748b", fontSize: "0.72rem", marginTop: "-0.6rem", marginBottom: "0.8rem" }}>
                                מקור זיהוי: {scanResult.ai_provider}
                            </p>
                        )}
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
                            <label>אמצעי תשלום
                                <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                                    <option value="">-- לא צוין --</option>
                                    <option value="אשראי">כרטיס אשראי</option>
                                    <option value="מזומן">מזומן</option>
                                    <option value="ביט/פייבוקס">Bit / PayBox</option>
                                    <option value="העברה בנקאית">העברה בנקאית</option>
                                    <option value="צ'ק">צ&apos;ק</option>
                                    <option value="אחר">אחר</option>
                                </select>
                            </label>
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
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    const set = (k: keyof ExpenseCreate, v: any) => setForm(f => ({ ...f, [k]: v }));

    const handleImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setImageFile(f);
        setImagePreview(URL.createObjectURL(f));
    };

    const handleSave = async () => {
        if (!form.title || !form.amount || !form.expense_date) {
            setError("שם/ספק, סכום ותאריך הם שדות חובה");
            return;
        }
        try {
            const dup = await checkDuplicateExpense(form.supplier_name || form.title, form.expense_date, form.amount);
            if (dup.is_duplicate && !confirm("קבלה עם אותו ספק, תאריך וסכום כבר קיימת במערכת. לשמור בכל זאת?")) {
                return;
            }
        } catch { /* duplicate check is advisory — never block saving if it fails */ }
        setSaving(true);
        try {
            const saved = await createExpense(form);
            if (imageFile && (saved as any)?.id) {
                try {
                    await uploadExpenseImage((saved as any).id, imageFile);
                } catch { /* image upload failure doesn't block the save */ }
            }
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
                    <label>סכום כולל מע&quot;מ (₪) *
                        <input type="number" step="0.01" min="0" value={form.amount || ""} onChange={e => set("amount", parseFloat(e.target.value))} />
                    </label>
                    <label>מע&quot;מ (₪)
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
                    <label>אמצעי תשלום
                        <select value={form.payment_method || ""} onChange={e => set("payment_method", e.target.value)}>
                            <option value="">-- לא צוין --</option>
                            <option value="אשראי">כרטיס אשראי</option>
                            <option value="מזומן">מזומן</option>
                            <option value="ביט/פייבוקס">Bit / PayBox</option>
                            <option value="העברה בנקאית">העברה בנקאית</option>
                            <option value="צ'ק">צ&apos;ק</option>
                            <option value="אחר">אחר</option>
                        </select>
                    </label>
                    <label>צרף תמונת קבלה
                        <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/heic"
                            capture="environment"
                            onChange={handleImagePick}
                            style={{ fontSize: ".82rem", padding: ".4rem 0" }}
                        />
                    </label>
                </div>
                {imagePreview && (
                    <div style={{ marginTop: ".75rem", textAlign: "center" }}>
                        <img src={imagePreview} alt="preview" style={{ maxHeight: 140, borderRadius: 10, border: "1px solid rgba(255,255,255,.15)" }} />
                        <button type="button" onClick={() => { setImageFile(null); setImagePreview(null); }}
                            style={{ display: "block", margin: ".3rem auto 0", background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: ".78rem" }}>
                            הסר תמונה ✕
                        </button>
                    </div>
                )}
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

// ── Storage Usage Modal ────────────────────────────────────────────────────────
function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function StorageUsageModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
    const [usage, setUsage] = useState<ExpenseStorageUsage | null>(null);
    const [receipts, setReceipts] = useState<Expense[]>([]);
    const [loading, setLoading] = useState(true);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [u, all] = await Promise.all([
                getExpenseStorageUsage(),
                getExpenses({ limit: 500 }),
            ]);
            setUsage(u);
            setReceipts(
                all
                    .filter(e => e.receipt_url)
                    .sort((a, b) => a.expense_date.localeCompare(b.expense_date))
            );
        } catch { } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleDeleteImage = async (id: string) => {
        if (!confirm("למחוק את תמונת הקבלה? רשומת ההוצאה עצמה תישאר.")) return;
        setDeletingId(id);
        try {
            await deleteExpenseReceiptImage(id);
            await load();
            onChanged();
        } catch (e: any) {
            toast.error(e.message || "שגיאה במחיקת התמונה");
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-panel" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
                <div className="modal-header">
                    <h2>💾 ניהול אחסון</h2>
                    <button className="close-btn" onClick={onClose}>✕</button>
                </div>

                {loading ? (
                    <p style={{ color: "#94a3b8" }}>טוען...</p>
                ) : (
                    <>
                        <div style={{ background: "rgba(167,139,250,.08)", border: "1px solid rgba(167,139,250,.25)", borderRadius: 12, padding: "1rem 1.25rem", marginBottom: "1.25rem" }}>
                            <div style={{ color: "#a78bfa", fontSize: "1.4rem", fontWeight: 700 }}>
                                {usage ? formatBytes(usage.total_bytes) : "—"}
                            </div>
                            <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginTop: ".2rem" }}>
                                בשימוש על ידי {usage?.count ?? 0} תמונות קבלה
                                {usage && usage.unknown_count > 0 ? ` (מחשב נפח עבור ${usage.unknown_count} קבצים ישנים...)` : ""}
                            </div>
                        </div>

                        <div style={{ background: "rgba(74,222,128,.08)", border: "1px solid rgba(74,222,128,.25)", borderRadius: 12, padding: "1rem 1.25rem", marginBottom: "1.25rem" }}>
                            <div style={{ color: "#4ade80", fontSize: "1.1rem", fontWeight: 700 }}>
                                {usage && usage.scan_quota > 0
                                    ? `נותרו ${usage.scan_remaining ?? 0} מתוך ${usage.scan_quota} סריקות החודש`
                                    : "סריקות AI ללא הגבלה החודש"}
                            </div>
                        </div>

                        {receipts.length === 0 ? (
                            <p style={{ color: "#94a3b8", fontSize: "0.9rem" }}>אין תמונות קבלה שמורות.</p>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", maxHeight: "50vh", overflowY: "auto" }}>
                                {receipts.map(e => (
                                    <div key={e.id} style={{ display: "flex", alignItems: "center", gap: "0.75rem", background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, padding: "0.6rem 0.75rem" }}>
                                        {receiptImgUrl(e.receipt_url) && (
                                            <img src={receiptImgUrl(e.receipt_url)!} alt="receipt" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />
                                        )}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ color: "#fff", fontSize: "0.85rem", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                {e.supplier_name || e.title}
                                            </div>
                                            <div style={{ color: "#94a3b8", fontSize: "0.75rem" }}>
                                                {new Date(e.expense_date).toLocaleDateString("he-IL")}
                                                {e.file_size_bytes ? ` · ${formatBytes(e.file_size_bytes)}` : ""}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleDeleteImage(e.id)}
                                            disabled={deletingId === e.id}
                                            style={{ background: "rgba(239,68,68,.1)", color: "#f87171", border: "none", borderRadius: 8, padding: "0.4rem 0.7rem", fontSize: "0.75rem", cursor: "pointer", fontWeight: 600, flexShrink: 0 }}
                                        >
                                            {deletingId === e.id ? "מוחק..." : "🗑️ מחק תמונה"}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}

                <div className="modal-actions">
                    <button className="btn-secondary" onClick={onClose}>סגור</button>
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

    const shareWhatsApp = (phone?: string) => {
        const text = [
            `📄 קבלה/חשבונית — ${expense.supplier_name || expense.title}`,
            `תאריך: ${new Date(expense.expense_date).toLocaleDateString("he-IL")}`,
            `סכום: ₪${fmt(expense.amount)}`,
            expense.payment_method ? `אמצעי תשלום: ${expense.payment_method}` : "",
            imgUrl ? `\nתמונת קבלה:\n${imgUrl}` : "",
        ].filter(Boolean).join("\n");
        const url = phone
            ? `https://wa.me/972${phone.replace(/^0/, "")}?text=${encodeURIComponent(text)}`
            : `https://wa.me/?text=${encodeURIComponent(text)}`;
        window.open(url, "_blank");
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
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1rem" }}>
                    {imgUrl && (
                        <>
                            <button
                                type="button"
                                onClick={() => shareWhatsApp()}
                                style={{ background: "rgba(37,211,102,.15)", border: "1px solid rgba(37,211,102,.4)", color: "#25d366", borderRadius: 10, padding: ".6rem 1rem", cursor: "pointer", fontWeight: 600, fontSize: ".85rem" }}
                            >
                                💬 שלח בוואטסאפ
                            </button>
                            <a
                                href={imgUrl}
                                download
                                style={{ background: "rgba(99,102,241,.12)", border: "1px solid rgba(99,102,241,.3)", color: "#818cf8", borderRadius: 10, padding: ".6rem 1rem", cursor: "pointer", fontWeight: 600, fontSize: ".85rem", textDecoration: "none" }}
                            >
                                ⬇️ הורד תמונה
                            </a>
                        </>
                    )}
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
const PIE_COLORS = ["#00b4b4", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#10b981", "#06b6d4", "#64748b"];

function renderCustomizedLabel({
    cx, cy, midAngle, innerRadius, outerRadius, percent,
}: {
    cx: number; cy: number; midAngle: number;
    innerRadius: number; outerRadius: number; percent: number;
}) {
    if (percent < 0.05) return null;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.6;
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
    const [modal, setModal] = useState<"scan" | "manual" | "storage" | null>(null);
    const [viewExpense, setViewExpense] = useState<Expense | null>(null);
    const [sendingToAccountant, setSendingToAccountant] = useState(false);
    const [downloadingZip, setDownloadingZip] = useState(false);

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

    const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);
    const [uploadingId, setUploadingId] = useState<string | null>(null);
    const inlineUploadRef = useRef<HTMLInputElement>(null);

    const handleInlineCameraClick = (expenseId: string, ev: React.MouseEvent) => {
        ev.stopPropagation();
        setUploadTargetId(expenseId);
        inlineUploadRef.current?.click();
    };

    const handleInlineFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (!f || !uploadTargetId) return;
        setUploadingId(uploadTargetId);
        try {
            await uploadExpenseImage(uploadTargetId, f);
            load();
        } catch (err: any) {
            toast.error(err.message || "שגיאה בהעלאת תמונה");
        } finally {
            setUploadingId(null);
            setUploadTargetId(null);
            e.target.value = "";
        }
    };

    const MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

    // Derived chart data
    const grossIncome = stats ? stats.financials.gross_income_cents / 100 : 0;
    const totalExpenses = summary ? summary.total_expenses : 0;
    const netIncome = stats ? stats.financials.net_income_cents / 100 : 0;

    const barData = [
        { name: "הכנסות", value: grossIncome },
        { name: "הוצאות", value: totalExpenses },
        { name: "רווח נקי", value: netIncome },
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
                <div dir="rtl" style={{ minHeight: "100vh", background: "#f8f9fa", fontFamily: "'Segoe UI', Arial, sans-serif" }}>

                    {/* Modal CSS */}
                    <style>{`
                        .btn-primary { background: #00b4b4; color:#fff; border:none; padding:0.7rem 1.4rem; border-radius:10px; font-size:0.9rem; font-weight:600; cursor:pointer; transition:all .15s; }
                        .btn-primary:hover { background:#009999; }
                        .btn-primary:disabled { opacity:.5; cursor:default; }
                        .btn-secondary { background:#fff; color:#1a1a2e; border:1px solid #e5e7eb; padding:0.7rem 1.4rem; border-radius:10px; font-size:0.9rem; cursor:pointer; transition:all .15s; }
                        .btn-secondary:hover { background:#f8f9fa; }
                        .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,.55); backdrop-filter:blur(4px); display:flex; align-items:center; justify-content:center; z-index:1000; padding:1rem; }
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

                    {/* ── Top Bar ── */}
                    <div style={{
                        background: "#ffffff",
                        borderBottom: "1px solid #e5e7eb",
                        padding: "1rem 2rem",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: "1rem",
                        position: "sticky",
                        top: 0,
                        zIndex: 10,
                    }}>
                        {/* Title block */}
                        <div style={{ textAlign: "right" }}>
                            <h1 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 700, color: "#1a1a2e" }}>ניהול עסק</h1>
                            <p style={{ margin: 0, fontSize: "0.8rem", color: "#6b7280" }}>מעקב הוצאות ומיסים</p>
                        </div>

                        {/* Period selectors + actions */}
                        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                            <select
                                value={month}
                                onChange={e => setMonth(Number(e.target.value))}
                                style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "0.45rem 0.9rem", fontSize: "0.875rem", color: "#1a1a2e", cursor: "pointer", fontWeight: 500 }}
                            >
                                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                            </select>
                            <select
                                value={year}
                                onChange={e => setYear(Number(e.target.value))}
                                style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "0.45rem 0.9rem", fontSize: "0.875rem", color: "#1a1a2e", cursor: "pointer", fontWeight: 500 }}
                            >
                                {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                            </select>

                            {/* Action buttons */}
                            <button
                                onClick={() => downloadExpenseExcel(month, year)}
                                style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: "#fff", border: "1px solid #e5e7eb", color: "#1a1a2e", padding: "0.45rem 1rem", borderRadius: "8px", fontWeight: 500, fontSize: "0.875rem", cursor: "pointer" }}
                            >
                                Excel לרו&quot;ח
                            </button>
                            <button
                                disabled={sendingToAccountant}
                                onClick={async () => {
                                    if (!confirm(`לשלוח את כל הוצאות ${month}/${year} במייל לרואה החשבון?`)) return;
                                    setSendingToAccountant(true);
                                    try {
                                        const res = await sendExpensesToAccountant(month, year);
                                        toast.success(`נשלחו ${res.sent_count} הוצאות לרו"ח במייל ✅`);
                                        load();
                                    } catch (e: any) {
                                        toast.error(e.message || "שגיאה בשליחת המייל");
                                    } finally {
                                        setSendingToAccountant(false);
                                    }
                                }}
                                style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: "#fff", border: "1px solid #e5e7eb", color: "#1a1a2e", padding: "0.45rem 1rem", borderRadius: "8px", fontWeight: 500, fontSize: "0.875rem", cursor: "pointer" }}
                            >
                                {sendingToAccountant ? "שולח..." : "📧 שלח לרו\"ח במייל"}
                            </button>
                            <button
                                disabled={downloadingZip}
                                onClick={async () => {
                                    setDownloadingZip(true);
                                    try {
                                        await downloadExpenseReceiptsZip(month, year);
                                    } catch (e: any) {
                                        toast.error(e.message || "שגיאה בהורדת הקבלות");
                                    } finally {
                                        setDownloadingZip(false);
                                    }
                                }}
                                style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: "#fff", border: "1px solid #e5e7eb", color: "#1a1a2e", padding: "0.45rem 1rem", borderRadius: "8px", fontWeight: 500, fontSize: "0.875rem", cursor: "pointer" }}
                            >
                                {downloadingZip ? "מוריד..." : "⬇️ הורד קבלות כ-ZIP"}
                            </button>
                            <button
                                onClick={async () => {
                                    if (!confirm(`לסמן את כל הוצאות ${month}/${year} כ"נשלחו לרו"ח"?`)) return;
                                    await markMonthSent(month, year);
                                    load();
                                    toast.success("כל ההוצאות סומנו כנשלחו!");
                                }}
                                style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: "#fff", border: "1px solid #e5e7eb", color: "#1a1a2e", padding: "0.45rem 1rem", borderRadius: "8px", fontWeight: 500, fontSize: "0.875rem", cursor: "pointer" }}
                            >
                                סמן חודש נשלח
                            </button>
                            <button
                                onClick={() => setModal("storage")}
                                style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: "#fff", border: "1px solid #e5e7eb", color: "#1a1a2e", padding: "0.45rem 1rem", borderRadius: "8px", fontWeight: 500, fontSize: "0.875rem", cursor: "pointer" }}
                            >
                                💾 ניהול אחסון
                            </button>
                            <button
                                onClick={() => setModal("manual")}
                                style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: "#fff", border: "1px solid #e5e7eb", color: "#1a1a2e", padding: "0.45rem 1rem", borderRadius: "8px", fontWeight: 500, fontSize: "0.875rem", cursor: "pointer" }}
                            >
                                הזנה ידנית
                            </button>
                            <button
                                onClick={() => setModal("scan")}
                                style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: "#00b4b4", border: "none", color: "#fff", padding: "0.45rem 1.1rem", borderRadius: "8px", fontWeight: 600, fontSize: "0.875rem", cursor: "pointer" }}
                            >
                                סריקת חשבונית AI
                            </button>
                        </div>
                    </div>

                    {/* ── Page Body ── */}
                    <div style={{ padding: "1.75rem 2rem", maxWidth: 1320, margin: "0 auto" }}>

                        {/* ── Goal Widget ── */}
                        <div style={{ background: "#ffffff", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", border: "1px solid #e5e7eb", padding: "1.5rem", marginBottom: "1.5rem" }}>
                            <GoalWidget month={month} year={year} />
                        </div>

                        {/* ── KPI Row ── */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
                            {[
                                { label: "הכנסות ברוטו", sub: "עסקאות שנסגרו", color: "#10b981", value: stats ? (stats.financials.gross_income_cents / 100).toLocaleString() : "—" },
                                { label: "רווח נקי", sub: "אחרי כל הניכויים", color: "#2563eb", value: stats ? (stats.financials.net_income_cents / 100).toLocaleString() : "—" },
                                { label: "מיסים", sub: 'מע"מ + מס הכנסה + ביטוח', color: "#f59e0b", value: stats ? ((stats.financials.vat_amount_cents + stats.financials.income_tax_cents + stats.financials.social_security_cents) / 100).toLocaleString() : "—" },
                                { label: "סך הוצאות", sub: summary ? `${summary.invoice_count} חשבוניות` : "החודש", color: "#ef4444", value: summary ? fmt(summary.total_expenses) : "—" },
                            ].map(c => (
                                <div key={c.label} style={{ background: "#fff", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.07)", border: "1px solid #e5e7eb", borderRight: `3px solid ${c.color}`, padding: "0.85rem 1rem" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.4rem" }}>
                                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: c.color, flexShrink: 0 }} />
                                        <span style={{ color: "#6b7280", fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{c.label}</span>
                                    </div>
                                    <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#1a1a2e", lineHeight: 1.2 }}>₪{c.value}</div>
                                    <div style={{ color: "#9ca3af", fontSize: "0.7rem", marginTop: "0.25rem" }}>{c.sub}</div>
                                </div>
                            ))}
                        </div>

                        {/* ── Charts Row ── */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", marginBottom: "1.5rem" }}>

                            {/* Bar Chart — Income vs Expenses */}
                            <div style={{ background: "#ffffff", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", border: "1px solid #e5e7eb", padding: "1.5rem" }}>
                                <div style={{ marginBottom: "1.25rem" }}>
                                    <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#1a1a2e" }}>הכנסות מול הוצאות</div>
                                    <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.2rem" }}>{MONTHS[month - 1]} {year}</div>
                                </div>
                                <ResponsiveContainer width="100%" height={230}>
                                    <BarChart data={barData} margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="0" stroke="#f3f4f6" vertical={false} />
                                        <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                                        <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} tickFormatter={(v: number) => `₪${(v / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} />
                                        <Tooltip
                                            formatter={(value: number) => [`₪${Number(value).toLocaleString()}`, ""]}
                                            contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}
                                            cursor={{ fill: "#f9fafb" }}
                                        />
                                        <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                                            {barData.map((entry, index) => (
                                                <Cell
                                                    key={`bar-${index}`}
                                                    fill={index === 0 ? "#00b4b4" : index === 1 ? "#94a3b8" : "#10b981"}
                                                />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Pie Chart — Expenses by category */}
                            <div style={{ background: "#ffffff", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", border: "1px solid #e5e7eb", padding: "1.5rem" }}>
                                <div style={{ marginBottom: "1.25rem" }}>
                                    <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#1a1a2e" }}>הוצאות לפי קטגוריה</div>
                                    <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.2rem" }}>פילוח חודשי</div>
                                </div>
                                {pieData.length === 0 ? (
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 230, color: "#6b7280", fontSize: "0.875rem" }}>
                                        אין נתונים לתצוגה
                                    </div>
                                ) : (
                                    <ResponsiveContainer width="100%" height={230}>
                                        <PieChart>
                                            <Pie
                                                data={pieData}
                                                cx="50%"
                                                cy="45%"
                                                innerRadius={60}
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
                                                formatter={(value: number) => [`₪${Number(value).toLocaleString()}`, ""]}
                                                contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}
                                            />
                                            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "#6b7280" }} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                )}
                            </div>
                        </div>

                        {/* ── Expense Table ── */}
                        <div style={{ background: "#ffffff", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", border: "1px solid #e5e7eb", overflow: "hidden" }}>

                            {/* Table header */}
                            <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "#1a1a2e" }}>רשימת הוצאות</span>
                                {summary && (
                                    <span style={{ background: "#f8f9fa", border: "1px solid #e5e7eb", color: "#6b7280", borderRadius: "20px", padding: "0.2rem 0.8rem", fontSize: "0.75rem", fontWeight: 600 }}>
                                        {summary.invoice_count} רשומות
                                    </span>
                                )}
                            </div>

                            {loading ? (
                                <div style={{ textAlign: "center", padding: "4rem 1rem", color: "#6b7280" }}>
                                    <p style={{ fontWeight: 600 }}>טוען נתונים...</p>
                                </div>
                            ) : expenses.length === 0 ? (
                                <div style={{ textAlign: "center", padding: "4rem 1rem" }}>
                                    <p style={{ fontWeight: 600, color: "#1a1a2e", margin: "0 0 0.4rem" }}>אין הוצאות לתקופה זו</p>
                                    <p style={{ fontSize: "0.85rem", color: "#6b7280", margin: 0 }}>העלה חשבונית עם AI או הזן ידנית</p>
                                </div>
                            ) : (
                                <div style={{ overflowX: "auto" }}>
                                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                        <thead>
                                            <tr style={{ background: "#f9fafb" }}>
                                                {["קבלה", "ספק / שם", "קטגוריה", "אמצעי תשלום", "תאריך", "סכום", 'מע"מ', "סטטוס", ""].map(h => (
                                                    <th key={h} style={{ padding: "0.75rem 1.25rem", textAlign: "right", fontSize: "0.72rem", color: "#6b7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>
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
                                                    style={{ cursor: "pointer", background: "#ffffff", borderBottom: "1px solid #f3f4f6", transition: "background 0.1s" }}
                                                    onMouseEnter={ev => (ev.currentTarget.style.background = "#f9fafb")}
                                                    onMouseLeave={ev => (ev.currentTarget.style.background = "#ffffff")}
                                                >
                                                    {/* Thumbnail / attach-image column */}
                                                    <td style={{ padding: "0.5rem 0.75rem 0.5rem 1.25rem", width: 60 }} onClick={ev => ev.stopPropagation()}>
                                                        {receiptImgUrl(e.receipt_url) ? (
                                                            <img
                                                                src={receiptImgUrl(e.receipt_url)!}
                                                                alt="receipt"
                                                                onClick={() => setViewExpense(e)}
                                                                style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 8, border: "1px solid #e5e7eb", cursor: "pointer", display: "block" }}
                                                            />
                                                        ) : uploadingId === e.id ? (
                                                            <div style={{ width: 48, height: 48, borderRadius: 8, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.1rem" }}>⏳</div>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                onClick={ev => handleInlineCameraClick(e.id, ev)}
                                                                title="צרף תמונת קבלה"
                                                                style={{ width: 48, height: 48, borderRadius: 8, background: "#f9fafb", border: "1.5px dashed #d1d5db", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.2rem", color: "#9ca3af" }}
                                                            >
                                                                📷
                                                            </button>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: "0.9rem 1.25rem", fontWeight: 600, color: "#1a1a2e", fontSize: "0.875rem" }}>
                                                        {e.supplier_name || e.title}
                                                    </td>
                                                    <td style={{ padding: "0.9rem 1.25rem" }}>
                                                        {e.category ? (
                                                            <span style={{ display: "inline-block", padding: "0.2rem 0.65rem", borderRadius: "20px", fontSize: "0.72rem", fontWeight: 600, background: "rgba(0,180,180,0.08)", color: "#00b4b4", border: "1px solid rgba(0,180,180,0.2)" }}>
                                                                {e.category}
                                                            </span>
                                                        ) : (
                                                            <span style={{ color: "#d1d5db" }}>—</span>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: "0.9rem 1.25rem", color: "#6b7280", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                                                        {e.payment_method || <span style={{ color: "#d1d5db" }}>—</span>}
                                                    </td>
                                                    <td style={{ padding: "0.9rem 1.25rem", color: "#6b7280", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                                                        {new Date(e.expense_date).toLocaleDateString("he-IL")}
                                                    </td>
                                                    <td style={{ padding: "0.9rem 1.25rem", fontWeight: 700, color: "#1a1a2e", fontSize: "0.9rem", whiteSpace: "nowrap" }}>
                                                        ₪{fmt(e.amount)}
                                                    </td>
                                                    <td style={{ padding: "0.9rem 1.25rem", color: "#6b7280", fontSize: "0.85rem", whiteSpace: "nowrap" }}>
                                                        ₪{fmt(e.vat_amount)}
                                                    </td>
                                                    <td style={{ padding: "0.9rem 1.25rem" }}>
                                                        {e.sent_to_accountant ? (
                                                            <span style={{ display: "inline-block", padding: "0.2rem 0.65rem", borderRadius: "20px", fontSize: "0.72rem", fontWeight: 600, background: "rgba(16,185,129,0.08)", color: "#10b981", border: "1px solid rgba(16,185,129,0.2)" }}>
                                                                נשלח
                                                            </span>
                                                        ) : (
                                                            <span style={{ display: "inline-block", padding: "0.2rem 0.65rem", borderRadius: "20px", fontSize: "0.72rem", fontWeight: 600, background: "rgba(245,158,11,0.08)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.2)" }}>
                                                                ממתין
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: "0.9rem 1.25rem" }} onClick={ev => ev.stopPropagation()}>
                                                        <button
                                                            onClick={() => handleDelete(e.id)}
                                                            style={{ background: "none", color: "#ef4444", border: "none", padding: "0.3rem 0.6rem", borderRadius: "6px", fontSize: "0.8rem", cursor: "pointer", fontWeight: 600, transition: "background 0.15s" }}
                                                            onMouseEnter={ev => { ev.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
                                                            onMouseLeave={ev => { ev.currentTarget.style.background = "none"; }}
                                                        >
                                                            מחק
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

                    {/* Hidden input for inline row image upload */}
                    <input
                        ref={inlineUploadRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/heic"
                        aria-label="העלאת תמונת קבלה"
                        style={{ display: "none" }}
                        onChange={handleInlineFileChange}
                    />

                    {/* Modals */}
                    {modal === "scan" && <InvoiceUploadModal onClose={() => setModal(null)} onSaved={load} />}
                    {modal === "manual" && <ManualExpenseModal onClose={() => setModal(null)} onSaved={load} />}
                    {modal === "storage" && <StorageUsageModal onClose={() => setModal(null)} onChanged={load} />}
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
