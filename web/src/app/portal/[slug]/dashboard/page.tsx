"use client";

import { toast } from "@/lib/toast";
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { API_BASE } from "@/lib/api";
import QRCode from "qrcode";

type Me = {
    client_name: string;
    phone: string | null;
    email: string | null;
    loyalty_points: number;
    is_club_member: boolean;
    studio_name: string;
    logo_url: string | null;
    primary_color: string | null;
};

type Appointment = {
    id: string;
    title: string;
    starts_at: string;
    ends_at: string;
    status: string;
    artist_name: string;
    total_price_cents: number;
    deposit_amount_cents: number;
    can_cancel: boolean;
};

type Coupon = {
    code: string;
    discount_percent: number;
    expires_at: string;
    status: string;
};

type Card = {
    qr_token: string;
    full_name: string;
    loyalty_points: number;
    is_club_member: boolean;
    studio_name: string;
    background_color: string;
    text_color: string;
    strip_color: string;
    label_color: string;
    logo_url: string | null;
    card_title: string | null;
    apple_wallet_enabled: boolean;
    google_wallet_enabled: boolean;
    apple_wallet_url: string | null;
    google_wallet_url: string | null;
};

type Tier = {
    name: string;
    color: string;
    icon: string;
    points_multiplier: number;
    birthday_gift_percent: number;
} | null;

type StampProgress = {
    card_id: string;
    name: string;
    description: string | null;
    required_stamps: number;
    stamps_collected: number;
    completed_count: number;
    reward_type: string;
    reward_value: number;
    reward_description: string | null;
};

type TimelineEvent = {
    type: "appointment" | "points";
    date: string;
    // appointment
    title?: string;
    status?: string;
    artist_name?: string;
    total_price_cents?: number;
    // points
    delta_points?: number;
    reason?: string;
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
    scheduled: { label: "מתוכנן",   color: "bg-blue-100 text-blue-700" },
    done:       { label: "בוצע",    color: "bg-green-100 text-green-700" },
    canceled:   { label: "בוטל",    color: "bg-gray-100 text-gray-500" },
    no_show:    { label: "לא הגיע", color: "bg-red-100 text-red-600" },
};

const fmt = (cents: number) =>
    (cents / 100).toLocaleString("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 });

const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString("he-IL", { dateStyle: "medium", timeStyle: "short" });

const fmtShort = (iso: string) =>
    new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" });

const REWARD_SUFFIX: Record<string, string> = {
    discount_percent: "% הנחה",
    points: " נקודות",
    free_service: " שירות חינם",
};

type Tab = "card" | "appointments" | "stamps" | "coupons" | "timeline";

function StampVisual({ total, collected }: { total: number; collected: number }) {
    const display = Math.min(total, 10);
    return (
        <div className="flex flex-wrap gap-1.5 mt-3">
            {Array.from({ length: display }).map((_, i) => (
                <div key={i}
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                        i < collected ? "bg-amber-400 text-white shadow-md shadow-amber-900/40" : "bg-white/10 text-white/20"
                    }`}>
                    {i < collected ? "✓" : "○"}
                </div>
            ))}
            {total > 10 && <span className="text-xs text-slate-500 self-center">+{total - 10} עוד</span>}
        </div>
    );
}

export default function PortalDashboardPage() {
    const { slug } = useParams<{ slug: string }>();
    const router = useRouter();

    const [me, setMe] = useState<Me | null>(null);
    const [appointments, setAppointments] = useState<Appointment[]>([]);
    const [coupons, setCoupons] = useState<Coupon[]>([]);
    const [card, setCard] = useState<Card | null>(null);
    const [tier, setTier] = useState<Tier>(null);
    const [stamps, setStamps] = useState<StampProgress[]>([]);
    const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
    const [qrDataUrl, setQrDataUrl] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [canceling, setCanceling] = useState<string | null>(null);
    const [tab, setTab] = useState<Tab>("card");
    const [apptTab, setApptTab] = useState<"upcoming" | "past">("upcoming");
    const [copiedCoupon, setCopiedCoupon] = useState<string | null>(null);

    const token = typeof window !== "undefined"
        ? sessionStorage.getItem(`portal_token_${slug}`) ?? ""
        : "";

    const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    const load = useCallback(async () => {
        if (!token) { router.replace(`/portal/${slug}`); return; }
        setLoading(true);
        setError(null);
        try {
            const [meRes, apptRes, couponRes, cardRes, tierRes, stampsRes, timelineRes] = await Promise.all([
                fetch(`${API_BASE}/portal/me`, { headers: authHeaders }),
                fetch(`${API_BASE}/portal/appointments`, { headers: authHeaders }),
                fetch(`${API_BASE}/portal/coupons`, { headers: authHeaders }),
                fetch(`${API_BASE}/portal/card`, { headers: authHeaders }),
                fetch(`${API_BASE}/portal/tier`, { headers: authHeaders }),
                fetch(`${API_BASE}/portal/stamps`, { headers: authHeaders }),
                fetch(`${API_BASE}/portal/timeline`, { headers: authHeaders }),
            ]);
            if (meRes.status === 401) { router.replace(`/portal/${slug}`); return; }
            setMe(await meRes.json());
            if (apptRes.ok) setAppointments(await apptRes.json());
            if (couponRes.ok) setCoupons(await couponRes.json());
            if (cardRes.ok) {
                const cardData: Card = await cardRes.json();
                setCard(cardData);
                const qr = await QRCode.toDataURL(cardData.qr_token, {
                    width: 200, margin: 1,
                    color: { dark: "#1a1a2e", light: "#ffffff" },
                });
                setQrDataUrl(qr);
            }
            if (tierRes.ok) {
                const t = await tierRes.json();
                setTier(t.tier ?? null);
            }
            if (stampsRes.ok) setStamps(await stampsRes.json());
            if (timelineRes.ok) setTimeline(await timelineRes.json());
        } catch {
            setError("שגיאה בטעינת הנתונים");
        } finally {
            setLoading(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slug, token]);

    useEffect(() => { load(); }, [load]);

    async function handleCancel(id: string) {
        if (!confirm("לבטל את התור?")) return;
        setCanceling(id);
        try {
            const res = await fetch(`${API_BASE}/portal/appointments/${id}/cancel`, {
                method: "PATCH", headers: authHeaders,
            });
            if (!res.ok) { const d = await res.json(); toast.error(d.detail || "שגיאה בביטול"); return; }
            await load();
        } finally { setCanceling(null); }
    }

    function handleLogout() {
        sessionStorage.removeItem(`portal_token_${slug}`);
        router.replace(`/portal/${slug}`);
    }

    function handleCopyCoupon(code: string) {
        navigator.clipboard.writeText(code).catch(() => {});
        setCopiedCoupon(code);
        setTimeout(() => setCopiedCoupon(null), 2000);
    }

    const now = new Date();
    const upcoming = appointments.filter(a => new Date(a.starts_at) >= now && a.status === "scheduled");
    const past = appointments.filter(a => new Date(a.starts_at) < now || a.status !== "scheduled");
    const shownAppts = apptTab === "upcoming" ? upcoming : past;
    const activeCoupons = coupons.filter(c => c.status === "active");
    const accentColor = card?.strip_color || me?.primary_color || "#6366f1";

    if (loading) return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center">
            <div className="animate-spin w-10 h-10 border-4 border-indigo-800 border-t-indigo-400 rounded-full" />
        </div>
    );

    return (
        <div className="min-h-screen bg-slate-950 text-white" dir="rtl">

            {/* Header */}
            <header className="sticky top-0 z-20 backdrop-blur-md bg-slate-950/80 border-b border-white/10 px-4 py-3">
                <div className="max-w-lg mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        {me?.logo_url ? (
                            <img src={me.logo_url} alt="logo" className="w-9 h-9 rounded-xl object-cover" />
                        ) : (
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm"
                                style={{ background: accentColor }}>
                                {me?.studio_name?.[0] ?? "S"}
                            </div>
                        )}
                        <div>
                            <p className="font-bold text-sm leading-none">{me?.studio_name}</p>
                            <p className="text-[11px] text-slate-400 mt-0.5">{me?.client_name}</p>
                        </div>
                    </div>
                    <button onClick={handleLogout} className="text-xs text-slate-500 hover:text-white transition px-3 py-1.5 rounded-lg hover:bg-white/10">
                        יציאה
                    </button>
                </div>
            </header>

            {/* Points + Tier banner */}
            <div className="max-w-lg mx-auto px-4 pt-6 pb-2">
                <div className="rounded-3xl p-6"
                    style={{ background: `linear-gradient(135deg, ${accentColor}33, ${accentColor}11)`, border: `1px solid ${accentColor}44` }}>
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-xs font-bold uppercase tracking-widest text-slate-400">נקודות מועדון</div>
                            <div className="text-5xl font-black mt-1" style={{ color: accentColor }}>
                                {me?.loyalty_points ?? 0}
                            </div>
                            <div className="text-xs text-slate-500 mt-1">נקודות זמינות לניצול</div>
                        </div>
                        <div className="text-right space-y-2">
                            <div className="text-5xl select-none">{tier ? tier.icon : "⭐"}</div>
                            {tier && (
                                <div className="text-xs font-black px-3 py-1 rounded-full text-center"
                                    style={{ background: tier.color + "33", color: tier.color }}>
                                    {tier.name}
                                </div>
                            )}
                        </div>
                    </div>
                    {tier && (
                        <div className="mt-3 pt-3 border-t border-white/10 flex gap-4 text-xs text-slate-400">
                            <span>✨ ×{tier.points_multiplier} נקודות</span>
                            <span>🎂 {tier.birthday_gift_percent}% הנחה ליום הולדת</span>
                        </div>
                    )}
                </div>
                {error && (
                    <div className="mt-3 text-sm text-rose-400 bg-rose-950/50 rounded-xl px-4 py-3 border border-rose-800/50">{error}</div>
                )}
            </div>

            {/* Tab nav */}
            <div className="max-w-lg mx-auto px-4 pt-4">
                <div className="flex gap-1 bg-white/5 rounded-2xl p-1 overflow-x-auto no-scrollbar">
                    {([
                        ["card",         "💳 כרטיס"],
                        ["appointments", `📅 תורים`],
                        ["stamps",       `🎫 חותמות${stamps.length ? ` (${stamps.length})` : ""}`],
                        ["coupons",      `🎁 קופונים${activeCoupons.length ? ` (${activeCoupons.length})` : ""}`],
                        ["timeline",     "📋 היסטוריה"],
                    ] as [Tab, string][]).map(([t, label]) => (
                        <button key={t} onClick={() => setTab(t)}
                            className={`shrink-0 px-3 py-2.5 text-xs font-bold rounded-xl transition-all ${tab === t ? "bg-white text-slate-900 shadow" : "text-slate-400 hover:text-white"}`}>
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="max-w-lg mx-auto px-4 py-6 space-y-4 pb-20">

                {/* ── Card tab ── */}
                {tab === "card" && card && (
                    <div className="space-y-4">
                        <div className="rounded-3xl overflow-hidden shadow-2xl"
                            style={{ background: card.background_color, color: card.text_color }}>
                            <div className="h-3 w-full" style={{ background: card.strip_color }} />
                            <div className="px-6 py-5 space-y-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-[10px] font-bold uppercase tracking-widest opacity-60" style={{ color: card.label_color }}>מועדון לקוחות</div>
                                        <div className="text-lg font-black leading-tight mt-0.5">{card.card_title || card.studio_name}</div>
                                    </div>
                                    {card.logo_url ? (
                                        <img src={card.logo_url} alt="logo" className="w-12 h-12 rounded-xl object-cover" />
                                    ) : (
                                        <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl" style={{ background: card.strip_color }}>💎</div>
                                    )}
                                </div>
                                <div className="flex gap-6">
                                    <div>
                                        <div className="text-[10px] font-bold uppercase tracking-widest opacity-50" style={{ color: card.label_color }}>שם חבר/ה</div>
                                        <div className="text-base font-bold">{card.full_name}</div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] font-bold uppercase tracking-widest opacity-50" style={{ color: card.label_color }}>נקודות</div>
                                        <div className="text-2xl font-black">{card.loyalty_points.toLocaleString()}</div>
                                    </div>
                                    {tier && (
                                        <div>
                                            <div className="text-[10px] font-bold uppercase tracking-widest opacity-50" style={{ color: card.label_color }}>דרגה</div>
                                            <div className="text-base font-bold">{tier.icon} {tier.name}</div>
                                        </div>
                                    )}
                                </div>
                                {qrDataUrl && (
                                    <div className="flex justify-center pt-1">
                                        <div className="rounded-2xl p-3 bg-white">
                                            <img src={qrDataUrl} alt="QR" className="w-32 h-32" />
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="h-1.5 w-full opacity-50" style={{ background: card.strip_color }} />
                        </div>

                        {(card.apple_wallet_enabled || card.google_wallet_enabled) && (
                            <div className="space-y-2">
                                <div className="text-xs text-slate-500 text-center font-medium">הוסף לארנק הדיגיטלי</div>
                                {card.apple_wallet_enabled && card.apple_wallet_url && (
                                    <a href={card.apple_wallet_url} target="_blank" rel="noreferrer"
                                        className="flex items-center justify-center gap-3 w-full py-3.5 rounded-2xl font-bold text-sm"
                                        style={{ background: "#000", color: "#fff" }}>
                                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                                        </svg>
                                        Add to Apple Wallet
                                    </a>
                                )}
                                {card.google_wallet_enabled && card.google_wallet_url && (
                                    <a href={card.google_wallet_url} target="_blank" rel="noreferrer"
                                        className="flex items-center justify-center gap-3 w-full py-3.5 rounded-2xl font-bold text-sm"
                                        style={{ background: "#1a73e8", color: "#fff" }}>
                                        הוסף ל-Google Wallet
                                    </a>
                                )}
                            </div>
                        )}
                        {!card.apple_wallet_enabled && !card.google_wallet_enabled && (
                            <div className="text-center py-4 text-xs text-slate-600 bg-white/5 rounded-2xl border border-white/10">
                                כפתורי Wallet יופיעו כאשר הסטודיו יפעיל את האינטגרציה
                            </div>
                        )}
                    </div>
                )}

                {/* ── Stamps tab ── */}
                {tab === "stamps" && (
                    <div className="space-y-4">
                        {stamps.length === 0 ? (
                            <div className="text-center py-16 text-slate-600 text-sm">
                                <div className="text-5xl mb-3">🎫</div>
                                הסטודיו טרם הגדיר כרטיסי חותמות
                            </div>
                        ) : stamps.map(s => {
                            const pct = Math.round((s.stamps_collected / s.required_stamps) * 100);
                            return (
                                <div key={s.card_id} className="bg-white/5 rounded-2xl border border-white/10 p-5 space-y-3">
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <div className="font-bold text-sm">{s.name}</div>
                                            {s.description && <div className="text-xs text-slate-400 mt-0.5">{s.description}</div>}
                                        </div>
                                        {s.completed_count > 0 && (
                                            <span className="text-[10px] bg-amber-600 text-white font-bold px-2 py-1 rounded-full">
                                                הושלם {s.completed_count}×
                                            </span>
                                        )}
                                    </div>

                                    <StampVisual total={s.required_stamps} collected={s.stamps_collected} />

                                    {/* Progress bar */}
                                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                                        <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                                    </div>

                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-slate-400">{s.stamps_collected} / {s.required_stamps} חותמות</span>
                                        <span className="text-amber-400 font-bold">
                                            פרס: {s.reward_value}{REWARD_SUFFIX[s.reward_type] ?? ""}
                                            {s.reward_description && ` — ${s.reward_description}`}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* ── Appointments tab ── */}
                {tab === "appointments" && (
                    <div className="space-y-4">
                        <div className="flex gap-1 bg-white/5 rounded-2xl p-1">
                            {([["upcoming", `קרובים (${upcoming.length})`], ["past", `עבר (${past.length})`]] as const).map(([t, label]) => (
                                <button key={t} onClick={() => setApptTab(t)}
                                    className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${apptTab === t ? "bg-white text-slate-900 shadow" : "text-slate-400 hover:text-white"}`}>
                                    {label}
                                </button>
                            ))}
                        </div>
                        {shownAppts.length === 0 ? (
                            <div className="text-center py-12 text-slate-600 text-sm">אין תורים להצגה</div>
                        ) : shownAppts.map(a => {
                            const st = STATUS_LABELS[a.status] ?? { label: a.status, color: "bg-gray-100 text-gray-700" };
                            return (
                                <div key={a.id} className="bg-white/5 rounded-2xl border border-white/10 p-4 space-y-2">
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <div className="font-bold text-sm">{a.title}</div>
                                            <div className="text-xs text-slate-400 mt-0.5">{a.artist_name} · {fmtDate(a.starts_at)}</div>
                                        </div>
                                        <span className={`text-[10px] font-bold px-2 py-1 rounded-lg whitespace-nowrap ${st.color}`}>{st.label}</span>
                                    </div>
                                    <div className="flex items-center justify-between pt-1 border-t border-white/10">
                                        <div className="text-xs text-slate-400">
                                            {fmt(a.total_price_cents)}
                                            {a.deposit_amount_cents > 0 && ` · מקדמה ${fmt(a.deposit_amount_cents)}`}
                                        </div>
                                        {a.can_cancel && (
                                            <button onClick={() => handleCancel(a.id)} disabled={canceling === a.id}
                                                className="text-[11px] text-rose-400 hover:text-rose-300 font-bold transition disabled:opacity-50">
                                                {canceling === a.id ? "מבטל..." : "ביטול תור"}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* ── Coupons tab ── */}
                {tab === "coupons" && (
                    <div className="space-y-3">
                        {coupons.length === 0 ? (
                            <div className="text-center py-12 text-slate-600 text-sm">
                                <div className="text-4xl mb-3">🎁</div>
                                אין קופונים פעילים כרגע.<br />
                                <span className="text-xs">קופוני יום הולדת יישלחו אוטומטית בחודש הרלוונטי.</span>
                            </div>
                        ) : coupons.map(c => {
                            const isActive = c.status === "active";
                            const expDate = new Date(c.expires_at).toLocaleDateString("he-IL");
                            return (
                                <div key={c.code}
                                    className={`rounded-2xl border p-4 space-y-2 ${isActive ? "bg-violet-950/40 border-violet-700/50" : "bg-white/5 border-white/10 opacity-60"}`}>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-2xl">{isActive ? "🎉" : "⏰"}</span>
                                            <div>
                                                <div className="text-xs text-slate-400 font-medium">קופון הנחה</div>
                                                <div className="text-lg font-black text-violet-300">{c.discount_percent}% הנחה</div>
                                            </div>
                                        </div>
                                        <div className={`text-[10px] font-bold px-2 py-1 rounded-lg ${isActive ? "bg-violet-600 text-white" : "bg-slate-700 text-slate-400"}`}>
                                            {isActive ? "פעיל" : c.status === "redeemed" ? "מומש" : "פג תוקף"}
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between pt-2 border-t border-white/10">
                                        <div className="font-mono font-black text-base tracking-wider text-white">{c.code}</div>
                                        <div className="flex items-center gap-2">
                                            <div className="text-[10px] text-slate-500">עד {expDate}</div>
                                            {isActive && (
                                                <button onClick={() => handleCopyCoupon(c.code)}
                                                    className={`text-[11px] font-bold px-3 py-1.5 rounded-lg transition-all ${copiedCoupon === c.code ? "bg-emerald-600 text-white" : "bg-violet-600 hover:bg-violet-500 text-white"}`}>
                                                    {copiedCoupon === c.code ? "✅ הועתק!" : "העתק"}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* ── Timeline tab ── */}
                {tab === "timeline" && (
                    <div className="space-y-2">
                        {timeline.length === 0 ? (
                            <div className="text-center py-12 text-slate-600 text-sm">
                                <div className="text-4xl mb-3">📋</div>
                                אין פעילות להצגה עדיין
                            </div>
                        ) : timeline.map((event, i) => (
                            <div key={i} className="flex gap-3 items-start">
                                <div className="flex flex-col items-center">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 ${
                                        event.type === "appointment" ? "bg-sky-900 text-sky-300" : event.delta_points! > 0 ? "bg-emerald-900 text-emerald-300" : "bg-rose-900 text-rose-300"
                                    }`}>
                                        {event.type === "appointment" ? "📅" : event.delta_points! > 0 ? "+" : "−"}
                                    </div>
                                    {i < timeline.length - 1 && <div className="w-px flex-1 bg-white/10 mt-1 min-h-4" />}
                                </div>
                                <div className="flex-1 pb-3">
                                    {event.type === "appointment" ? (
                                        <div>
                                            <div className="text-sm font-semibold text-white">{event.title}</div>
                                            <div className="text-xs text-slate-400 mt-0.5">
                                                {event.artist_name} · {fmtShort(event.date)}
                                                {event.total_price_cents ? ` · ${fmt(event.total_price_cents)}` : ""}
                                            </div>
                                        </div>
                                    ) : (
                                        <div>
                                            <div className={`text-sm font-bold ${event.delta_points! > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                                {event.delta_points! > 0 ? `+${event.delta_points}` : event.delta_points} נקודות
                                            </div>
                                            <div className="text-xs text-slate-400 mt-0.5">{fmtShort(event.date)}</div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
