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
    client_name?: string;
    client_phone?: string;
    total_cents: number;
    total_ils: number;
    subtotal_ils: number;
    vat_amount_ils: number;
    tip_ils: number;
    vat_rate: number;
    payment_method?: string;
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
    const [showCreate, setShowCreate] = useState(false);
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

    const openPdf = (id: string) => {
        const token = localStorage.getItem("bizcontrol_token") || "";
        window.open(`${process.env.NEXT_PUBLIC_API_URL}/api/invoices/${id}/pdf?token=${token}`, "_blank");
    };

    const createCredit = async (id: string) => {
        if (!confirm("ליצור זיכוי למסמך זה?")) return;
        try {
            await apiFetch(`/api/invoices/${id}/credit`, { method: "POST" });
            loadInvoices();
            setViewInvoice(null);
        } catch (e: unknown) { alert((e as Error).message); }
    };

    return (
        <AppShell title="חשבוניות ומסמכים">
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
                    settings={settings}
                    filterType={filterType} setFilterType={setFilterType}
                    filterDate={filterDate} setFilterDate={setFilterDate}
                    onFilter={loadInvoices}
                    onNew={() => setShowCreate(true)}
                    onView={async (inv) => {
                        const full = await apiFetch<Invoice>(`/api/invoices/${inv.id}`);
                        setViewInvoice(full);
                    }}
                    onPdf={openPdf}
                />
            )}
            {tab === "settings" && settings && (
                <SettingsTab settings={settings} onSaved={loadSettings} />
            )}
            {tab === "series" && (
                <SeriesTab series={series} onSaved={loadSeries} />
            )}
            {tab === "reports" && (
                <ReportsTab />
            )}

            {showCreate && settings && (
                <CreateModal
                    settings={settings}
                    onClose={() => setShowCreate(false)}
                    onCreated={() => { setShowCreate(false); loadInvoices(); }}
                />
            )}

            {viewInvoice && (
                <InvoiceDetailModal
                    invoice={viewInvoice}
                    onClose={() => setViewInvoice(null)}
                    onPdf={() => openPdf(viewInvoice.id)}
                    onCredit={() => createCredit(viewInvoice.id)}
                />
            )}
        </AppShell>
    );
}

// ── Documents Tab ─────────────────────────────────────────────────────────────

function DocumentsTab({ invoices, total, loading, settings, filterType, setFilterType, filterDate, setFilterDate, onFilter, onNew, onView, onPdf }: {
    invoices: Invoice[]; total: number; loading: boolean; settings: InvoiceSettings | null;
    filterType: string; setFilterType: (v: string) => void;
    filterDate: string; setFilterDate: (v: string) => void;
    onFilter: () => void; onNew: () => void;
    onView: (inv: Invoice) => void; onPdf: (id: string) => void;
}) {
    return (
        <div style={{ padding: "0 1rem" }}>
            {/* Toolbar */}
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
                <button type="button" onClick={onNew} style={{
                    background: "#7c3aed", color: "#fff", border: "none", borderRadius: 10,
                    padding: "0.6rem 1.2rem", fontWeight: 700, cursor: "pointer", fontSize: "0.9rem",
                }}>+ מסמך חדש</button>

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

function InvoiceDetailModal({ invoice, onClose, onPdf, onCredit }: {
    invoice: Invoice; onClose: () => void; onPdf: () => void; onCredit: () => void;
}) {
    const isCredit = invoice.doc_type === "credit";
    const canCredit = invoice.status === "issued" && !isCredit;

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 9000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
            <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 560, maxHeight: "90vh", overflow: "auto" }}>
                <div style={{ padding: "1.25rem", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                        <div style={{ fontWeight: 800, fontSize: "1.1rem" }}>{invoice.doc_type_label} #{invoice.doc_number}</div>
                        {invoice.credits_invoice_display && (
                            <div style={{ fontSize: "0.78rem", color: "#dc2626", marginTop: "0.2rem" }}>זיכוי עבור: {invoice.credits_invoice_display}</div>
                        )}
                        {invoice.credited_by_display && (
                            <div style={{ fontSize: "0.78rem", color: "#dc2626", marginTop: "0.2rem" }}>זוכה על ידי: {invoice.credited_by_display}</div>
                        )}
                    </div>
                    <button type="button" onClick={onClose} style={{ background: "none", border: "none", fontSize: "1.4rem", cursor: "pointer", color: "#64748b" }}>×</button>
                </div>

                <div style={{ padding: "1.25rem" }}>
                    {/* Client */}
                    {(invoice.client_name || invoice.client_phone) && (
                        <div style={{ marginBottom: "1rem", padding: "0.75rem", background: "#f8fafc", borderRadius: 10 }}>
                            <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: "0.25rem" }}>לקוח</div>
                            <div style={{ fontSize: "0.85rem", color: "#334155" }}>{invoice.client_name}</div>
                            {invoice.client_phone && <div style={{ fontSize: "0.8rem", color: "#64748b" }}>{invoice.client_phone}</div>}
                        </div>
                    )}

                    {/* Items */}
                    {invoice.items && invoice.items.length > 0 && (
                        <div style={{ marginBottom: "1rem" }}>
                            <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: "0.5rem" }}>פריטים</div>
                            {invoice.items.map((item, i) => (
                                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0", borderBottom: "1px solid #f1f5f9", fontSize: "0.85rem" }}>
                                    <span>{item.description} × {item.quantity}</span>
                                    <span style={{ fontWeight: 700 }}>₪{((item.total_price_cents || 0) / 100).toFixed(2)}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Totals */}
                    <div style={{ background: "#f8fafc", borderRadius: 10, padding: "0.75rem", marginBottom: "1rem" }}>
                        {invoice.vat_amount_ils > 0 && (
                            <>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: "0.35rem" }}>
                                    <span style={{ color: "#64748b" }}>לפני מע"מ</span>
                                    <span>₪{invoice.subtotal_ils.toFixed(2)}</span>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: "0.35rem" }}>
                                    <span style={{ color: "#64748b" }}>מע"מ {invoice.vat_rate}%</span>
                                    <span>₪{invoice.vat_amount_ils.toFixed(2)}</span>
                                </div>
                            </>
                        )}
                        {invoice.tip_ils > 0 && (
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: "0.35rem" }}>
                                <span style={{ color: "#64748b" }}>טיפ</span>
                                <span>₪{invoice.tip_ils.toFixed(2)}</span>
                            </div>
                        )}
                        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: "1rem", paddingTop: "0.35rem", borderTop: "1px solid #e2e8f0" }}>
                            <span>סה"כ</span>
                            <span style={{ color: isCredit ? "#dc2626" : "#111" }}>
                                {isCredit ? "-" : ""}₪{Math.abs(invoice.total_ils).toFixed(2)}
                            </span>
                        </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                        <button type="button" onClick={onPdf} style={{ flex: 1, background: "#7c3aed", color: "#fff", border: "none", borderRadius: 10, padding: "0.75rem", fontWeight: 700, cursor: "pointer" }}>
                            הורד PDF
                        </button>
                        {canCredit && (
                            <button type="button" onClick={onCredit} style={{ flex: 1, background: "#fee2e2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 10, padding: "0.75rem", fontWeight: 700, cursor: "pointer" }}>
                                צור זיכוי
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Create Modal ──────────────────────────────────────────────────────────────

function CreateModal({ settings, onClose, onCreated }: {
    settings: InvoiceSettings; onClose: () => void; onCreated: () => void;
}) {
    const [docType, setDocType] = useState(settings.allowed_doc_types[0] || "receipt");
    const [clientName, setClientName] = useState("");
    const [clientPhone, setClientPhone] = useState("");
    const [clientEmail, setClientEmail] = useState("");
    const [paymentMethod, setPaymentMethod] = useState("cash");
    const [paymentRef, setPaymentRef] = useState("");
    const [notes, setNotes] = useState(settings.default_notes || "");
    const [tipCents, setTipCents] = useState(0);
    const [items, setItems] = useState<InvoiceItem[]>([{ description: "", quantity: 1, unit_price_cents: 0 }]);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const addItem = () => setItems(p => [...p, { description: "", quantity: 1, unit_price_cents: 0 }]);
    const removeItem = (i: number) => setItems(p => p.filter((_, idx) => idx !== i));
    const updateItem = (i: number, field: keyof InvoiceItem, val: string | number) => {
        setItems(p => p.map((it, idx) => idx === i ? { ...it, [field]: val } : it));
    };

    const subtotal = items.reduce((s, it) => s + Math.round(it.quantity * it.unit_price_cents), 0);
    const vat = settings.business_type !== "osek_patur" ? Math.round(subtotal * settings.vat_rate / 100) : 0;
    const total = subtotal + vat + tipCents;

    const submit = async () => {
        if (items.some(it => !it.description || it.unit_price_cents <= 0)) {
            setErr("נא למלא תיאור ומחיר לכל פריט"); return;
        }
        setSaving(true); setErr(null);
        try {
            await apiFetch("/api/invoices", {
                method: "POST",
                body: JSON.stringify({
                    doc_type: docType, client_name: clientName, client_phone: clientPhone,
                    client_email: clientEmail, payment_method: paymentMethod,
                    payment_reference: paymentRef, notes, tip_cents: tipCents,
                    items: items.map(it => ({
                        description: it.description,
                        quantity: it.quantity,
                        unit_price_cents: Math.round(it.unit_price_cents * 100),
                    })),
                }),
            });
            onCreated();
        } catch (e: unknown) { setErr((e as Error).message); }
        finally { setSaving(false); }
    };

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 9000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
            <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 560, maxHeight: "95vh", overflow: "auto" }}>
                <div style={{ padding: "1.25rem", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 800, fontSize: "1.1rem" }}>מסמך חדש</span>
                    <button type="button" onClick={onClose} style={{ background: "none", border: "none", fontSize: "1.4rem", cursor: "pointer", color: "#64748b" }}>×</button>
                </div>

                <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                    {/* Doc type */}
                    <div>
                        <label style={labelStyle}>סוג מסמך</label>
                        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                            {settings.allowed_doc_types.map(t => (
                                <button key={t} type="button" onClick={() => setDocType(t)} style={{
                                    padding: "0.4rem 0.9rem", border: `1px solid ${docType === t ? TYPE_COLOR[t] : "#e2e8f0"}`,
                                    borderRadius: 8, background: docType === t ? TYPE_COLOR[t] : "#fff",
                                    color: docType === t ? "#fff" : "#334155", fontWeight: 600, cursor: "pointer", fontSize: "0.82rem",
                                }}>{DOC_TYPES[t]}</button>
                            ))}
                        </div>
                    </div>

                    {/* Client */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                        <div><label style={labelStyle}>שם לקוח</label>
                            <input value={clientName} onChange={e => setClientName(e.target.value)} style={inputStyle} placeholder="שם מלא" /></div>
                        <div><label style={labelStyle}>טלפון</label>
                            <input value={clientPhone} onChange={e => setClientPhone(e.target.value)} style={inputStyle} placeholder="050..." type="tel" /></div>
                    </div>
                    <div><label style={labelStyle}>אימייל (אופציונלי)</label>
                        <input value={clientEmail} onChange={e => setClientEmail(e.target.value)} style={inputStyle} placeholder="email@..." type="email" /></div>

                    {/* Items */}
                    <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                            <label style={labelStyle}>פריטים</label>
                            <button type="button" onClick={addItem} style={{ background: "none", border: "1px solid #7c3aed", borderRadius: 6, padding: "0.2rem 0.6rem", color: "#7c3aed", cursor: "pointer", fontSize: "0.8rem" }}>+ הוסף</button>
                        </div>
                        {items.map((it, i) => (
                            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 60px 90px 28px", gap: "0.4rem", marginBottom: "0.4rem", alignItems: "center" }}>
                                <input value={it.description} onChange={e => updateItem(i, "description", e.target.value)}
                                    placeholder="תיאור" style={{ ...inputStyle, fontSize: "0.82rem" }} />
                                <input value={it.quantity} type="number" min="0.01" step="0.01"
                                    onChange={e => updateItem(i, "quantity", parseFloat(e.target.value) || 1)}
                                    style={{ ...inputStyle, fontSize: "0.82rem" }} />
                                <input value={it.unit_price_cents || ""} type="number" min="0"
                                    placeholder="מחיר ₪"
                                    onChange={e => updateItem(i, "unit_price_cents", parseFloat(e.target.value) || 0)}
                                    style={{ ...inputStyle, fontSize: "0.82rem" }} />
                                {items.length > 1 && (
                                    <button type="button" onClick={() => removeItem(i)} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: "1rem" }}>×</button>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Payment */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                        <div><label style={labelStyle}>אמצעי תשלום</label>
                            <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} style={inputStyle}>
                                {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                            </select></div>
                        <div><label style={labelStyle}>אסמכתה</label>
                            <input value={paymentRef} onChange={e => setPaymentRef(e.target.value)} style={inputStyle} placeholder="מספר עסקה..." /></div>
                    </div>

                    {/* Tip */}
                    <div><label style={labelStyle}>טיפ (₪)</label>
                        <input value={tipCents / 100 || ""} type="number" min="0"
                            onChange={e => setTipCents(Math.round((parseFloat(e.target.value) || 0) * 100))}
                            style={inputStyle} placeholder="0" /></div>

                    {/* Notes */}
                    <div><label style={labelStyle}>הערות</label>
                        <textarea value={notes} onChange={e => setNotes(e.target.value)} style={{ ...inputStyle, height: 60, resize: "vertical" }} /></div>

                    {/* Summary */}
                    <div style={{ background: "#f8fafc", borderRadius: 10, padding: "0.75rem", fontSize: "0.85rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem", color: "#64748b" }}>
                            <span>לפני מע"מ</span><span>₪{(subtotal / 100).toFixed(2)}</span>
                        </div>
                        {vat > 0 && (
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem", color: "#64748b" }}>
                                <span>מע"מ {settings.vat_rate}%</span><span>₪{(vat / 100).toFixed(2)}</span>
                            </div>
                        )}
                        {tipCents > 0 && (
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem", color: "#64748b" }}>
                                <span>טיפ</span><span>₪{(tipCents / 100).toFixed(2)}</span>
                            </div>
                        )}
                        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: "1rem", borderTop: "1px solid #e2e8f0", paddingTop: "0.35rem" }}>
                            <span>סה"כ</span><span>₪{(total / 100).toFixed(2)}</span>
                        </div>
                    </div>

                    {err && <p style={{ color: "#dc2626", fontSize: "0.82rem" }}>{err}</p>}

                    <button type="button" onClick={submit} disabled={saving} style={{
                        background: "#7c3aed", color: "#fff", border: "none", borderRadius: 12,
                        padding: "0.85rem", fontWeight: 800, fontSize: "0.95rem", cursor: "pointer",
                    }}>
                        {saving ? "מפיק..." : "הפק מסמך"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Settings Tab ──────────────────────────────────────────────────────────────

function SettingsTab({ settings, onSaved }: { settings: InvoiceSettings; onSaved: () => void }) {
    const [form, setForm] = useState({ ...settings });
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    const save = async () => {
        setSaving(true);
        try {
            await apiFetch("/api/invoices/settings", { method: "PUT", body: JSON.stringify(form) });
            onSaved(); setSaved(true); setTimeout(() => setSaved(false), 2000);
        } finally { setSaving(false); }
    };

    const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
        setForm(p => ({ ...p, [k]: e.target.value }));

    return (
        <div style={{ padding: "0 1rem 2rem", maxWidth: 540 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                <div>
                    <label style={labelStyle}>סוג עסק</label>
                    <select value={form.business_type} onChange={f("business_type")} style={inputStyle}>
                        {BIZ_TYPES.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                    </select>
                </div>
                <div>
                    <label style={labelStyle}>שם העסק על המסמכים</label>
                    <input value={form.business_name || ""} onChange={f("business_name")} style={inputStyle} placeholder="שם עסק רשמי" />
                </div>
                <div>
                    <label style={labelStyle}>ח.פ / ע.מ</label>
                    <input value={form.business_number || ""} onChange={f("business_number")} style={inputStyle} placeholder="מספר עוסק" />
                </div>
                <div>
                    <label style={labelStyle}>שיעור מע"מ (%)</label>
                    <input value={form.vat_rate} onChange={f("vat_rate")} style={inputStyle} type="number" step="0.01" min="0" max="100" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                    <div><label style={labelStyle}>כתובת</label>
                        <input value={form.business_address || ""} onChange={f("business_address")} style={inputStyle} placeholder="רחוב ומספר" /></div>
                    <div><label style={labelStyle}>עיר</label>
                        <input value={form.business_city || ""} onChange={f("business_city")} style={inputStyle} placeholder="עיר" /></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                    <div><label style={labelStyle}>טלפון</label>
                        <input value={form.business_phone || ""} onChange={f("business_phone")} style={inputStyle} type="tel" /></div>
                    <div><label style={labelStyle}>אימייל</label>
                        <input value={form.business_email || ""} onChange={f("business_email")} style={inputStyle} type="email" /></div>
                </div>
                <div>
                    <label style={labelStyle}>תנאי תשלום (ברירת מחדל)</label>
                    <input value={form.payment_terms || ""} onChange={f("payment_terms")} style={inputStyle} placeholder="לדוגמה: שוטף + 30" />
                </div>
                <div>
                    <label style={labelStyle}>הערות ברירת מחדל</label>
                    <textarea value={form.default_notes || ""} onChange={f("default_notes")} style={{ ...inputStyle, height: 60, resize: "vertical" }} />
                </div>

                <button type="button" onClick={save} disabled={saving} style={{
                    background: saving ? "#a78bfa" : "#7c3aed", color: "#fff", border: "none",
                    borderRadius: 12, padding: "0.85rem", fontWeight: 800, cursor: "pointer",
                }}>
                    {saved ? "✓ נשמר" : saving ? "שומר..." : "שמור הגדרות"}
                </button>
            </div>
        </div>
    );
}

// ── Series Tab ────────────────────────────────────────────────────────────────

function SeriesTab({ series, onSaved }: { series: SeriesMap; onSaved: () => void }) {
    const [nums, setNums] = useState<Record<string, number>>({});
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        const init: Record<string, number> = {};
        Object.entries(series).forEach(([k, v]) => { init[k] = v.next_number; });
        setNums(init);
    }, [series]);

    const save = async () => {
        setSaving(true);
        try {
            const items = Object.entries(nums).map(([doc_type, next_number]) => ({ doc_type, next_number }));
            await apiFetch("/api/invoices/series", { method: "PUT", body: JSON.stringify(items) });
            onSaved(); setSaved(true); setTimeout(() => setSaved(false), 2000);
        } finally { setSaving(false); }
    };

    return (
        <div style={{ padding: "0 1rem 2rem", maxWidth: 400 }}>
            <p style={{ color: "#64748b", fontSize: "0.85rem", marginBottom: "1rem" }}>
                המספר הבא שיוקצה לכל סוג מסמך. לאחר הפקת מסמך, המספר עולה אוטומטית.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.25rem" }}>
                {Object.entries(series).map(([key, val]) => (
                    <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem", background: "#f8fafc", borderRadius: 10 }}>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{val.label}</div>
                            <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{key}</div>
                        </div>
                        <input
                            type="number" min="1" value={nums[key] ?? val.next_number}
                            onChange={e => setNums(p => ({ ...p, [key]: parseInt(e.target.value) || 1 }))}
                            style={{ width: 90, padding: "0.4rem 0.6rem", border: "1px solid #e2e8f0", borderRadius: 8, textAlign: "center", fontWeight: 700 }}
                        />
                    </div>
                ))}
            </div>
            <button type="button" onClick={save} disabled={saving} style={{
                background: "#7c3aed", color: "#fff", border: "none", borderRadius: 12,
                padding: "0.85rem", fontWeight: 800, cursor: "pointer", width: "100%",
            }}>
                {saved ? "✓ נשמר" : saving ? "שומר..." : "שמור סדרות"}
            </button>
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
                <KpiCard title="מע\"מ שנגבה" value={`₪${data.vat_ils.toFixed(2)}`} color="#0ea5e9" />
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
