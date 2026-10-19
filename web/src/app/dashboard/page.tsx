"use client";

// לוח בקרה — the one home screen (the owner, 2026-10-15: "דשבורד" and לוח בקרה became one). Top to bottom: the
// calendar — today, this week, this month (appointments and how full) — then what waits for approval, ויקי's
// suggestions, the setup checklist (until it's done), the daily collection report, the leads, BizFind's exposure; the
// free trial's bar under it (AppShell).
import { Bell, BellRing, ChevronDown, CircleCheck, Lock, MessageCircle, Target } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { apiFetch, imgUrl } from "@/lib/api";
import { whatsappNumber } from "@/lib/format";
import PaymentModal from "@/components/PaymentModal";
import DepositConfirmModal, { type DepositToConfirm } from "@/components/DepositConfirmModal";
import SetupChecklist from "@/components/SetupChecklist";
import LeadsContent from "@/components/LeadsContent";
import BizFindExposureCard from "@/components/BizFindExposureCard";
import VikiCard from "@/components/viki/VikiCard";
import { useNewLeadsCount } from "@/lib/useNewLeadsCount";
import { SECTION_EVENT } from "@/lib/sectionLinks";

import { intl, tx } from "@/lib/i18n";
type PendingGiftCard = {
    id: string;
    code: string;
    amount_ils: number;
    bonus_ils: number;
    recipient_name: string;
    buyer_name: string;
    buyer_phone: string;
    created_at: string;
};

type PendingPayment = {
    appointment_id: string;
    client_id: string;
    client_name: string;
    client_phone: string;
    starts_at: string;
    total_price_cents: number;
    paid_cents: number;
    remaining_cents: number;
    payment_sent_at: string | null;
};

type DailyPayment = {
    appointment_id: string;
    client_id: string;
    client_name: string;
    client_phone: string;
    client_loyalty_points: number;
    starts_at: string;
    total_price_cents: number | null;
    deposit_amount_cents: number;
    paid_cents: number;
    remaining_cents: number;
    status: string;
    payment_sent_at: string | null;
    payment_verified_at: string | null;
};

const LEADS_OPEN_KEY = "bizcontrol_overview_leads_open";   // the leads open or closed — the viewer's choice

function readLeadsOpen(): boolean {
    try {
        return localStorage.getItem(LEADS_OPEN_KEY) !== "0";
    } catch {
        return true;
    }
}

const fmt = (n: number) =>
    n.toLocaleString(intl(), { style: "currency", currency: "ILS", maximumFractionDigits: 0 });


export default function Page() {
    const [leadsOpen, setLeadsOpen] = useState(readLeadsOpen);
    const newLeads = useNewLeadsCount();
    const [dailyPayments, setDailyPayments] = useState<DailyPayment[]>([]);
    const [pendingPayments, setPendingPayments] = useState<PendingPayment[]>([]);
    const [pendingExpanded, setPendingExpanded] = useState(false);
    const [pendingGiftCards, setPendingGiftCards] = useState<PendingGiftCard[]>([]);
    const [pendingGiftCardsExpanded, setPendingGiftCardsExpanded] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [selectedAppt, setSelectedAppt] = useState<DailyPayment | null>(null);
    const [pendingDeposits, setPendingDeposits] = useState<any[]>([]);
    const [waivingDeposit, setWaivingDeposit] = useState<string | null>(null);
    // approving a deposit — the same window as the calendar's (components/DepositConfirmModal)
    const [depositCashier, setDepositCashier] = useState<DepositToConfirm | null>(null);
    type OccupancyPeriod = { percent: number; count: number };
    type OccupancyData = { today: OccupancyPeriod; this_week: OccupancyPeriod; last_week: OccupancyPeriod; this_month: OccupancyPeriod; last_month: OccupancyPeriod };
    const [occupancy, setOccupancy] = useState<OccupancyData | null>(null);

    // the parts add up to total_today_cents (refunds taken off)
    const [todayRevenue, setTodayRevenue] = useState<{
        total_today_cents: number;
        appointments_today_cents: number;
        deposits_today_cents: number;
        earlier_appointments_cents: number;
        other_payments_cents: number;
        pos_revenue_cents: number;
        refunds_cents: number;
        deposits_today: { client_name: string; amount_cents: number; appointment_date: string }[];
        date: string;
    } | null>(null);

    const fetchData = async () => {
        try {
            setLoading(true);
            const [paymentsData, pendingData, depositsData, occData, todayRevData, pendingGiftCardsData] = await Promise.all([
                apiFetch<DailyPayment[]>("/api/dashboard/daily-payments"),
                apiFetch<PendingPayment[]>("/api/dashboard/pending-payments"),
                apiFetch<any[]>("/api/appointments/pending-deposits").catch(() => []),
                apiFetch<OccupancyData>("/api/dashboard/occupancy").catch(() => null),
                apiFetch<any>("/api/dashboard/today-revenue").catch(() => null),
                apiFetch<PendingGiftCard[]>("/api/dashboard/pending-gift-cards").catch(() => []),
            ]);
            setDailyPayments(paymentsData);
            setPendingPayments(pendingData);
            setPendingDeposits(depositsData);
            setOccupancy(occData);
            setTodayRevenue(todayRevData);
            setPendingGiftCards(pendingGiftCardsData);
        } catch {
            setError(tx("שגיאה בטעינת נתונים"));
        } finally {
            setLoading(false);
        }
    };

    const [sendingReminder, setSendingReminder] = useState<string | null>(null);

    const sendDepositReminder = async (id: string) => {
        setSendingReminder(id);
        try {
            await apiFetch(`/api/appointments/${id}/send-deposit-reminder`, { method: "POST" });
            setPendingDeposits(prev => prev.map(d =>
                d.appointment_id === id
                    ? { ...d, deposit_reminder_sent: true, deposit_reminder_sent_at: new Date().toISOString() }
                    : d
            ));
        } catch (e: any) {
            alert(e?.message || tx("שגיאה בשליחת תזכורת"));
        } finally {
            setSendingReminder(null);
        }
    };

    const waiveDeposit = async (id: string) => {
        setWaivingDeposit(id);
        try {
            await apiFetch(`/api/appointments/${id}/waive-deposit`, { method: "POST" });
            setPendingDeposits(prev => prev.filter(d => d.appointment_id !== id));
        } catch (e: any) {
            alert(e?.message || tx("שגיאה"));
        } finally {
            setWaivingDeposit(null);
        }
    };

    const openDepositCashier = (d: { appointment_id: string; deposit_amount_cents: number; client_name: string;
                                    payment_proof_url?: string | null; payment_sent_at?: string | null }) => {
        setDepositCashier({ appointmentId: d.appointment_id, amountCents: d.deposit_amount_cents, clientName: d.client_name,
                            proofUrl: d.payment_proof_url, reportedAt: d.payment_sent_at });
    };

    useEffect(() => { fetchData(); }, []);

    // a link to a part of this screen — "#leads", "#viki" (ויקי's buttons, her notices; lib/sectionLinks): open it and
    // scroll to it — when the screen opens with it, and when it's followed here
    const hashDone = useRef(false);
    const openSection = useCallback((id: string) => {
        if (id === "leads") {
            setLeadsOpen(true);
            try { localStorage.setItem(LEADS_OPEN_KEY, "1"); } catch { /* per-viewer convenience only */ }
        }
        setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    }, []);
    useEffect(() => {
        if (loading) return;
        const id = window.location.hash.slice(1);
        if (id && !hashDone.current) { hashDone.current = true; setTimeout(() => openSection(id), 0); }
        const follow = (e: Event) => openSection((e as CustomEvent<string>).detail);
        window.addEventListener(SECTION_EVENT, follow);
        return () => window.removeEventListener(SECTION_EVENT, follow);
    }, [loading, openSection]);

    const toggleLeads = () => {
        const next = !leadsOpen;
        setLeadsOpen(next);
        try { localStorage.setItem(LEADS_OPEN_KEY, next ? "1" : "0"); } catch { /* per-viewer convenience only */ }
    };

    const handlePaymentSuccess = () => { setIsPaymentModalOpen(false); fetchData(); };

    if (loading) return (
        <RequireAuth><AppShell title={tx("לוח בקרה")}>
            <div className="flex justify-center items-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-900" />
            </div>
        </AppShell></RequireAuth>
    );

    if (error) return (
        <RequireAuth><AppShell title={tx("לוח בקרה")}>
            <div className="bg-red-50 text-red-600 p-4 rounded-xl">{error}</div>
        </AppShell></RequireAuth>
    );

    return (
        <RequireAuth>
            <AppShell title={tx("לוח בקרה")}>
                <div className="space-y-6 animate-in fade-in duration-300">

                    {/* ── The calendar: today, this week, this month — how much is booked, and how many appointments ── */}
                    {occupancy && (() => {
                        const Row = ({ label, now, before, beforeLabel }: { label: string; now: OccupancyPeriod; before?: OccupancyPeriod; beforeLabel?: string }) => {
                            const tone = now.percent >= 75 ? "bg-emerald-500" : now.percent >= 40 ? "bg-sky-500" : "bg-slate-400";
                            return (
                                <div>
                                    <div className="flex items-baseline justify-between gap-3">
                                        <span className="font-semibold text-slate-700">{label}</span>
                                        <span className="text-2xl font-black text-slate-900 tabular-nums">{now.percent}%</span>
                                    </div>
                                    <div className="mt-1.5 h-2.5 rounded-full bg-slate-100 overflow-hidden" role="progressbar"
                                        aria-valuenow={now.percent} aria-valuemin={0} aria-valuemax={100} aria-label={tx("מילוי היומן {0}", { 0: label })}>
                                        <div className={`h-full rounded-full ${tone}`} style={{ width: `${now.percent}%`, transition: "width 0.8s ease" }} />
                                    </div>
                                    <div className="mt-1 text-xs text-slate-500">
                                        <span className="font-bold text-slate-700">{now.count === 1 ? tx("תור אחד") : tx("{0} תורים", { 0: now.count })}</span>
                                        {before && ` · ${beforeLabel}: ${before.percent}%`}
                                    </div>
                                </div>
                            );
                        };
                        return (
                            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                                <h3 className="font-bold text-slate-800">{tx("מילוי היומן")}</h3>
                                <p className="text-xs text-slate-500 mt-0.5">{tx("כמה תורים יש, וכמה מזמן העבודה שלך כבר תפוס בהם")}</p>
                                <div className="mt-4 grid gap-5 sm:grid-cols-3">
                                    <Row label={tx("היום")} now={occupancy.today} />
                                    <Row label={tx("השבוע")} now={occupancy.this_week} before={occupancy.last_week} beforeLabel={tx("בשבוע שעבר")} />
                                    <Row label={tx("החודש")} now={occupancy.this_month} before={occupancy.last_month} beforeLabel={tx("בחודש שעבר")} />
                                </div>
                                <p className="mt-4 text-[11px] text-slate-400">{tx("לפי ימי העבודה ושעות היומן שבהגדרות")}</p>
                            </div>
                        );
                    })()}

                    {/* ── Payment reports waiting for approval ── */}
                    {pendingPayments.length > 0 && (
                        <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 overflow-hidden">
                            <button
                                onClick={() => setPendingExpanded(o => !o)}
                                className="w-full p-5 flex items-center gap-4 text-start hover:bg-amber-100/60 transition-colors"
                            >
                                <span className="text-3xl">⚠️</span>
                                <div className="flex-1">
                                    <div className="font-bold text-amber-900">{pendingPayments.length}{tx(" דיווחי תשלום ממתינים לאישור")}</div>
                                    <div className="text-sm text-amber-700">{tx("לקוחות שסימנו \"שילמתי\" — לחץ לפירוט")}</div>
                                </div>
                                <span className="text-amber-600 text-sm font-semibold">{pendingExpanded ? tx("▲ סגור") : tx("▼ פרוס")}</span>
                            </button>
                            {pendingExpanded && (
                                <div className="border-t border-amber-300 divide-y divide-amber-200">
                                    {pendingPayments.map(p => (
                                        <div key={p.appointment_id} className="px-5 py-3 flex items-center gap-4 bg-white/60">
                                            <div className="flex-1 min-w-0">
                                                <div className="font-semibold text-slate-800">{p.client_name}</div>
                                                <div className="text-xs text-slate-500">{p.client_phone} · {new Date(p.starts_at).toLocaleDateString(intl())}</div>
                                            </div>
                                            <div className="text-start shrink-0">
                                                <div className="font-bold text-rose-600" dir="ltr">{fmt(p.remaining_cents / 100)}</div>
                                                <div className="text-xs text-slate-400">{tx("נותר לתשלום")}</div>
                                            </div>
                                            <div className="flex gap-2 shrink-0">
                                                <a
                                                    href={`/clients/${p.client_id}`}
                                                    className="px-3 py-1.5 bg-slate-800 text-white text-xs font-semibold rounded-lg hover:bg-slate-700 transition"
                                                >
                                                    {tx("פתח לקוח")}
                                                </a>
                                                <button
                                                    onClick={async () => {
                                                        if (confirm(tx("לאשר קבלת תשלום מ-{0}?", { 0: p.client_name }))) {
                                                            await apiFetch(`/api/appointments/${p.appointment_id}/verify-payment`, { method: "POST" });
                                                            fetchData();
                                                        }
                                                    }}
                                                    className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 transition"
                                                >
                                                    {tx("אשר ✅")}
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── PENDING GIFT CARD APPROVALS ── */}
                    {pendingGiftCards.length > 0 && (
                        <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 overflow-hidden">
                            <button
                                onClick={() => setPendingGiftCardsExpanded(o => !o)}
                                className="w-full p-5 flex items-center gap-4 text-start hover:bg-amber-100/60 transition-colors"
                            >
                                <span className="text-3xl">🎁</span>
                                <div className="flex-1">
                                    <div className="font-bold text-amber-900">{pendingGiftCards.length}{tx(" גיפט קארד ממתינים לאישור תשלום")}</div>
                                    <div className="text-sm text-amber-700">{tx("הזמנות מהחנות הציבורית — לחץ לפירוט")}</div>
                                </div>
                                <span className="text-amber-600 text-sm font-semibold">{pendingGiftCardsExpanded ? tx("▲ סגור") : tx("▼ פרוס")}</span>
                            </button>
                            {pendingGiftCardsExpanded && (
                                <div className="border-t border-amber-300 divide-y divide-amber-200">
                                    {pendingGiftCards.map(g => (
                                        <div key={g.id} className="px-5 py-3 flex items-center gap-4 bg-white/60">
                                            <div className="flex-1 min-w-0">
                                                <div className="font-semibold text-slate-800">{g.buyer_name}</div>
                                                <div className="text-xs text-slate-500">{g.buyer_phone}{tx(" · לנמען: ")}{g.recipient_name}</div>
                                            </div>
                                            <div className="text-start shrink-0">
                                                <div className="font-bold text-emerald-700" dir="ltr">{fmt(g.amount_ils)}</div>
                                                {g.bonus_ils > 0 && <div className="text-xs text-slate-400">{tx("כולל בונוס ₪")}{g.bonus_ils.toFixed(0)}</div>}
                                            </div>
                                            <a
                                                href="/gift-cards"
                                                className="px-3 py-1.5 bg-slate-800 text-white text-xs font-semibold rounded-lg hover:bg-slate-700 transition shrink-0"
                                            >
                                                {tx("לאישור")}
                                            </a>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── PENDING DEPOSITS ── */}
                    {pendingDeposits.length > 0 && (
                        <div className="bg-white rounded-2xl border-2 border-amber-300 shadow-sm overflow-hidden">
                            <div className="px-5 py-4 bg-amber-50 border-b border-amber-200 flex items-center gap-3">
                                <span className="text-xl">💰</span>
                                <div className="flex-1">
                                    <div className="font-bold text-amber-900">{tx("ממתינים לאישור מקדמה")}</div>
                                    <div className="text-xs text-amber-700">{pendingDeposits.length}{tx(" תורים — לקוח שלחץ \"שילמתי\" בדף התשלום מסומן כאן, עם הצילום ששלח")}</div>
                                </div>
                            </div>
                            <div className="divide-y divide-slate-100">
                                {pendingDeposits.map(d => (
                                    <div key={d.appointment_id} className="px-5 py-4 flex items-center gap-3 flex-wrap">
                                        <div className="flex-1 min-w-0">
                                            <div className="font-semibold text-slate-800">{d.client_name}</div>
                                            <div className="text-xs text-slate-500">
                                                {d.title} · {d.starts_at ? new Date(d.starts_at).toLocaleDateString(intl()) + " " + new Date(d.starts_at).toLocaleTimeString(intl(), { hour: "2-digit", minute: "2-digit" }) : "—"}
                                            </div>
                                            <div className="text-xs font-bold text-amber-600 mt-0.5">
                                                {tx("מקדמה: ₪")}{(d.deposit_amount_cents / 100).toLocaleString()}
                                            </div>
                                            {d.payment_sent_at && (
                                                <div className="mt-1 flex items-center gap-2">
                                                    <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                                                        <BellRing className="w-3 h-3" aria-hidden />{tx(" הלקוח דיווח ששילם · ")}{new Date(d.payment_sent_at).toLocaleString(intl(), { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}
                                                    </span>
                                                    {d.payment_proof_url && (
                                                        <a href={imgUrl(d.payment_proof_url)} target="_blank" rel="noopener noreferrer" className="shrink-0" title={tx("הצילום ששלח הלקוח")}>
                                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                                            <img src={imgUrl(d.payment_proof_url)} alt={tx("צילום התשלום")} className="w-8 h-10 object-cover rounded border border-slate-200" />
                                                        </a>
                                                    )}
                                                </div>
                                            )}
                                            {/* Reminder status */}
                                            <div className="mt-1">
                                                {d.deposit_reminder_sent ? (
                                                    <span className="inline-flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                                                        {tx("✅ תזכורת נשלחה")}{d.deposit_reminder_sent_at ? ` · ${new Date(d.deposit_reminder_sent_at).toLocaleDateString(intl())}` : ""}
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5">
                                                        {tx("🔔 טרם נשלחה תזכורת")}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        {/* the whole width on a phone, wrapping — the card clips what sticks out (the green button
                                            used to be pushed off it); the green one first */}
                                        <div className="w-full sm:w-auto flex gap-2 flex-wrap">
                                            <button
                                                type="button"
                                                onClick={() => openDepositCashier(d)}
                                                className="inline-flex items-center gap-1 min-h-9 px-3 text-xs font-bold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition"
                                            >
                                                <CircleCheck className="w-3.5 h-3.5" aria-hidden /> {tx("קיבלתי")}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => sendDepositReminder(d.appointment_id)}
                                                disabled={sendingReminder === d.appointment_id}
                                                className="inline-flex items-center gap-1 min-h-9 px-3 text-xs font-semibold text-orange-700 border border-orange-200 rounded-lg hover:bg-orange-50 transition disabled:opacity-50"
                                                title={tx("שלח תזכורת WhatsApp עכשיו")}
                                            >
                                                <Bell className="w-3.5 h-3.5" aria-hidden /> {sendingReminder === d.appointment_id ? tx("שולח...") : tx("שלח תזכורת")}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => waiveDeposit(d.appointment_id)}
                                                disabled={waivingDeposit === d.appointment_id}
                                                className="inline-flex items-center gap-1 min-h-9 px-3 text-xs font-semibold text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition disabled:opacity-50"
                                                title={tx("נועל את התור ללא גביית מקדמה")}
                                            >
                                                <Lock className="w-3.5 h-3.5" aria-hidden /> {waivingDeposit === d.appointment_id ? "..." : tx("מאשר ללא מקדמה")}
                                            </button>
                                            <a href={`https://wa.me/${whatsappNumber(d.client_phone)}`} target="_blank" rel="noreferrer"
                                                className="inline-flex items-center gap-1 min-h-9 px-3 text-xs font-semibold text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-50 transition">
                                                <MessageCircle className="w-3.5 h-3.5" aria-hidden /> {tx("וואטסאפ")}
                                            </a>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ── ויקי: what to do now ── */}
                    <VikiCard />

                    {/* ── Setting the business up — until it's done ── */}
                    <SetupChecklist />

                    {/* ── The daily collection report ── */}
                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                            <div>
                                <h3 className="font-bold text-slate-800">{tx("דוח גבייה יומי — ")}{new Date().toLocaleDateString(intl())}</h3>
                                <p className="text-xs text-slate-500 mt-0.5">{tx("ניהול תשלומים לתורים של היום")}</p>
                            </div>
                            <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-full">{tx("סנכרון חי")}</span>
                        </div>
                        {todayRevenue && (
                            <div className="px-6 py-3 bg-emerald-50 border-b border-emerald-100 flex items-center gap-6 flex-wrap">
                                <div>
                                    <span className="text-xs text-emerald-600 font-semibold">{tx("💵 סה״כ נגבה היום")}</span>
                                    <span className="text-xl font-black text-emerald-700 ms-2">{fmt(todayRevenue.total_today_cents / 100)}</span>
                                </div>
                                <div className="w-px bg-emerald-200 h-6 hidden sm:block" />
                                <div className="flex gap-x-4 gap-y-1 text-sm text-emerald-800 flex-wrap items-center">
                                    <span className="text-xs text-emerald-600">{tx("מתוך זה:")}</span>
                                    {[
                                        { label: tx("תורים של היום"), cents: todayRevenue.appointments_today_cents },
                                        { label: tx("מקדמות לתורים הבאים"), cents: todayRevenue.deposits_today_cents },
                                        { label: tx("תשלומים על תורים קודמים"), cents: todayRevenue.earlier_appointments_cents },
                                        { label: tx("מנויים, שיעורים ואחר"), cents: todayRevenue.other_payments_cents },
                                        { label: tx("קופה"), cents: todayRevenue.pos_revenue_cents },
                                    ].filter(p => p.cents > 0).map(p => (
                                        <span key={p.label}>{p.label}: <strong>{fmt(p.cents / 100)}</strong></span>
                                    ))}
                                    {todayRevenue.refunds_cents > 0 && (
                                        <span className="text-rose-600">{tx("החזרים: ")}<strong>−{fmt(todayRevenue.refunds_cents / 100)}</strong></span>
                                    )}
                                    {todayRevenue.total_today_cents === 0 && todayRevenue.refunds_cents === 0 && (
                                        <span className="text-emerald-600">{tx("עוד לא נכנס כסף היום")}</span>
                                    )}
                                </div>
                                {todayRevenue.deposits_today?.length > 0 && (
                                    <div className="w-full flex gap-x-4 gap-y-1 text-xs flex-wrap text-violet-700">
                                        {todayRevenue.deposits_today.map((d, i) => (
                                            <span key={i}>
                                                {tx("💰 מקדמה")} {d.client_name}: <strong>{fmt(d.amount_cents / 100)}</strong>
                                                <span className="text-violet-400">{tx(" (תור ")}{new Date(d.appointment_date).toLocaleDateString(intl())})</span>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                        <div className="overflow-x-auto">
                            <table className="w-full text-start text-sm">
                                <thead>
                                    <tr className="bg-slate-50 text-slate-500 text-xs font-bold uppercase tracking-wide border-b border-slate-100">
                                        <th className="px-6 py-3">{tx("לקוח")}</th>
                                        <th className="px-6 py-3">{tx("שעה")}</th>
                                        <th className="px-6 py-3">{tx("סה״כ")}</th>
                                        <th className="px-6 py-3">{tx("שולם")}</th>
                                        <th className="px-6 py-3 text-emerald-600">{tx("יתרה")}</th>
                                        <th className="px-6 py-3">{tx("פעולות")}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {dailyPayments.length === 0 ? (
                                        <tr><td colSpan={6} className="px-6 py-12 text-center text-slate-400">{tx("לא נמצאו תורים להיום")}</td></tr>
                                    ) : dailyPayments.map(p => (
                                        <tr key={p.appointment_id} className="hover:bg-slate-50/80 transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="font-semibold text-slate-800">{p.client_name}</div>
                                                <div className="text-xs text-slate-400">{p.client_phone}</div>
                                            </td>
                                            <td className="px-6 py-4 text-slate-600">
                                                {new Date(p.starts_at).toLocaleTimeString(intl(), { hour: "2-digit", minute: "2-digit" })}
                                            </td>
                                            <td className="px-6 py-4 font-semibold text-slate-700" dir="ltr">
                                                {(p.total_price_cents ?? 0) > 0 ? fmt((p.total_price_cents ?? 0) / 100) : <span className="text-slate-300 font-normal">—</span>}
                                            </td>
                                            <td className="px-6 py-4 text-slate-500" dir="ltr">{fmt(p.paid_cents / 100)}</td>
                                            <td className="px-6 py-4">
                                                {!((p.total_price_cents ?? 0) > 0)
                                                    // no price on the appointment — nothing to say it is fully paid
                                                    ? <span className="text-xs text-slate-400">{tx("לא נקבע מחיר")}</span>
                                                    : p.remaining_cents > 0
                                                    ? <span className="font-bold text-rose-500 bg-rose-50 px-2 py-0.5 rounded-full" dir="ltr">{fmt(p.remaining_cents / 100)}</span>
                                                    : <span className="font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">{tx("שולם ✨")}</span>
                                                }
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col gap-1.5">
                                                    <a href={`/clients/${p.client_id}`} className="px-3 py-1.5 bg-slate-100 text-slate-800 text-xs font-semibold rounded-lg text-center hover:bg-slate-200 transition">
                                                        {tx("כרטיס לקוח")}
                                                    </a>
                                                    <button onClick={() => { setSelectedAppt(p); setIsPaymentModalOpen(true); }}
                                                        className="px-3 py-1.5 bg-black text-white text-xs font-semibold rounded-lg hover:bg-slate-800 transition">
                                                        {tx("הקלט תשלום 💳")}
                                                    </button>
                                                    {p.payment_sent_at && !p.payment_verified_at && (
                                                        <button onClick={() => openDepositCashier(p)}
                                                            className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 transition animate-pulse">
                                                            {tx("אשר קבלתי ✅")}
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* ── The leads ── */}
                    <section id="leads" className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden scroll-mt-4">
                        <button
                            type="button"
                            onClick={toggleLeads}
                            aria-expanded={leadsOpen}
                            className={`w-full px-5 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors ${leadsOpen ? "border-b border-slate-100" : ""}`}
                        >
                            <Target className="h-5 w-5 text-slate-500" />
                            <h3 className="font-bold text-slate-800 text-sm">{tx("לידים")}</h3>
                            {newLeads > 0 && (
                                <span className="text-white text-xs font-bold rounded-full px-2 h-5 flex items-center" style={{ background: "var(--accent)" }}>
                                    {newLeads} {newLeads === 1 ? tx("חדש") : tx("חדשים")}
                                </span>
                            )}
                            <span className="ms-auto flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                                {leadsOpen ? tx("סגור") : tx("פתח")}
                                <ChevronDown className={`h-4 w-4 transition-transform ${leadsOpen ? "rotate-180" : ""}`} />
                            </span>
                        </button>
                        {leadsOpen && <LeadsContent heightClass="h-[560px]" />}
                    </section>

                    {/* ── BizFind: how the business is seen ── */}
                    <BizFindExposureCard />

                </div>

                <PaymentModal
                    isOpen={isPaymentModalOpen}
                    onClose={() => setIsPaymentModalOpen(false)}
                    onSuccess={handlePaymentSuccess}
                    appointment={selectedAppt}
                />

                {/* ── Approving a deposit ── */}
                {depositCashier && (
                    <DepositConfirmModal deposit={depositCashier} onClose={() => setDepositCashier(null)}
                        onConfirmed={() => {
                            setPendingDeposits(prev => prev.filter(x => x.appointment_id !== depositCashier.appointmentId));
                            fetchData();
                        }} />
                )}
            </AppShell>
        </RequireAuth>
    );
}
