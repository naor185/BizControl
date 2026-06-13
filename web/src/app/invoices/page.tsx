"use client";
import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface InvoiceSettings {
    business_type: string;
    business_name?: string;
    business_number?: string;
    vat_rate: number;
    business_address?: string;
    business_city?: string;
    business_phone?: string;
    business_email?: string;
    logo_url?: string;
    signature_url?: string;
    payment_terms?: string;
    default_notes?: string;
    settings_completed: boolean;
    allowed_doc_types: string[];
}

interface SeriesMap {
    [key: string]: { label: string; next_number: number };
}

interface InvoiceItem {
    id?: string;
    description: string;
    quantity: number;
    unit_price_cents: number;
    total_price_cents?: number;
    product_id?: string;
    service_id?: string;
}

interface Invoice {
    id: string;
    doc_type: string;
    doc_type_label: string;
    doc_number: number;
    status: string;
    // Client
    client_name?: string;
    client_phone?: string;
    client_email?: string;
    client_address?: string;
    // Business (snapshotted at creation)
    business_name?: string;
    business_number?: string;
    business_address?: string;
    business_city?: string;
    business_phone?: string;
    business_email?: string;
    business_type?: string;
    // Financial
    total_cents: number;
    total_ils: number;
    subtotal_ils: number;
    vat_amount_ils: number;
    tip_ils: number;
    vat_rate: number;
    // Payment
    payment_method?: string;
    payment_reference?: string;
    payment_date?: string;
    notes?: string;
    issued_at: string;
    credited_by_display?: string;
    credits_invoice_display?: string;
    items?: InvoiceItem[];
}

const DOC_TYPES: Record<string, string> = {
    invoice_tax: "חשבונית מס",
    receipt: "קבלה",
    invoice_tax_receipt: "חשבונית מס/קבלה",
    credit: "זיכוי",
    transaction: "חשבונית עסקה",
};

const BIZ_TYPES = [
    { value: "osek_patur", label: "עוסק פטור" },
    { value: "osek_murshe", label: "עוסק מורשה" },
    { value: "chevra_baam", label: 'חברה בע"מ' },
];

const METHODS = [
    { value: "cash", label: "מזומן" },
    { value: "bit", label: "Bit" },
    { value: "paybox", label: "PayBox" },
    { value: "credit_card", label: "כרטיס אשראי" },
    { value: "bank_transfer", label: "העברה בנקאית" },
    { value: "check", label: "צ'ק" },
    { value: "other", label: "אחר" },
];

const STATUS_BADGE: Record<string, { label: string; bg: string; color: string }> = {
    issued:   { label: "הופק",   bg: "#dcfce7", color: "#166534" },
    credited: { label: "זוכה",   bg: "#fee2e2", color: "#991b1b" },
};

const TYPE_COLOR: Record<string, string> = {
    invoice_tax: "#7c3aed",
    receipt: "#0ea5e9",
    invoice_tax_receipt: "#059669",
    credit: "#dc2626",
    transaction: "#f59e0b",
};

type Tab = "documents" | "settings" | "series" | "reports";

// ── Main Component ────────────────────────────────────────────────────────────

export default function InvoicesPage() {
    const [tab, setTab] = useState<Tab>("documents");
    const [settings, setSettings] = useState<InvoiceSettings | null>(null);
    const [series, setSeries] = useState<SeriesMap>({});
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [filterType, setFilterType] = useState("");
    const [filterDate, setFilterDate] = useState("");
    const [viewInvoice, setViewInvoice] = useState<Invoice | null>(null);

    const loadSettings = useCallback(async () => {
        const s = await apiFetch<InvoiceSettings>("/api/invoices/settings");
        setSettings(s);
    }, []);

    const loadSeries = useCallback(async () => {
        const s = await apiFetch<SeriesMap>("/api/invoices/series");
        setSeries(s);
    }, []);

    const loadInvoices = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ limit: "50" });
            if (filterType) params.set("doc_type", filterType);
            if (filterDate) {
                params.set("date_from", filterDate + "T00:00:00");
                params.set("date_to", filterDate + "T23:59:59");
            }
            const data = await apiFetch<{ items: Invoice[]; total: number }>(`/api/invoices?${params}`);
            setInvoices(data.items);
            setTotal(data.total);
        } finally {
            setLoading(false);
        }
    }, [filterType, filterDate]);

    useEffect(() => { loadSettings(); loadSeries(); }, []);
    useEffect(() => { if (tab === "documents") loadInvoices(); }, [tab, loadInvoices]);

    const getPdfUrl = (id: string) => {
        const token = localStorage.getItem("bizcontrol_token") || "";
        return `${process.env.NEXT_PUBLIC_API_URL}/api/invoices/${id}/pdf?token=${encodeURIComponent(token)}`;
    };

    const downloadPdf = async (id: string, label: string, num: number) => {
        try {
            const url = getPdfUrl(id);
            const res = await fetch(url);
            if (!res.ok) {
                const errText = await res.text().catch(() => "");
                alert(`שגיאה בהורדת PDF (${res.status})${errText ? ": " + errText : ""}`);
                return;
            }
            const blob = await res.blob();
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `${label}_${num}.pdf`;
            a.click();
            URL.revokeObjectURL(a.href);
        } catch (e: unknown) {
            alert(`שגיאה בהורדת PDF: ${(e as Error).message}`);
        }
    };

    const createCredit = async (id: string, paymentMethod: string, notes: string) => {
        try {
            await apiFetch(`/api/invoices/${id}/credit`, {
                method: "POST",
                body: JSON.stringify({ payment_method: paymentMethod || null, notes: notes || null }),
            });
            await loadInvoices();
            setViewInvoice(null);
        } catch (e: unknown) { alert((e as Error).message); }
    };

    return (
        <AppShell title="חשבוניות ומסמכים">
            {/* Setup wizard — shown on first use */}
            {settings && !settings.settings_completed && (
                <InvoiceSetupWizard
                    series={series}
                    onComplete={async () => { await loadSettings(); await loadSeries(); }}
                />
            )}

            {/* Tabs */}
            <div style={{ display: "flex", gap: "0.5rem", padding: "1rem 1rem 0", borderBottom: "1px solid #f0f0f0", marginBottom: "1rem" }}>
                {(["documents", "settings", "series", "reports"] as Tab[]).map(t => (
                    <button key={t} type="button" onClick={() => setTab(t)} style={{
                        padding: "0.5rem 1rem", border: "none", background: "none", cursor: "pointer",
                        fontWeight: tab === t ? 700 : 400, fontSize: "0.9rem",
                        borderBottom: tab === t ? "2px solid #7c3aed" : "2px solid transparent",
                        color: tab === t ? "#7c3aed" : "#64748b",
                    }}>
                        {{ documents: "📄 מסמכים", settings: "⚙️ הגדרות", series: "🔢 סדרות", reports: "📊 דוחות" }[t]}
                    </button>
                ))}
            </div>

            {tab === "documents" && (
                <DocumentsTab
                    invoices={invoices} total={total} loading={loading}
                    filterType={filterType} setFilterType={setFilterType}
                    filterDate={filterDate} setFilterDate={setFilterDate}
                    onFilter={loadInvoices}
                    settings={settings}
                    onView={async (inv) => {
                        const full = await apiFetch<Invoice>(`/api/invoices/${inv.id}`);
                        setViewInvoice(full);
                    }}
                    onPdf={(id) => downloadPdf(id, invoices.find(i => i.id === id)?.doc_type_label || "מסמך", invoices.find(i => i.id === id)?.doc_number || 0)}
                />
            )}
            {tab === "settings" && settings && (
                <SettingsTab settings={settings} onSaved={loadSettings} />
            )}
            {tab === "series" && (
                <SeriesTab series={series} locked={settings?.settings_completed ?? false} onSaved={loadSeries} />
            )}
            {tab === "reports" && (
                <ReportsTab />
            )}

            {viewInvoice && (
                <InvoiceDetailModal
                    invoice={viewInvoice}
                    onClose={() => setViewInvoice(null)}
                    onDownload={() => downloadPdf(viewInvoice.id, viewInvoice.doc_type_label, viewInvoice.doc_number)}
                    getPdfUrl={() => getPdfUrl(viewInvoice.id)}
                    onCredit={(method, notes) => createCredit(viewInvoice.id, method, notes)}
                />
            )}
        </AppShell>
    );
}

// ── Documents Tab ─────────────────────────────────────────────────────────────

function DocumentsTab({ invoices, total, loading, settings, filterType, setFilterType, filterDate, setFilterDate, onFilter, onView, onPdf }: {
    invoices: Invoice[]; total: number; loading: boolean; settings: InvoiceSettings | null;
    filterType: string; setFilterType: (v: string) => void;
    filterDate: string; setFilterDate: (v: string) => void;
    onFilter: () => void;
    onView: (inv: Invoice) => void; onPdf: (id: string) => void;
}) {
    return (
        <div style={{ padding: "0 1rem" }}>
            {/* Toolbar */}
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
                <select value={filterType} onChange={e => { setFilterType(e.target.value); setTimeout(onFilter, 0); }}
                    style={{ padding: "0.5rem 0.75rem", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.85rem" }}>
                    <option value="">כל הסוגים</option>
                    {(settings?.allowed_doc_types || Object.keys(DOC_TYPES)).map(t => (
                        <option key={t} value={t}>{DOC_TYPES[t]}</option>
                    ))}
                </select>

                <input type="date" value={filterDate} onChange={e => { setFilterDate(e.target.value); setTimeout(onFilter, 0); }}
                    style={{ padding: "0.5rem 0.75rem", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.85rem" }} />

                <span style={{ color: "#94a3b8", fontSize: "0.82rem", marginRight: "auto" }}>{total} מסמכים</span>
            </div>

            {loading ? (
                <div style={{ textAlign: "center", padding: "3rem", color: "#94a3b8" }}>טוען...</div>
            ) : invoices.length === 0 ? (
                <div style={{ textAlign: "center", padding: "3rem", color: "#94a3b8" }}>
                    <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>📄</div>
                    <div>אין מסמכים עדיין</div>
                </div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {invoices.map(inv => <InvoiceRow key={inv.id} inv={inv} onView={onView} onPdf={onPdf} />)}
                </div>
            )}
        </div>
    );
}

function InvoiceRow({ inv, onView, onPdf }: { inv: Invoice; onView: (i: Invoice) => void; onPdf: (id: string) => void }) {
    const st = STATUS_BADGE[inv.status] || STATUS_BADGE.issued;
    const typeColor = TYPE_COLOR[inv.doc_type] || "#64748b";
    return (
        <div style={{ background: "#fff", border: "1px solid #f1f5f9", borderRadius: 12, padding: "0.9rem 1rem", display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer" }}
            onClick={() => onView(inv)}>
            <div style={{ width: 4, height: 44, borderRadius: 4, background: typeColor, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.25rem" }}>
                    <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{inv.doc_type_label} #{inv.doc_number}</span>
                    <span style={{ background: st.bg, color: st.color, fontSize: "0.7rem", fontWeight: 700, padding: "0.15rem 0.5rem", borderRadius: 6 }}>{st.label}</span>
                </div>
                <div style={{ color: "#64748b", fontSize: "0.8rem" }}>
                    {inv.client_name || "—"} · {new Date(inv.issued_at).toLocaleDateString("he-IL")}
                </div>
            </div>
            <div style={{ textAlign: "left", flexShrink: 0 }}>
                <div style={{ fontWeight: 800, fontSize: "1rem", color: inv.doc_type === "credit" ? "#dc2626" : "#111" }}>
                    {inv.doc_type === "credit" ? "-" : ""}₪{Math.abs(inv.total_ils).toFixed(2)}
                </div>
                <button type="button" onClick={e => { e.stopPropagation(); onPdf(inv.id); }}
                    style={{ background: "none", border: "1px solid #e2e8f0", borderRadius: 6, padding: "0.2rem 0.5rem", fontSize: "0.72rem", cursor: "pointer", color: "#64748b", marginTop: "0.25rem" }}>
                    PDF
                </button>
            </div>
        </div>
    );
}

// ── Invoice Detail Modal ──────────────────────────────────────────────────────

const METHOD_LABELS_FE: Record<string, string> = {
    cash: "מזומן", bit: "Bit", paybox: "PayBox",
    credit_card: "כרטיס אשראי", bank_transfer: "העברה בנקאית",
    check: "צ'ק", other: "אחר",
};

function InvoiceDetailModal({ invoice, onClose, onDownload, getPdfUrl, onCredit }: {
    invoice: Invoice;
    onClose: () => void;
    onDownload: () => void;
    getPdfUrl: () => string;
    onCredit: (method: string, notes: string) => void;
}) {
    const [showActions, setShowActions] = useState(false);
    const [showCreditForm, setShowCreditForm] = useState(false);
    const [creditMethod, setCreditMethod] = useState("cash");
    const [creditNotes, setCreditNotes] = useState("");
    const [creditLoading, setCreditLoading] = useState(false);
    const isCredit = invoice.doc_type === "credit";
    const canCredit = invoice.status === "issued" && !isCredit;
    const accentColor = isCredit ? "#dc2626" : "#1a1a2e";

    const submitCredit = async () => {
        setCreditLoading(true);
        try {
            await onCredit(creditMethod, creditNotes);
        } finally {
            setCreditLoading(false);
            setShowCreditForm(false);
        }
    };

    const shareWhatsApp = () => {
        const url = getPdfUrl();
        const text = encodeURIComponent(
            `${invoice.doc_type_label} #${invoice.doc_number}${invoice.business_name ? " - " + invoice.business_name : ""}\nלצפייה ב-PDF: ${url}`
        );
        window.open(`https://wa.me/?text=${text}`, "_blank");
    };

    const shareSMS = () => {
        const url = getPdfUrl();
        const text = encodeURIComponent(`${invoice.doc_type_label} #${invoice.doc_number}\n${url}`);
        window.location.href = `sms:?body=${text}`;
    };

    const printDoc = () => {
        window.open(getPdfUrl(), "_blank");
    };

    return (
        <>
            {/* Overlay */}
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 9000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
                onClick={showActions ? () => setShowActions(false) : onClose}>

                {/* Main sheet */}
                <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 580, maxHeight: "92vh", overflow: "auto", display: "flex", flexDirection: "column" }}
                    onClick={e => e.stopPropagation()}>

                    {/* Close bar */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.25rem 0.75rem", borderBottom: "1px solid #f1f5f9" }}>
                        <button type="button" onClick={onClose} style={{ background: "none", border: "none", fontSize: "1.4rem", cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>×</button>
                        <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "#64748b" }}>תצוגה מקדימה</span>
                        <div style={{ width: 28 }} />
                    </div>

                    <div style={{ overflowY: "auto", flex: 1 }}>
                        {/* ── Business header ── */}
                        <div style={{ background: accentColor, padding: "1.25rem 1.25rem 1rem", textAlign: "center", color: "#fff" }}>
                            <div style={{ fontWeight: 900, fontSize: "1.2rem", marginBottom: "0.2rem" }}>
                                {invoice.business_name || "העסק שלי"}
                            </div>
                            {invoice.business_number && (
                                <div style={{ fontSize: "0.78rem", opacity: 0.8 }}>ח.פ / ע.מ: {invoice.business_number}</div>
                            )}
                            {(invoice.business_address || invoice.business_city) && (
                                <div style={{ fontSize: "0.78rem", opacity: 0.75, marginTop: "0.15rem" }}>
                                    {[invoice.business_address, invoice.business_city].filter(Boolean).join(", ")}
                                </div>
                            )}
                            {invoice.business_phone && (
                                <div style={{ fontSize: "0.78rem", opacity: 0.75 }}>טל: {invoice.business_phone}</div>
                            )}
                        </div>

                        {/* ── Doc meta ── */}
                        <div style={{ background: "#f8fafc", padding: "0.85rem 1.25rem", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <div>
                                <div style={{ fontWeight: 800, fontSize: "1rem", color: accentColor }}>
                                    {invoice.doc_type_label} #{invoice.doc_number}
                                </div>
                                {invoice.credits_invoice_display && (
                                    <div style={{ fontSize: "0.75rem", color: "#dc2626", marginTop: "0.15rem" }}>זיכוי עבור: {invoice.credits_invoice_display}</div>
                                )}
                                {invoice.credited_by_display && (
                                    <div style={{ fontSize: "0.75rem", color: "#dc2626", marginTop: "0.15rem" }}>זוכה על ידי: {invoice.credited_by_display}</div>
                                )}
                            </div>
                            <div style={{ textAlign: "left", fontSize: "0.8rem", color: "#64748b" }}>
                                {new Date(invoice.issued_at).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" })}
                                <br />
                                {new Date(invoice.issued_at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
                            </div>
                        </div>

                        <div style={{ padding: "1rem 1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                            {/* ── Client ── */}
                            {(invoice.client_name || invoice.client_phone) && (
                                <div>
                                    <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.35rem" }}>לכבוד</div>
                                    <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#1e293b" }}>{invoice.client_name}</div>
                                    {invoice.client_phone && <div style={{ fontSize: "0.82rem", color: "#64748b" }}>{invoice.client_phone}</div>}
                                    {invoice.client_email && <div style={{ fontSize: "0.82rem", color: "#64748b" }}>{invoice.client_email}</div>}
                                    {invoice.client_address && <div style={{ fontSize: "0.82rem", color: "#64748b" }}>{invoice.client_address}</div>}
                                </div>
                            )}

                            {/* ── Items table ── */}
                            {invoice.items && invoice.items.length > 0 && (
                                <div>
                                    <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.35rem" }}>פירוט</div>
                                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                                        <thead>
                                            <tr style={{ background: accentColor, color: "#fff" }}>
                                                <th style={{ padding: "0.5rem 0.6rem", textAlign: "right", fontWeight: 700, borderRadius: "6px 0 0 0" }}>תיאור</th>
                                                <th style={{ padding: "0.5rem 0.6rem", textAlign: "center", fontWeight: 700, width: 50 }}>כמות</th>
                                                <th style={{ padding: "0.5rem 0.6rem", textAlign: "center", fontWeight: 700, width: 70 }}>מחיר</th>
                                                <th style={{ padding: "0.5rem 0.6rem", textAlign: "left", fontWeight: 700, width: 80, borderRadius: "0 6px 0 0" }}>סה"כ</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {invoice.items.map((item, i) => (
                                                <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                                                    <td style={{ padding: "0.5rem 0.6rem", textAlign: "right" }}>{item.description}</td>
                                                    <td style={{ padding: "0.5rem 0.6rem", textAlign: "center", color: "#64748b" }}>{item.quantity}</td>
                                                    <td style={{ padding: "0.5rem 0.6rem", textAlign: "center", color: "#64748b" }}>₪{(item.unit_price_cents / 100).toFixed(2)}</td>
                                                    <td style={{ padding: "0.5rem 0.6rem", textAlign: "left", fontWeight: 700 }}>₪{((item.total_price_cents || 0) / 100).toFixed(2)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {/* ── Totals ── */}
                            <div style={{ background: "#f8fafc", borderRadius: 10, padding: "0.75rem 1rem" }}>
                                {invoice.vat_amount_ils > 0 && (
                                    <>
                                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: "0.3rem", color: "#64748b" }}>
                                            <span>לפני מע"מ</span><span>₪{invoice.subtotal_ils.toFixed(2)}</span>
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: "0.3rem", color: "#64748b" }}>
                                            <span>מע"מ {invoice.vat_rate}%</span><span>₪{invoice.vat_amount_ils.toFixed(2)}</span>
                                        </div>
                                    </>
                                )}
                                {invoice.tip_ils > 0 && (
                                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: "0.3rem", color: "#64748b" }}>
                                        <span>טיפ</span><span>₪{invoice.tip_ils.toFixed(2)}</span>
                                    </div>
                                )}
                                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, fontSize: "1.05rem", paddingTop: "0.4rem", borderTop: "1px solid #e2e8f0", color: accentColor }}>
                                    <span>סה"כ לתשלום</span>
                                    <span>{isCredit ? "-" : ""}₪{Math.abs(invoice.total_ils).toFixed(2)}</span>
                                </div>
                                {invoice.business_type === "osek_patur" && (
                                    <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "0.3rem", textAlign: "right" }}>* עוסק פטור, אינו חייב במע"מ</div>
                                )}
                            </div>

                            {/* ── Payment method ── */}
                            {invoice.payment_method && (
                                <div style={{ fontSize: "0.85rem", color: "#475569" }}>
                                    <span style={{ fontWeight: 700 }}>אמצעי תשלום: </span>
                                    {METHOD_LABELS_FE[invoice.payment_method] || invoice.payment_method}
                                    {invoice.payment_reference && <span style={{ color: "#94a3b8" }}> · אסמכתה: {invoice.payment_reference}</span>}
                                </div>
                            )}

                            {/* ── Notes ── */}
                            {invoice.notes && (
                                <div style={{ fontSize: "0.82rem", color: "#64748b", background: "#fffbeb", borderRadius: 8, padding: "0.6rem 0.8rem", borderRight: "3px solid #f59e0b" }}>
                                    {invoice.notes}
                                </div>
                            )}

                            {/* ── BizControl footer ── */}
                            <div style={{ textAlign: "center", fontSize: "0.72rem", color: "#cbd5e1", paddingTop: "0.25rem" }}>
                                הופק באמצעות מערכת BizControl | מסמך ממוחשב חתום דיגיטלית
                            </div>
                        </div>
                    </div>

                    {/* ── Bottom action buttons ── */}
                    <div style={{ padding: "0.85rem 1.25rem 1.25rem", borderTop: "1px solid #f1f5f9", display: "flex", gap: "0.5rem", background: "#fff" }}>
                        {canCredit && (
                            <button type="button" onClick={() => setShowCreditForm(true)} style={{ background: "#fee2e2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 12, padding: "0.75rem 1rem", fontWeight: 700, cursor: "pointer", fontSize: "0.88rem" }}>
                                זיכוי
                            </button>
                        )}
                        <button type="button" onClick={() => setShowActions(true)} style={{ flex: 1, background: accentColor, color: "#fff", border: "none", borderRadius: 12, padding: "0.75rem", fontWeight: 800, cursor: "pointer", fontSize: "0.95rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem" }}>
                            <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                            </svg>
                            : פעולות
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Credit Note Form ── */}
            {showCreditForm && (
                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 9200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
                    onClick={() => setShowCreditForm(false)}>
                    <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 580, padding: "1.5rem" }}
                        onClick={e => e.stopPropagation()}>
                        <div style={{ width: 40, height: 4, background: "#e2e8f0", borderRadius: 2, margin: "0 auto 1.25rem" }} />
                        <div style={{ fontWeight: 800, fontSize: "1.1rem", color: "#dc2626", marginBottom: "0.3rem" }}>יצירת זיכוי</div>
                        <div style={{ fontSize: "0.82rem", color: "#64748b", marginBottom: "1.25rem" }}>
                            זיכוי עבור {invoice.doc_type_label} #{invoice.doc_number} · ₪{Math.abs(invoice.total_ils).toFixed(2)}
                        </div>

                        <div style={{ marginBottom: "1rem" }}>
                            <label style={labelStyle}>כיצד יוחזר הכסף ללקוח? *</label>
                            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                                {[
                                    { value: "cash", label: "מזומן" },
                                    { value: "bit", label: "Bit" },
                                    { value: "paybox", label: "PayBox" },
                                    { value: "bank_transfer", label: "העברה" },
                                    { value: "credit_card", label: 'כרטיס' },
                                    { value: "check", label: "צ'ק" },
                                ].map(m => (
                                    <button key={m.value} type="button" onClick={() => setCreditMethod(m.value)} style={{
                                        padding: "0.45rem 0.9rem", borderRadius: 10,
                                        border: `2px solid ${creditMethod === m.value ? "#dc2626" : "#e2e8f0"}`,
                                        background: creditMethod === m.value ? "#fee2e2" : "#fff",
                                        color: creditMethod === m.value ? "#dc2626" : "#334155",
                                        fontWeight: 700, cursor: "pointer", fontSize: "0.82rem",
                                    }}>{m.label}</button>
                                ))}
                            </div>
                        </div>

                        <div style={{ marginBottom: "1.25rem" }}>
                            <label style={labelStyle}>הערה (אופציונלי)</label>
                            <input value={creditNotes} onChange={e => setCreditNotes(e.target.value)}
                                style={inputStyle} placeholder="סיבת הזיכוי..." />
                        </div>

                        <div style={{ display: "flex", gap: "0.6rem" }}>
                            <button type="button" onClick={() => setShowCreditForm(false)} style={{
                                flex: 1, background: "#f8fafc", color: "#64748b", border: "1px solid #e2e8f0",
                                borderRadius: 12, padding: "0.85rem", fontWeight: 700, cursor: "pointer",
                            }}>ביטול</button>
                            <button type="button" onClick={submitCredit} disabled={creditLoading} style={{
                                flex: 2, background: "#dc2626", color: "#fff", border: "none",
                                borderRadius: 12, padding: "0.85rem", fontWeight: 800, cursor: "pointer",
                                opacity: creditLoading ? 0.7 : 1,
                            }}>
                                {creditLoading ? "מייצר זיכוי..." : "✓ צור זיכוי"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Action Sheet ── */}
            {showActions && (
                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 9100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
                    onClick={() => setShowActions(false)}>
                    <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 580, padding: "0.5rem 1rem 2rem" }}
                        onClick={e => e.stopPropagation()}>
                        <div style={{ width: 40, height: 4, background: "#e2e8f0", borderRadius: 2, margin: "0.75rem auto 1rem" }} />

                        {[
                            { label: "הדפסה", icon: "🖨️", action: () => { setShowActions(false); printDoc(); } },
                            { label: "וואטסאפ", icon: "💬", action: () => { setShowActions(false); shareWhatsApp(); } },
                            { label: "SMS", icon: "📱", action: () => { setShowActions(false); shareSMS(); } },
                            { label: "קובץ PDF", icon: "📄", action: () => { setShowActions(false); onDownload(); } },
                        ].map(({ label, icon, action }) => (
                            <button key={label} type="button" onClick={action} style={{
                                width: "100%", background: "none", border: "none", borderBottom: "1px solid #f1f5f9",
                                padding: "0.95rem 0.5rem", display: "flex", alignItems: "center", gap: "0.9rem",
                                fontSize: "1rem", fontWeight: 600, cursor: "pointer", color: "#1e293b", textAlign: "right",
                            }}>
                                <span style={{ fontSize: "1.3rem" }}>{icon}</span>
                                {label}
                            </button>
                        ))}

                        <button type="button" onClick={() => setShowActions(false)} style={{
                            width: "100%", background: "none", border: "none",
                            padding: "0.95rem 0.5rem", display: "flex", alignItems: "center", gap: "0.9rem",
                            fontSize: "1rem", fontWeight: 600, cursor: "pointer", color: "#94a3b8", textAlign: "right",
                        }}>
                            <span style={{ fontSize: "1.3rem" }}>✕</span>
                            סגירה
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}

// ── Create Modal ──────────────────────────────────────────────────────────────

// ── Invoice Setup Wizard (first-time) ────────────────────────────────────────

const WIZARD_DOC_TYPES = ["invoice_tax_receipt", "invoice_tax", "receipt", "credit", "transaction"] as const;

function InvoiceSetupWizard({ series, onComplete }: { series: SeriesMap; onComplete: () => void }) {
    const [step, setStep] = useState(1);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    // Step 1 — business details
    const [bizType, setBizType] = useState("osek_murshe");
    const [bizName, setBizName] = useState("");
    const [bizNum, setBizNum] = useState("");
    const [addr, setAddr] = useState("");
    const [city, setCity] = useState("");
    const [phone, setPhone] = useState("");
    const [email, setEmail] = useState("");

    // Step 2 — series starting numbers
    const [nums, setNums] = useState<Record<string, number>>(() => {
        const init: Record<string, number> = {};
        WIZARD_DOC_TYPES.forEach(dt => { init[dt] = series[dt]?.next_number ?? 1000; });
        return init;
    });

    const goNext = () => {
        if (!bizName.trim()) { setErr("יש להזין שם עסק"); return; }
        if (!bizNum.trim()) { setErr("יש להזין מספר עוסק / ח.פ"); return; }
        setErr(null);
        setStep(2);
    };

    const finish = async () => {
        setSaving(true); setErr(null);
        try {
            await apiFetch("/api/invoices/settings/complete", {
                method: "POST",
                body: JSON.stringify({
                    business_type: bizType,
                    business_name: bizName.trim(),
                    business_number: bizNum.trim(),
                    business_address: addr.trim() || null,
                    business_city: city.trim() || null,
                    business_phone: phone.trim() || null,
                    business_email: email.trim() || null,
                    series: nums,
                }),
            });
            await onComplete();
        } catch (e: unknown) {
            setErr((e as Error).message);
        } finally {
            setSaving(false);
        }
    };

    const DOC_LABELS: Record<string, string> = {
        invoice_tax_receipt: "חשבונית מס/קבלה",
        invoice_tax: "חשבונית מס",
        receipt: "קבלה",
        credit: "זיכוי",
        transaction: "חשבונית עסקה",
    };

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 9900, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
            <div style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 500, maxHeight: "92vh", overflow: "auto", boxShadow: "0 25px 60px rgba(0,0,0,.25)" }}>

                {/* Title */}
                <div style={{ padding: "1.5rem 1.5rem 0", textAlign: "center" }}>
                    <div style={{ fontWeight: 900, fontSize: "1.3rem", color: "#1a1a2e" }}>הגדרת חשבוניות</div>
                    <div style={{ fontSize: "0.82rem", color: "#94a3b8", marginTop: "0.25rem" }}>הגדרה חד-פעמית · לא ניתן לשינוי ללא תמיכה</div>
                </div>

                {/* Step tabs */}
                <div style={{ display: "flex", margin: "1.25rem 1.5rem 0", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
                    {[
                        { num: 1, label: "פרטי העסק" },
                        { num: 2, label: "מספר מסמכים" },
                    ].map(s => (
                        <div key={s.num} style={{
                            flex: 1, padding: "0.7rem", textAlign: "center", fontSize: "0.85rem", fontWeight: 700,
                            background: step === s.num ? "#1a1a2e" : "#f8fafc",
                            color: step === s.num ? "#fff" : "#64748b",
                            cursor: s.num < step ? "pointer" : "default",
                        }} onClick={() => s.num < step && setStep(s.num)}>
                            {s.num}. {s.label}
                        </div>
                    ))}
                </div>

                <div style={{ padding: "1.25rem 1.5rem" }}>
                    {step === 1 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                            <div>
                                <label style={labelStyle}>סוג עסק *</label>
                                <div style={{ display: "flex", gap: "0.4rem" }}>
                                    {BIZ_TYPES.map(b => (
                                        <button key={b.value} type="button" onClick={() => setBizType(b.value)} style={{
                                            flex: 1, padding: "0.5rem 0.4rem", border: `2px solid ${bizType === b.value ? "#1a1a2e" : "#e2e8f0"}`,
                                            borderRadius: 10, background: bizType === b.value ? "#1a1a2e" : "#fff",
                                            color: bizType === b.value ? "#fff" : "#334155",
                                            fontWeight: 700, cursor: "pointer", fontSize: "0.78rem",
                                        }}>{b.label}</button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label style={labelStyle}>שם העסק על המסמכים *</label>
                                <input value={bizName} onChange={e => setBizName(e.target.value)} style={inputStyle} placeholder="שם עסק רשמי" />
                            </div>
                            <div>
                                <label style={labelStyle}>ח.פ / ע.מ *</label>
                                <input value={bizNum} onChange={e => setBizNum(e.target.value)} style={inputStyle} placeholder="313192700" dir="ltr" />
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                                <div><label style={labelStyle}>כתובת</label>
                                    <input value={addr} onChange={e => setAddr(e.target.value)} style={inputStyle} placeholder="הרצל 100" /></div>
                                <div><label style={labelStyle}>עיר</label>
                                    <input value={city} onChange={e => setCity(e.target.value)} style={inputStyle} placeholder="ראשון לציון" /></div>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                                <div><label style={labelStyle}>טלפון</label>
                                    <input value={phone} onChange={e => setPhone(e.target.value)} style={inputStyle} type="tel" placeholder="050..." /></div>
                                <div><label style={labelStyle}>אימייל</label>
                                    <input value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} type="email" placeholder="email@..." /></div>
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div>
                            <div style={{ background: "#f8fafc", borderRadius: 10, padding: "0.85rem 1rem", marginBottom: "1rem", fontSize: "0.82rem", color: "#475569", lineHeight: 1.6 }}>
                                המספר שתגדיר יהיה מספר המסמך הראשון שיצא.<br />
                                <strong>לדוגמה:</strong> אם החשבונית האחרונה הייתה 6001, כתוב/י 6002.
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                                {WIZARD_DOC_TYPES.filter(dt => {
                                    if (bizType === "osek_patur") return ["receipt", "transaction", "credit"].includes(dt);
                                    return true;
                                }).map(dt => (
                                    <div key={dt} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 1rem", background: "#f8fafc", borderRadius: 10 }}>
                                        <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{DOC_LABELS[dt]}</div>
                                        <input
                                            type="number" min="1" value={nums[dt] ?? 1000}
                                            aria-label={`מספר התחלתי עבור ${DOC_LABELS[dt]}`}
                                            title={`מספר התחלתי עבור ${DOC_LABELS[dt]}`}
                                            onChange={e => setNums(p => ({ ...p, [dt]: parseInt(e.target.value) || 1 }))}
                                            style={{ width: 90, padding: "0.4rem 0.6rem", border: "1px solid #e2e8f0", borderRadius: 8, textAlign: "center", fontWeight: 700, fontSize: "1rem" }}
                                            dir="ltr"
                                        />
                                    </div>
                                ))}
                            </div>
                            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "0.75rem 1rem", marginTop: "1rem", fontSize: "0.8rem", color: "#92400e" }}>
                                אם אין כוונה לנהל מלאי או לא ניהלת בעבר, תוכל/י להשאיר את השדות כמו שהם. ניתן לפנות לתמיכה במידה ויבצעו שינויים.
                            </div>
                        </div>
                    )}

                    {err && <div style={{ background: "#fee2e2", color: "#dc2626", borderRadius: 8, padding: "0.6rem 0.8rem", fontSize: "0.82rem", marginTop: "0.75rem" }}>{err}</div>}
                </div>

                {/* Buttons */}
                <div style={{ padding: "0 1.5rem 1.5rem", display: "flex", gap: "0.75rem" }}>
                    {step === 2 && (
                        <button type="button" onClick={() => setStep(1)} style={{
                            flex: 1, background: "#fff", color: "#334155", border: "1.5px solid #e2e8f0",
                            borderRadius: 14, padding: "0.9rem", fontWeight: 700, cursor: "pointer", fontSize: "0.95rem",
                        }}>
                            הקודם
                        </button>
                    )}
                    <button type="button" onClick={step === 1 ? goNext : finish} disabled={saving} style={{
                        flex: 2, background: "#1a1a2e", color: "#fff", border: "none",
                        borderRadius: 14, padding: "0.9rem", fontWeight: 800, cursor: "pointer", fontSize: "0.95rem",
                        opacity: saving ? 0.7 : 1,
                    }}>
                        {saving ? "שומר..." : step === 1 ? "המשך" : "סיים והנעל הגדרות"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Settings Tab ──────────────────────────────────────────────────────────────

function SettingsTab({ settings, onSaved }: { settings: InvoiceSettings; onSaved: () => void }) {
    const locked = settings.settings_completed;

    return (
        <div style={{ padding: "0 1rem 2rem", maxWidth: 540 }}>
            {locked && (
                <div style={{ background: "#fef9c3", border: "1px solid #fde68a", borderRadius: 12, padding: "0.85rem 1rem", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.85rem", color: "#92400e" }}>
                    🔒 <span>הגדרות החשבונית נעולות. לשינוי פנה לתמיכה של BizControl.</span>
                </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                <div>
                    <label style={labelStyle}>סוג עסק</label>
                    <div style={{ ...inputStyle, background: "#f8fafc", color: "#334155" }}>
                        {BIZ_TYPES.find(b => b.value === settings.business_type)?.label || settings.business_type}
                    </div>
                </div>
                <div>
                    <label style={labelStyle}>שם העסק על המסמכים</label>
                    <div style={{ ...inputStyle, background: "#f8fafc", color: "#334155" }}>{settings.business_name || "—"}</div>
                </div>
                <div>
                    <label style={labelStyle}>ח.פ / ע.מ</label>
                    <div style={{ ...inputStyle, background: "#f8fafc", color: "#334155" }}>{settings.business_number || "—"}</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                    <div>
                        <label style={labelStyle}>כתובת</label>
                        <div style={{ ...inputStyle, background: "#f8fafc", color: "#334155" }}>{settings.business_address || "—"}</div>
                    </div>
                    <div>
                        <label style={labelStyle}>עיר</label>
                        <div style={{ ...inputStyle, background: "#f8fafc", color: "#334155" }}>{settings.business_city || "—"}</div>
                    </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                    <div>
                        <label style={labelStyle}>טלפון</label>
                        <div style={{ ...inputStyle, background: "#f8fafc", color: "#334155" }}>{settings.business_phone || "—"}</div>
                    </div>
                    <div>
                        <label style={labelStyle}>אימייל</label>
                        <div style={{ ...inputStyle, background: "#f8fafc", color: "#334155" }}>{settings.business_email || "—"}</div>
                    </div>
                </div>
                {!locked && (
                    <p style={{ color: "#94a3b8", fontSize: "0.8rem" }}>השלם את אשף ההגדרה הראשוני כדי לנעול את הפרטים.</p>
                )}
            </div>
        </div>
    );
}

// ── Series Tab ────────────────────────────────────────────────────────────────

function SeriesTab({ series, locked, onSaved }: { series: SeriesMap; locked: boolean; onSaved: () => void }) {
    return (
        <div style={{ padding: "0 1rem 2rem", maxWidth: 400 }}>
            {locked && (
                <div style={{ background: "#fef9c3", border: "1px solid #fde68a", borderRadius: 12, padding: "0.85rem 1rem", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.85rem", color: "#92400e" }}>
                    🔒 <span>סדרות המסמכים נעולות. לשינוי פנה לתמיכה.</span>
                </div>
            )}
            <p style={{ color: "#64748b", fontSize: "0.85rem", marginBottom: "1rem" }}>
                המספר הנוכחי בכל סדרת מסמכים. לאחר הפקת מסמך, המספר עולה אוטומטית.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {Object.entries(series).map(([key, val]) => (
                    <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 1rem", background: "#f8fafc", borderRadius: 10 }}>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{val.label}</div>
                            <div style={{ fontSize: "0.72rem", color: "#94a3b8" }}>{key}</div>
                        </div>
                        <div style={{ fontWeight: 800, fontSize: "1.1rem", color: "#1a1a2e", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "0.4rem 0.9rem", minWidth: 70, textAlign: "center" }}>
                            {val.next_number}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Reports Tab ───────────────────────────────────────────────────────────────

function ReportsTab() {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (dateFrom) params.set("date_from", dateFrom + "T00:00:00");
            if (dateTo) params.set("date_to", dateTo + "T23:59:59");
            const r = await apiFetch<any>(`/api/invoices/reports/summary?${params}`);
            setData(r);
        } finally { setLoading(false); }
    }, [dateFrom, dateTo]);

    useEffect(() => { load(); }, [load]);

    if (loading) return <div style={{ textAlign: "center", padding: "3rem", color: "#94a3b8" }}>טוען...</div>;
    if (!data) return null;

    return (
        <div style={{ padding: "0 1rem 2rem" }}>
            {/* Date filter */}
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                    style={{ padding: "0.5rem 0.75rem", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.85rem" }} />
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                    style={{ padding: "0.5rem 0.75rem", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.85rem" }} />
                <button type="button" onClick={load} style={{ background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, padding: "0.5rem 1rem", cursor: "pointer", fontSize: "0.85rem" }}>סנן</button>
            </div>

            {/* KPIs */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1.5rem" }}>
                <KpiCard title="הכנסות" value={`₪${data.total_ils.toFixed(2)}`} color="#7c3aed" />
                <KpiCard title={'מע"מ שנגבה'} value={`₪${data.vat_ils.toFixed(2)}`} color="#0ea5e9" />
                <KpiCard title="מסמכים" value={String(data.count)} color="#059669" />
                <KpiCard title="ממוצע עסקה" value={`₪${data.avg_ils.toFixed(2)}`} color="#f59e0b" />
            </div>

            {/* By doc type */}
            <ReportSection title="לפי סוג מסמך" rows={data.by_doc_type} />
            <ReportSection title="לפי אמצעי תשלום" rows={data.by_method} />
            <ReportSection title="הכנסות לפי שירות" rows={data.by_service} />
            <ReportSection title="הכנסות לפי מוצר" rows={data.by_product} />
            <ReportSection title="הכנסות לפי עובד" rows={data.by_employee} />
        </div>
    );
}

function KpiCard({ title, value, color }: { title: string; value: string; color: string }) {
    return (
        <div style={{ background: "#fff", border: "1px solid #f1f5f9", borderRadius: 14, padding: "1rem", borderTop: `3px solid ${color}` }}>
            <div style={{ color: "#64748b", fontSize: "0.78rem", marginBottom: "0.4rem" }}>{title}</div>
            <div style={{ fontWeight: 900, fontSize: "1.25rem", color }}>{value}</div>
        </div>
    );
}

function ReportSection({ title, rows }: { title: string; rows: { label: string; count: number; total_ils: number }[] }) {
    if (!rows || rows.length === 0) return null;
    return (
        <div style={{ marginBottom: "1.5rem" }}>
            <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: "0.5rem", color: "#334155" }}>{title}</div>
            {rows.map((r, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0.75rem", background: i % 2 === 0 ? "#f8fafc" : "#fff", borderRadius: 8, fontSize: "0.85rem" }}>
                    <span>{r.label}</span>
                    <div style={{ display: "flex", gap: "1rem" }}>
                        <span style={{ color: "#64748b" }}>{r.count} מסמכים</span>
                        <span style={{ fontWeight: 700 }}>₪{r.total_ils.toFixed(2)}</span>
                    </div>
                </div>
            ))}
        </div>
    );
}

// ── Shared Styles ─────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
    display: "block", fontSize: "0.8rem", fontWeight: 600,
    color: "#64748b", marginBottom: "0.3rem",
};

const inputStyle: React.CSSProperties = {
    width: "100%", padding: "0.6rem 0.75rem",
    border: "1px solid #e2e8f0", borderRadius: 8,
    fontSize: "0.9rem", outline: "none", boxSizing: "border-box",
};
