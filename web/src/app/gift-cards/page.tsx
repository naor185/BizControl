"use client";
import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";

interface GiftCard {
    id: string;
    code: string;
    amount_ils: number;
    balance_ils: number;
    used_ils: number;
    pct_used: number;
    recipient_name: string;
    recipient_email?: string;
    recipient_phone?: string;
    personal_message?: string;
    status: string;
    expires_at?: string;
    is_expired: boolean;
    created_at: string;
    buyer_name?: string;
    buyer_email?: string;
    buyer_phone?: string;
    deliver_to?: string;
    bonus_ils?: number;
}

const STATUS: Record<string, { label: string; cls: string }> = {
    active:          { label: "פעיל",           cls: "bg-emerald-100 text-emerald-700" },
    used:            { label: "נוצל",           cls: "bg-slate-100 text-slate-500" },
    canceled:        { label: "בוטל",          cls: "bg-rose-100 text-rose-600" },
    expired:         { label: "פג תוקף",        cls: "bg-amber-100 text-amber-700" },
    pending_payment: { label: "ממתין לתשלום",  cls: "bg-amber-100 text-amber-700" },
};

export default function GiftCardsPage() {
    const [cards, setCards] = useState<GiftCard[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [filterStatus, setFilterStatus] = useState("");
    const [selected, setSelected] = useState<GiftCard | null>(null);
    const [pageViews, setPageViews] = useState<{ last_7_days: number; last_30_days: number; total: number } | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (filterStatus) params.set("status", filterStatus);
            const data = await apiFetch<GiftCard[]>(`/api/gift-cards?${params}`);
            setCards(data);
        } finally { setLoading(false); }
    }, [filterStatus]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        apiFetch<{ last_7_days: number; last_30_days: number; total: number }>("/api/gift-cards/page-views")
            .then(setPageViews)
            .catch(() => {});
    }, []);

    const cancel = async (id: string) => {
        if (!confirm("לבטל כרטיס זה?")) return;
        try {
            await apiFetch(`/api/gift-cards/${id}/cancel`, { method: "POST" });
            load();
            setSelected(null);
        } catch (e: unknown) { alert((e as Error).message); }
    };

    const deleteCard = async (id: string) => {
        if (!confirm("למחוק את הכרטיס לצמיתות? הפעולה בלתי הפיכה ותמחק גם את היסטוריית המימושים שלו.")) return;
        try {
            await apiFetch(`/api/gift-cards/${id}`, { method: "DELETE" });
            load();
            setSelected(null);
        } catch (e: unknown) { alert((e as Error).message); }
    };

    const approvePayment = async (id: string, sendReceipt: boolean) => {
        if (!confirm("לאשר שהתשלום התקבל ולשלוח את השובר?")) return;
        try {
            await apiFetch(`/api/gift-cards/${id}/approve-payment`, {
                method: "POST",
                body: JSON.stringify({ send_receipt: sendReceipt }),
            });
            load();
            setSelected(null);
        } catch (e: unknown) { alert((e as Error).message); }
    };

    const totals = {
        issued: cards.reduce((s, c) => s + c.amount_ils, 0),
        balance: cards.filter(c => c.status === "active").reduce((s, c) => s + c.balance_ils, 0),
        used: cards.reduce((s, c) => s + c.used_ils, 0),
        pending: cards.filter(c => c.status === "pending_payment").length,
        active: cards.filter(c => c.status === "active").length,
    };

    return (
        <RequireAuth>
            <AppShell title="🎁 כרטיסי מתנה">
                <div className="space-y-5 pb-12">

                    {/* Summary strip */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        {[
                            { label: "ממתינות לאישור", value: totals.pending, icon: "⏳", highlight: totals.pending > 0 },
                            { label: "כרטיסים פעילים", value: totals.active, icon: "🎁" },
                            { label: "יתרה פתוחה", value: `₪${totals.balance.toFixed(0)}`, icon: "💳" },
                            { label: "סה״כ נוצל", value: `₪${totals.used.toFixed(0)}`, icon: "✅" },
                            { label: "סה״כ הונפק", value: `₪${totals.issued.toFixed(0)}`, icon: "📊" },
                        ].map(({ label, value, icon, highlight }) => (
                            <div key={label} className={`bg-white rounded-xl border shadow-sm p-4 ${highlight ? "border-amber-300 ring-1 ring-amber-200" : "border-slate-100"}`}>
                                <div className="text-xl mb-1">{icon}</div>
                                <div className="text-xl font-black text-slate-800">{value}</div>
                                <div className="text-xs text-slate-400 mt-0.5">{label}</div>
                            </div>
                        ))}
                    </div>

                    {pageViews && (
                        <div className="text-xs text-slate-400 bg-white rounded-xl border border-slate-100 px-4 py-2.5 flex flex-wrap gap-x-4 gap-y-1">
                            <span>👁️ ביקורים בדף הרכישה:</span>
                            <span className="font-bold text-slate-600">{pageViews.last_7_days} ב-7 ימים</span>
                            <span className="font-bold text-slate-600">{pageViews.last_30_days} ב-30 יום</span>
                            <span className="font-bold text-slate-600">{pageViews.total} סה״כ</span>
                        </div>
                    )}

                    {/* Toolbar */}
                    <div className="flex gap-2 flex-wrap items-center">
                        <button type="button" onClick={() => setShowCreate(true)}
                            className="bg-violet-600 hover:bg-violet-700 text-white font-bold text-sm px-4 py-2 rounded-xl transition-colors">
                            + כרטיס מתנה חדש
                        </button>
                        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                            className="text-sm border border-slate-200 rounded-xl px-3 py-2 outline-none">
                            <option value="">כל הסטטוסים</option>
                            <option value="pending_payment">ממתין לתשלום</option>
                            <option value="active">פעיל</option>
                            <option value="used">נוצל</option>
                            <option value="canceled">בוטל</option>
                        </select>
                        <span className="text-xs text-slate-400 mr-auto">{cards.length} כרטיסים</span>
                    </div>

                    {/* List */}
                    {loading ? (
                        <div className="flex justify-center py-16">
                            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-violet-600" />
                        </div>
                    ) : cards.length === 0 ? (
                        <div className="text-center py-16 text-slate-400">
                            <div className="text-4xl mb-3">🎁</div>
                            <div>אין כרטיסי מתנה עדיין</div>
                        </div>
                    ) : (
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                            <table className="w-full text-right text-sm">
                                <thead>
                                    <tr className="bg-slate-50 text-slate-500 text-xs font-bold border-b">
                                        <th className="px-4 py-3">קוד</th>
                                        <th className="px-4 py-3">נמען</th>
                                        <th className="px-4 py-3 text-center">סכום</th>
                                        <th className="px-4 py-3 text-center">יתרה</th>
                                        <th className="px-4 py-3 text-center">סטטוס</th>
                                        <th className="px-4 py-3">תאריך</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {cards.map(c => {
                                        const st = c.is_expired ? STATUS.expired : STATUS[c.status] || STATUS.active;
                                        return (
                                            <tr key={c.id} onClick={() => setSelected(c)}
                                                className="hover:bg-slate-50/60 cursor-pointer transition-colors">
                                                <td className="px-4 py-3">
                                                    <code className="text-xs font-bold text-violet-700 bg-violet-50 px-2 py-0.5 rounded-lg">{c.code}</code>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="font-semibold text-slate-800">{c.recipient_name}</div>
                                                    {c.recipient_email && <div className="text-xs text-slate-400">{c.recipient_email}</div>}
                                                </td>
                                                <td className="px-4 py-3 text-center font-bold">₪{c.amount_ils.toFixed(0)}</td>
                                                <td className="px-4 py-3 text-center">
                                                    <div className={`font-bold ${c.balance_ils > 0 ? "text-emerald-600" : "text-slate-400"}`}>
                                                        ₪{c.balance_ils.toFixed(0)}
                                                    </div>
                                                    {c.pct_used > 0 && (
                                                        <div className="w-full bg-slate-100 rounded-full h-1.5 mt-1">
                                                            <div className="bg-violet-500 h-1.5 rounded-full" style={{ width: `${c.pct_used}%` }} />
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                                                </td>
                                                <td className="px-4 py-3 text-xs text-slate-400">
                                                    {new Date(c.created_at).toLocaleDateString("he-IL")}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {showCreate && (
                    <CreateModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />
                )}
                {selected && (
                    <DetailModal
                        card={selected}
                        onClose={() => setSelected(null)}
                        onCancel={() => cancel(selected.id)}
                        onApprove={(sendReceipt) => approvePayment(selected.id, sendReceipt)}
                        onDelete={() => deleteCard(selected.id)}
                    />
                )}
            </AppShell>
        </RequireAuth>
    );
}

// ── Create Modal ──────────────────────────────────────────────────────────────

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
    const [amount, setAmount] = useState("");
    const [recipientName, setRecipientName] = useState("");
    const [recipientEmail, setRecipientEmail] = useState("");
    const [recipientPhone, setRecipientPhone] = useState("");
    const [message, setMessage] = useState("");
    const [expiresAt, setExpiresAt] = useState("");
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [created, setCreated] = useState<{ code: string; amount_ils: number } | null>(null);

    const submit = async () => {
        const cents = Math.round(parseFloat(amount) * 100);
        if (!cents || cents < 100) { setErr("סכום מינימלי ₪1"); return; }
        if (!recipientName.trim()) { setErr("שם הנמען נדרש"); return; }
        setSaving(true); setErr(null);
        try {
            const card = await apiFetch<{ code: string; amount_ils: number }>("/api/gift-cards", {
                method: "POST",
                body: JSON.stringify({
                    amount_cents: cents,
                    recipient_name: recipientName.trim(),
                    recipient_email: recipientEmail.trim() || undefined,
                    recipient_phone: recipientPhone.trim() || undefined,
                    personal_message: message.trim() || undefined,
                    expires_at: expiresAt || undefined,
                }),
            });
            setCreated(card);
        } catch (e: unknown) { setErr((e as Error).message); }
        finally { setSaving(false); }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
            <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-auto max-h-[95vh]">
                <div className="p-6">
                    <div className="flex justify-between items-center mb-5">
                        <h2 className="text-lg font-black">🎁 כרטיס מתנה חדש</h2>
                        <button type="button" onClick={created ? onCreated : onClose}
                            className="text-slate-400 hover:text-slate-600 text-xl font-bold">×</button>
                    </div>

                    {created ? (
                        <div className="text-center py-4">
                            <div className="text-5xl mb-4">🎉</div>
                            <h3 className="text-lg font-black mb-2">הכרטיס נוצר בהצלחה!</h3>
                            <div className="bg-violet-50 border-2 border-violet-200 rounded-2xl p-5 my-4">
                                <div className="text-xs text-violet-500 uppercase tracking-widest mb-2">קוד המימוש</div>
                                <div className="text-3xl font-black text-violet-700 tracking-widest font-mono">{created.code}</div>
                                <div className="text-slate-500 text-sm mt-2">שווי: ₪{created.amount_ils.toFixed(0)}</div>
                            </div>
                            {recipientEmail && (
                                <p className="text-sm text-emerald-600 font-semibold">✅ נשלח למייל {recipientEmail}</p>
                            )}
                            <button type="button" onClick={onCreated}
                                className="mt-4 w-full bg-violet-600 text-white font-bold py-3 rounded-2xl">
                                סגור
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div>
                                <label className={lbl}>סכום הכרטיס (₪) *</label>
                                <input value={amount} onChange={e => setAmount(e.target.value)} type="number"
                                    min="1" placeholder="200" className={inp} dir="ltr" />
                            </div>
                            <div>
                                <label className={lbl}>שם הנמען *</label>
                                <input value={recipientName} onChange={e => setRecipientName(e.target.value)}
                                    placeholder="שם מלא" className={inp} />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className={lbl}>אימייל (לשליחה)</label>
                                    <input value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)}
                                        type="email" placeholder="email@..." className={inp} dir="ltr" />
                                </div>
                                <div>
                                    <label className={lbl}>טלפון</label>
                                    <input value={recipientPhone} onChange={e => setRecipientPhone(e.target.value)}
                                        type="tel" placeholder="050..." className={inp} dir="ltr" />
                                </div>
                            </div>
                            <div>
                                <label className={lbl}>הודעה אישית</label>
                                <textarea value={message} onChange={e => setMessage(e.target.value)}
                                    rows={2} placeholder="ברכה לנמען..." className={inp + " resize-none"} />
                            </div>
                            <div>
                                <label className={lbl}>תוקף עד (אופציונלי)</label>
                                <input value={expiresAt} onChange={e => setExpiresAt(e.target.value)}
                                    type="date" className={inp} />
                            </div>
                            {err && <p className="text-rose-600 text-sm">{err}</p>}
                            <button type="button" onClick={submit} disabled={saving}
                                className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white font-bold py-3 rounded-2xl transition-colors mt-2">
                                {saving ? "יוצר..." : "✨ צור כרטיס מתנה"}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Detail Modal ──────────────────────────────────────────────────────────────

function DetailModal({ card, onClose, onCancel, onApprove, onDelete }: { card: GiftCard; onClose: () => void; onCancel: () => void; onApprove: (sendReceipt: boolean) => void; onDelete: () => void }) {
    const st = card.is_expired ? STATUS.expired : STATUS[card.status] || STATUS.active;
    const isPending = card.status === "pending_payment";
    const canCancel = (card.status === "active" && !card.is_expired) || isPending;
    const [sendReceipt, setSendReceipt] = useState(true);

    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
            <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-auto max-h-[92vh]">
                <div className="p-6">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-base font-black">פרטי כרטיס</h2>
                        <button type="button" onClick={onClose} className="text-slate-400 text-xl font-bold">×</button>
                    </div>

                    <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4 text-center mb-4">
                        <code className="text-xl font-black text-violet-700 tracking-widest">{card.code}</code>
                        <div className="flex justify-center gap-2 mt-2">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                        </div>
                    </div>

                    <div className="space-y-2 text-sm mb-4">
                        <Row label="נמען" value={card.recipient_name} />
                        {card.recipient_email && <Row label="אימייל" value={card.recipient_email} />}
                        {card.recipient_phone && <Row label="טלפון" value={card.recipient_phone} />}
                        <Row label="סכום מקורי" value={`₪${card.amount_ils.toFixed(0)}`} />
                        {!!card.bonus_ils && card.bonus_ils > 0 && (
                            <Row label="כולל בונוס" value={`₪${card.bonus_ils.toFixed(0)} 🎉`} />
                        )}
                        <Row label="יתרה" value={`₪${card.balance_ils.toFixed(0)}`} bold />
                        <Row label="נוצל" value={`₪${card.used_ils.toFixed(0)}`} />
                        {card.expires_at && <Row label="תוקף" value={new Date(card.expires_at).toLocaleDateString("he-IL")} />}
                        <Row label="הונפק" value={new Date(card.created_at).toLocaleDateString("he-IL")} />
                    </div>

                    {card.personal_message && (
                        <div className="bg-slate-50 rounded-xl p-3 text-sm text-slate-600 italic mb-4">
                            "{card.personal_message}"
                        </div>
                    )}

                    {isPending && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 space-y-2 text-sm">
                            <div className="font-bold text-amber-700 mb-1">פרטי הקונה — הזמנה מהחנות הציבורית</div>
                            {card.buyer_name && <Row label="שם הקונה" value={card.buyer_name} />}
                            {card.buyer_phone && <Row label="טלפון הקונה" value={card.buyer_phone} />}
                            {card.buyer_email && <Row label="אימייל הקונה" value={card.buyer_email} />}
                            <Row label="השובר יישלח אל" value={card.deliver_to === "recipient" ? "הנמען/ת ישירות" : "הקונה"} bold />
                        </div>
                    )}

                    {isPending && (
                        <>
                            <button
                                type="button"
                                onClick={() => setSendReceipt(v => !v)}
                                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-colors mb-2 ${sendReceipt ? "bg-sky-50 border-sky-200" : "bg-slate-50 border-slate-200"}`}
                            >
                                <span className={`text-xs font-bold ${sendReceipt ? "text-sky-700" : "text-slate-500"}`}>
                                    {sendReceipt ? "📨 שלח קבלה ללקוח" : "🔕 לא לשלוח קבלה ללקוח"}
                                </span>
                                <div className={`relative w-9 h-5 rounded-full transition-colors ${sendReceipt ? "bg-sky-500" : "bg-slate-300"}`}>
                                    <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${sendReceipt ? "right-0.5" : "left-0.5"}`} />
                                </div>
                            </button>
                            <button type="button" onClick={() => onApprove(sendReceipt)}
                                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl text-sm transition-colors mb-2">
                                ✅ אשר תשלום ושלח שובר
                            </button>
                        </>
                    )}

                    {canCancel && (
                        <button type="button" onClick={onCancel}
                            className="w-full bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold py-2.5 rounded-xl text-sm transition-colors mb-2">
                            {isPending ? "דחה/בטל הזמנה" : "ביטול כרטיס"}
                        </button>
                    )}

                    <button type="button" onClick={onDelete}
                        className="w-full text-rose-400 hover:text-rose-600 font-semibold py-2 rounded-xl text-xs transition-colors">
                        🗑️ מחק לצמיתות (לניקוי בדיקות)
                    </button>
                </div>
            </div>
        </div>
    );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
    return (
        <div className="flex justify-between">
            <span className="text-slate-400">{label}</span>
            <span className={bold ? "font-bold text-emerald-700" : "text-slate-700"}>{value}</span>
        </div>
    );
}

const lbl = "block text-xs font-semibold text-slate-500 mb-1";
const inp = "w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-400";
