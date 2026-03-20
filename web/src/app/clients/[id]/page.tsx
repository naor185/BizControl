"use client";

import { useEffect, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";

type ClientBasic = {
    id: string;
    full_name: string;
    phone?: string | null;
    email?: string | null;
    notes?: string | null;
    created_at: string;
};

type LedgerItem = {
    id: string;
    delta_points: number;
    reason: string | null;
    created_at: string;
};

type MessageItem = {
    id: string;
    channel: string;
    to_phone: string;
    body: string;
    status: string;
    created_at: string;
};

type ClientProfile = {
    client: ClientBasic;
    points_balance: number;
    ledger: LedgerItem[];
    messages: MessageItem[];
    total_paid_cents: number;
    total_refund_cents: number;
    net_paid_cents: number;
    total_appointments_cents: number;
    remaining_balance_cents: number;
};

type Appointment = {
    id: string;
    title: string;
    starts_at: string;
    ends_at: string;
    status: string;
    artist_name?: string | null;
    total_price_cents: number;
    deposit_amount_cents: number;
};

import { useParams } from "next/navigation";

export default function ClientProfilePage() {
    const params = useParams();
    const id = params?.id as string;

    const [profile, setProfile] = useState<ClientProfile | null>(null);
    const [appointments, setAppointments] = useState<Appointment[]>([]);
    const [err, setErr] = useState<string | null>(null);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [selectedApptId, setSelectedApptId] = useState<string>("");
    const [paymentAmount, setPaymentAmount] = useState<string>("");
    const [paymentMethod, setPaymentMethod] = useState<string>("cash");
    const [paymentType, setPaymentType] = useState<string>("payment");
    const [paymentNotes, setPaymentNotes] = useState<string>("");
    const [pointsRedeemed, setPointsRedeemed] = useState<string>("0");
    const [isSavingPayment, setIsSavingPayment] = useState(false);
    const [isApptModalOpen, setIsApptModalOpen] = useState(false);

    const loadData = async () => {
        if (!id) return;
        try {
            setErr(null);
            const [profData, apptsData] = await Promise.all([
                apiFetch<ClientProfile>(`/api/clients/${id}/profile`, { method: "GET" }),
                apiFetch<Appointment[]>(`/api/appointments?client_id=${id}`, { method: "GET" })
            ]);
            setProfile(profData);
            setAppointments(apptsData);
        } catch (e: any) {
            setErr(e?.message || "שגיאה בטעינת פרופיל לקוח");
        }
    };

    useEffect(() => {
        loadData();
    }, [id]);

    const handleSavePayment = async () => {
        if (!selectedApptId || !paymentAmount) {
            alert("יש להזין סכום ולבחור תור");
            return;
        }
        try {
            setIsSavingPayment(true);
            await apiFetch("/api/payments", {
                method: "POST",
                body: JSON.stringify({
                    appointment_id: selectedApptId,
                    client_id: id,
                    amount_cents: Math.round(parseFloat(paymentAmount || "0") * 100),
                    points_redeemed: parseInt(pointsRedeemed || "0", 10),
                    currency: "ILS",
                    type: paymentType,
                    method: paymentMethod,
                    status: "paid",
                    notes: paymentNotes
                })
            });
            setIsPaymentModalOpen(false);
            setPaymentAmount("");
            setPointsRedeemed("0");
            setPaymentNotes("");
            loadData();
        } catch (e: any) {
            alert(e?.message || "שגיאה בשמירת תשלום");
        } finally {
            setIsSavingPayment(false);
        }
    };

    const handleDeleteAppt = async (apptId: string) => {
        if (!confirm("האם אתה בטוח שברצונך למחוק תור זה? הפעולה אינה הפיכה.")) return;
        try {
            await apiFetch(`/api/appointments/${apptId}?hard_delete=true`, { method: "DELETE" });
            loadData();
        } catch (e: any) {
            alert(e?.message || "שגיאה במחיקת התור");
        }
    };

    return (
        <RequireAuth>
            <AppShell title="פרופיל CRM לקוח">
                {err && (
                    <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                        {err}
                    </div>
                )}

                {!err && !profile && <div className="text-sm text-gray-500">טוען נתונים מה-CRM...</div>}

                {profile && (
                    <div className="grid gap-6 lg:grid-cols-3">
                        {/* Right Column: Profile Info & Stats */}
                        <div className="lg:col-span-1 space-y-6">
                            <div className="rounded-xl border bg-white p-5 shadow-sm">
                                <div className="text-xl font-bold">{profile.client.full_name || "לקוח ללא שם"}</div>
                                <div className="text-xs text-gray-400 mt-1">
                                    לקוח/ה מאז: {new Date(profile.client.created_at).toLocaleDateString("he-IL")}
                                </div>

                                <div className="mt-5 space-y-3 text-sm">
                                    <div className="flex flex-col">
                                        <span className="text-gray-500 text-xs">טלפון</span>
                                        <span className="font-medium" dir="ltr">{profile.client.phone || "לא הוזן"}</span>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-gray-500 text-xs">אימייל</span>
                                        <span className="font-medium" dir="ltr">{profile.client.email || "לא הוזן"}</span>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-gray-500 text-xs">הערות פנימיות</span>
                                        <span className="font-medium">{profile.client.notes || "אין הערות"}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="rounded-xl border bg-gradient-to-br from-green-50 to-emerald-50 p-4 shadow-sm border-green-100">
                                    <div className="text-xs text-green-700 font-medium">יתרה לתשלום</div>
                                    <div className="text-2xl font-black mt-1 text-rose-600" dir="ltr">
                                        {((profile.remaining_balance_cents || 0) / 100).toLocaleString("he-IL", { style: "currency", currency: "ILS" })}
                                    </div>
                                </div>
                                <div className="rounded-xl border bg-gradient-to-br from-blue-50 to-indigo-50 p-4 shadow-sm border-blue-100">
                                    <div className="text-xs text-blue-700 font-medium">סה"כ שולם נטו</div>
                                    <div className="text-2xl font-black mt-1 text-emerald-700" dir="ltr">
                                        {((profile.net_paid_cents || 0) / 100).toLocaleString("he-IL", { style: "currency", currency: "ILS" })}
                                    </div>
                                </div>
                                <div className="rounded-xl border bg-slate-50 p-4 shadow-sm border-slate-200">
                                    <div className="text-xs text-slate-500 font-medium">נקודות במועדון</div>
                                    <div className="text-2xl font-bold mt-1 text-slate-800">{profile.points_balance}</div>
                                </div>
                                <div className="rounded-xl border bg-slate-50 p-4 shadow-sm border-slate-200">
                                    <div className="text-xs text-slate-500 font-medium">סה"כ ביקורים</div>
                                    <div className="text-2xl font-bold mt-1 text-slate-800">
                                        {appointments.filter(a => a.status === 'completed' || a.status === 'done').length}
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={() => {
                                    setIsPaymentModalOpen(true);
                                    if (appointments.length > 0) setSelectedApptId(appointments[0].id);
                                }}
                                className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl shadow-lg shadow-emerald-200 transition-all flex items-center justify-center gap-2"
                            >
                                <span>💳</span>
                                הקלטת תשלום חדש
                            </button>
                        </div>

                        {/* Left Column: History (Appts, Messages, Points) */}
                        <div className="lg:col-span-2 space-y-6">

                            {/* Appointments */}
                            <div className="rounded-xl border bg-white p-5 shadow-sm">
                                <div className="flex justify-between items-center mb-4 border-b pb-2">
                                    <h3 className="text-lg font-semibold">היסטוריית תורים</h3>
                                    <button
                                        onClick={() => setIsApptModalOpen(true)}
                                        className="text-sm text-emerald-600 hover:text-emerald-700 font-bold bg-emerald-50 px-3 py-1.5 rounded-lg transition-colors"
                                    >
                                        הצג הכל 📅
                                    </button>
                                </div>
                                <div className="text-sm text-gray-500">
                                    {appointments.length} תורים מתועדים במערכת. לחץ על הכפתור כדי לראות את כולם.
                                </div>
                            </div>

                            {/* Messages */}
                            <div className="rounded-xl border bg-white p-5 shadow-sm">
                                <h3 className="text-lg font-semibold mb-4 border-b pb-2">לוג הודעות שנשלחו</h3>
                                <div className="space-y-2">
                                    {profile.messages.length === 0 ? (
                                        <div className="text-sm text-gray-500">לא נשלחו הודעות.</div>
                                    ) : (
                                        profile.messages.map((m) => {
                                            const icon = m.channel === 'whatsapp' ? '💬' : m.channel === 'sms' ? '📱' : '✉️';
                                            const channelName = m.channel === 'whatsapp' ? 'WhatsApp' : m.channel === 'sms' ? 'SMS' : 'Email';
                                            return (
                                                <div key={m.id} className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50 text-sm hover:border-slate-200 transition-colors">
                                                    <div className="flex items-center gap-3">
                                                        <div className="text-xl">{icon}</div>
                                                        <div>
                                                            <div className="font-bold text-slate-700">{channelName}</div>
                                                            <div className="text-[11px] text-slate-400">{new Date(m.created_at).toLocaleString("he-IL")}</div>
                                                        </div>
                                                    </div>
                                                    <div className="text-xs font-medium px-2 py-1 rounded-md bg-emerald-100 text-emerald-700">
                                                        {m.status === 'pending' ? 'ממתין לשליחה...' : 'נשלח מעולה בהצלחה רבה'}
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>

                            {/* Ledger */}
                            <div className="rounded-xl border bg-white p-5 shadow-sm">
                                <h3 className="text-lg font-semibold mb-4 border-b pb-2">תנועות ועו״ש מועדון</h3>
                                <div className="space-y-3">
                                    {profile.ledger.length === 0 ? (
                                        <div className="text-sm text-gray-500">לא נמצאו תנועות מועדון.</div>
                                    ) : (
                                        profile.ledger.map((l) => (
                                            <div key={l.id} className="group flex items-center justify-between p-3 rounded-2xl bg-gradient-to-r from-slate-50 to-white border border-slate-100 hover:shadow-md transition-all">
                                                <div className="flex items-center gap-3 w-[70%]">
                                                    <div className={`flex items-center justify-center w-10 h-10 rounded-full ${l.delta_points > 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                                                        {l.delta_points > 0 ? (
                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
                                                        ) : (
                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
                                                        )}
                                                    </div>
                                                    <div className="overflow-hidden">
                                                        <div className="font-bold text-slate-800 text-sm truncate" title={l.reason || "פעולה כללית"}>{l.reason || "פעולה כללית"}</div>
                                                        <div className="text-xs text-slate-400 font-medium">{new Date(l.created_at).toLocaleString("he-IL")}</div>
                                                    </div>
                                                </div>
                                                <div className="text-left w-[30%]">
                                                    <div className={`font-black text-lg ${l.delta_points > 0 ? 'text-emerald-500' : 'text-rose-500'}`} dir="ltr">
                                                        {l.delta_points > 0 ? '+' : ''}{l.delta_points}
                                                    </div>
                                                    <div className="text-[10px] text-slate-400 font-bold uppercase">Points</div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                        </div>
                    </div>
                )}

                {isPaymentModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                        <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                            <div className="bg-emerald-600 p-4 text-white">
                                <div className="flex justify-between items-center mb-1">
                                    <h3 className="text-lg font-bold">הקלטת תשלום / זיכוי 🎫</h3>
                                    <button onClick={() => setIsPaymentModalOpen(false)} className="text-white/80 hover:text-white text-xl">✕</button>
                                </div>
                            </div>

                            <div className="p-4 space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">סוג פעולה</label>
                                        <select
                                            value={paymentType}
                                            onChange={e => setPaymentType(e.target.value)}
                                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none"
                                        >
                                            <option value="payment">תשלום רגיל</option>
                                            <option value="deposit">מקדמה</option>
                                            <option value="refund">זיכוי (החזר)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">אמצעי תשלום</label>
                                        <select
                                            value={paymentMethod}
                                            onChange={e => setPaymentMethod(e.target.value)}
                                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none"
                                        >
                                            <option value="cash">מזומן 💵</option>
                                            <option value="credit_card">אשראי 💳</option>
                                            <option value="bit">ביט (Bit) 📱</option>
                                            <option value="paybox">פייבוקס (Paybox)</option>
                                            <option value="bank_transfer">העברה בנקאית</option>
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">שיוך לתור (עסקה)</label>
                                    <select
                                        value={selectedApptId}
                                        onChange={e => setSelectedApptId(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none"
                                    >
                                        {appointments.map(a => (
                                            <option key={a.id} value={a.id}>
                                                {new Date(a.starts_at).toLocaleDateString('he-IL')} - {a.title} ({(a.total_price_cents / 100).toFixed(0)} ₪)
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">מימוש נקודות (1 נקודה = 1 ₪)</label>
                                    {/* Points input — auto-calculates cash */}
                                    <div className="relative mb-3">
                                        <input
                                            type="number"
                                            min="0"
                                            max={Math.min(
                                                profile?.points_balance || 0,
                                                (() => { const a = appointments.find(a => a.id === selectedApptId); return a ? a.total_price_cents / 100 : 9999; })()
                                            )}
                                            value={pointsRedeemed}
                                            onChange={e => {
                                                const pts = parseInt(e.target.value || "0", 10);
                                                const maxPts = Math.min(profile?.points_balance || 0, (() => { const a = appointments.find(a => a.id === selectedApptId); return a ? a.total_price_cents / 100 : 9999; })());
                                                const clamped = Math.max(0, Math.min(pts, maxPts));
                                                setPointsRedeemed(String(clamped));
                                                // Auto-calc cash
                                                const appt = appointments.find(a => a.id === selectedApptId);
                                                if (appt) {
                                                    const cash = Math.max(0, appt.total_price_cents / 100 - clamped);
                                                    setPaymentAmount(cash === 0 ? "" : String(cash));
                                                }
                                            }}
                                            className="w-full bg-amber-50 border-2 border-amber-200 rounded-xl px-4 py-3 text-2xl font-black text-amber-600 focus:ring-4 focus:ring-amber-300/30 outline-none text-left appearance-none"
                                            dir="ltr"
                                        />
                                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xl">⭐</span>
                                        <div className="text-[10px] text-slate-400 mt-1">יתרת נקודות ללקוח: {profile?.points_balance || 0} נק׳</div>
                                    </div>

                                    {/* Summary bar */}
                                    {(() => {
                                        const appt = appointments.find(a => a.id === selectedApptId);
                                        const pts = parseInt(pointsRedeemed || "0", 10);
                                        if (!appt || pts === 0) return null;
                                        const cash = Math.max(0, appt.total_price_cents / 100 - pts);
                                        return (
                                            <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 mb-3 text-sm">
                                                <div className="text-slate-600">
                                                    <span className="font-bold text-slate-800">{(appt.total_price_cents / 100).toFixed(0)} ₪</span> מחיר תור
                                                    <span className="mx-2 text-slate-400">−</span>
                                                    <span className="font-bold text-amber-600">{pts} נק׳</span>
                                                </div>
                                                <div className="font-black text-emerald-700 text-base">
                                                    = {cash.toFixed(0)} ₪ לתשלום
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {/* Cash amount — readonly when points are set */}
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">סכום לחיוב במזומן / אשראי</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            step="0.1"
                                            placeholder="0.00"
                                            value={paymentAmount}
                                            onChange={e => setPaymentAmount(e.target.value)}
                                            className="w-full bg-slate-100 border-none rounded-xl px-4 py-3 text-xl font-black text-slate-900 focus:ring-4 focus:ring-emerald-500/20 outline-none text-left appearance-none"
                                            dir="ltr"
                                        />
                                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-400">₪</span>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">הערות לתיעוד</label>
                                    <textarea
                                        value={paymentNotes}
                                        onChange={e => setPaymentNotes(e.target.value)}
                                        rows={2}
                                        placeholder="לדוגמה: שולם עבור חבילת 10 טיפולים..."
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                                    />
                                </div>
                            </div>

                            <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
                                <button
                                    onClick={() => setIsPaymentModalOpen(false)}
                                    className="flex-1 py-2 text-sm font-bold text-slate-500 hover:bg-slate-200 rounded-xl transition-colors"
                                >
                                    ביטול
                                </button>
                                <button
                                    onClick={handleSavePayment}
                                    disabled={isSavingPayment || (!paymentAmount && (!pointsRedeemed || pointsRedeemed === "0"))}
                                    className="flex-[2] py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-lg shadow-emerald-200 transition-all disabled:opacity-50 disabled:shadow-none"
                                >
                                    {isSavingPayment ? "מעבד..." : "אישור ושמירת תשלום ☑️"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Appointment History Modal */}
                {isApptModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                        <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200">
                            <div className="bg-slate-900 p-5 text-white flex justify-between items-center">
                                <h3 className="text-lg font-bold">היסטוריית תורים 📅</h3>
                                <button onClick={() => setIsApptModalOpen(false)} className="text-white/80 hover:text-white text-xl">✕</button>
                            </div>
                            <div className="p-4 overflow-y-auto space-y-3 flex-1 bg-slate-50">
                                {appointments.length === 0 ? (
                                    <div className="text-sm text-gray-500 text-center py-8">אין תורים מתועדים.</div>
                                ) : (
                                    appointments.map((a) => (
                                        <div key={a.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow group relative pr-12">
                                            <button
                                                onClick={() => handleDeleteAppt(a.id)}
                                                className="absolute right-4 top-1/2 -translate-y-1/2 text-rose-400 hover:text-rose-600 hover:bg-rose-50 p-2 rounded-lg transition-colors border border-transparent hover:border-rose-100"
                                                title="מחק תור"
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            </button>
                                            <div>
                                                <div className="font-bold text-slate-800 text-sm">{a.title} {a.artist_name ? `(${a.artist_name})` : ""}</div>
                                                <div className="text-xs text-gray-500 mt-1 font-medium">
                                                    {new Date(a.starts_at).toLocaleString("he-IL")}
                                                </div>
                                            </div>
                                            <div className="mt-3 sm:mt-0 flex flex-col items-end gap-1">
                                                <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${a.status === 'scheduled' ? 'bg-blue-100 text-blue-800' :
                                                    a.status === 'completed' || a.status === 'done' ? 'bg-emerald-100 text-emerald-800' :
                                                        'bg-rose-100 text-rose-800'
                                                    }`}>
                                                    {a.status === 'scheduled' ? 'מתוכנן' : a.status === 'completed' || a.status === 'done' ? 'בוצע' : 'בוטל'}
                                                </span>
                                                <span className="text-xs font-bold text-slate-400" dir="ltr">₪{(a.total_price_cents / 100).toFixed(0)}</span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </AppShell>
        </RequireAuth>
    );
}
