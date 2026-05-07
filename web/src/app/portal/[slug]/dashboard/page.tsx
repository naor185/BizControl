"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { API_BASE } from "@/lib/api";

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

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
    scheduled: { label: "מתוכנן",  color: "bg-blue-100 text-blue-700" },
    done:       { label: "בוצע",    color: "bg-green-100 text-green-700" },
    canceled:   { label: "בוטל",   color: "bg-gray-100 text-gray-500" },
    no_show:    { label: "לא הגיע", color: "bg-red-100 text-red-600" },
};

const fmt = (cents: number) =>
    (cents / 100).toLocaleString("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 });

const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString("he-IL", { dateStyle: "medium", timeStyle: "short" });

export default function PortalDashboardPage() {
    const { slug } = useParams<{ slug: string }>();
    const router = useRouter();

    const [me, setMe] = useState<Me | null>(null);
    const [appointments, setAppointments] = useState<Appointment[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [canceling, setCanceling] = useState<string | null>(null);
    const [tab, setTab] = useState<"upcoming" | "past">("upcoming");

    const token = typeof window !== "undefined"
        ? sessionStorage.getItem(`portal_token_${slug}`) ?? ""
        : "";

    const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    const load = useCallback(async () => {
        if (!token) { router.replace(`/portal/${slug}`); return; }
        setLoading(true);
        setError(null);
        try {
            const [meRes, apptRes] = await Promise.all([
                fetch(`${API_BASE}/portal/me`, { headers: authHeaders }),
                fetch(`${API_BASE}/portal/appointments`, { headers: authHeaders }),
            ]);
            if (meRes.status === 401) { router.replace(`/portal/${slug}`); return; }
            setMe(await meRes.json());
            setAppointments(await apptRes.json());
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
                method: "PATCH",
                headers: authHeaders,
            });
            if (!res.ok) {
                const d = await res.json();
                alert(d.detail || "שגיאה בביטול");
                return;
            }
            await load();
        } finally {
            setCanceling(null);
        }
    }

    function handleLogout() {
        sessionStorage.removeItem(`portal_token_${slug}`);
        router.replace(`/portal/${slug}`);
    }

    const now = new Date();
    const upcoming = appointments.filter(a => new Date(a.starts_at) >= now && a.status === "scheduled");
    const past = appointments.filter(a => new Date(a.starts_at) < now || a.status !== "scheduled");
    const shown = tab === "upcoming" ? upcoming : past;

    if (loading) return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
            <div className="animate-spin w-10 h-10 border-4 border-gray-200 border-t-black rounded-full" />
        </div>
    );

    return (
        <div className="min-h-screen bg-gray-50" dir="rtl">

            {/* Header */}
            <header className="bg-white border-b border-gray-100 px-4 py-4">
                <div className="max-w-2xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        {me?.logo_url ? (
                            <img src={me.logo_url} alt="logo" className="w-9 h-9 rounded-full object-cover" />
                        ) : (
                            <div className="w-9 h-9 rounded-full bg-black flex items-center justify-center text-white text-sm font-bold">
                                {me?.studio_name?.[0] ?? "S"}
                            </div>
                        )}
                        <div>
                            <p className="font-bold text-sm leading-none">{me?.studio_name}</p>
                            <p className="text-xs text-gray-500 mt-0.5">אזור לקוחות</p>
                        </div>
                    </div>
                    <button onClick={handleLogout} className="text-xs text-gray-400 hover:text-black transition">
                        יציאה
                    </button>
                </div>
            </header>

            <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

                {error && (
                    <div className="bg-red-50 text-red-600 rounded-xl px-4 py-3 text-sm">{error}</div>
                )}

                {/* Welcome + Points */}
                {me && (
                    <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-500">שלום,</p>
                            <p className="text-lg font-bold">{me.client_name}</p>
                            {me.is_club_member && (
                                <span className="text-xs bg-black text-white px-2 py-0.5 rounded-full mt-1 inline-block">
                                    חבר מועדון ⭐
                                </span>
                            )}
                        </div>
                        <div className="text-center">
                            <p className="text-3xl font-extrabold">{me.loyalty_points}</p>
                            <p className="text-xs text-gray-400 mt-0.5">נקודות</p>
                        </div>
                    </div>
                )}

                {/* Quick stats */}
                <div className="grid grid-cols-3 gap-3">
                    {[
                        { label: "תורים קרובים", value: upcoming.length, icon: "📅" },
                        { label: "תורים שבוצעו", value: past.filter(a => a.status === "done").length, icon: "✅" },
                        { label: "בוטלו", value: past.filter(a => a.status === "canceled").length, icon: "❌" },
                    ].map(s => (
                        <div key={s.label} className="bg-white rounded-2xl border border-gray-100 p-4 text-center">
                            <div className="text-xl mb-1">{s.icon}</div>
                            <div className="text-2xl font-bold">{s.value}</div>
                            <div className="text-xs text-gray-400 mt-0.5">{s.label}</div>
                        </div>
                    ))}
                </div>

                {/* Tabs */}
                <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                    {(["upcoming", "past"] as const).map(t => (
                        <button
                            key={t}
                            onClick={() => setTab(t)}
                            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${
                                tab === t ? "bg-white shadow-sm text-black" : "text-gray-500"
                            }`}
                        >
                            {t === "upcoming" ? `קרובים (${upcoming.length})` : `היסטוריה (${past.length})`}
                        </button>
                    ))}
                </div>

                {/* Appointments */}
                {shown.length === 0 && (
                    <div className="text-center text-gray-400 py-10 text-sm">
                        {tab === "upcoming" ? "אין תורים קרובים" : "אין היסטוריה עדיין"}
                    </div>
                )}

                <div className="space-y-3">
                    {shown.map(a => {
                        const st = STATUS_LABELS[a.status] ?? { label: a.status, color: "bg-gray-100 text-gray-600" };
                        const paid = a.deposit_amount_cents > 0;
                        const remaining = a.total_price_cents - a.deposit_amount_cents;
                        return (
                            <div key={a.id} className="bg-white rounded-2xl border border-gray-100 p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold truncate">{a.title}</p>
                                        <p className="text-sm text-gray-500 mt-0.5">{fmtDate(a.starts_at)}</p>
                                        <p className="text-xs text-gray-400 mt-0.5">אמן: {a.artist_name}</p>
                                    </div>
                                    <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap font-medium ${st.color}`}>
                                        {st.label}
                                    </span>
                                </div>

                                {a.total_price_cents > 0 && (
                                    <div className="mt-3 pt-3 border-t border-gray-50 flex items-center justify-between text-sm">
                                        <div className="flex gap-4">
                                            <span className="text-gray-500">
                                                מחיר: <span className="font-medium text-black">{fmt(a.total_price_cents)}</span>
                                            </span>
                                            {paid && (
                                                <span className="text-gray-500">
                                                    מקדמה: <span className="font-medium text-green-600">{fmt(a.deposit_amount_cents)}</span>
                                                </span>
                                            )}
                                        </div>
                                        {paid && remaining > 0 && (
                                            <span className="text-xs text-orange-500 font-medium">
                                                נשאר: {fmt(remaining)}
                                            </span>
                                        )}
                                    </div>
                                )}

                                {a.can_cancel && (
                                    <button
                                        onClick={() => handleCancel(a.id)}
                                        disabled={canceling === a.id}
                                        className="mt-3 w-full text-sm text-red-500 border border-red-100 rounded-xl py-2 hover:bg-red-50 disabled:opacity-40 transition"
                                    >
                                        {canceling === a.id ? "מבטל..." : "ביטול תור"}
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
