"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import AppShell from "@/components/AppShell";

interface PendingDeposit {
    appointment_id: string;
    client_name: string;
    client_phone: string;
    client_id: string;
    title: string;
    starts_at: string | null;
    deposit_amount_cents: number;
    payment_sent_at: string | null;
}

export default function DepositsPage() {
    const [items, setItems] = useState<PendingDeposit[]>([]);
    const [loading, setLoading] = useState(true);
    const [confirming, setConfirming] = useState<string | null>(null);

    async function load() {
        setLoading(true);
        try {
            const data = await apiFetch<PendingDeposit[]>("/api/appointments/pending-deposits");
            setItems(data);
        } catch { /* silent */ }
        finally { setLoading(false); }
    }

    useEffect(() => { load(); }, []);

    async function confirm(id: string) {
        setConfirming(id);
        try {
            await apiFetch(`/api/appointments/${id}/verify-payment`, { method: "POST" });
            setItems(prev => prev.filter(i => i.appointment_id !== id));
        } catch (e: any) {
            alert(e?.message || "שגיאה באישור");
        } finally {
            setConfirming(null);
        }
    }

    const fmt = (cents: number) =>
        "₪" + (cents / 100).toLocaleString("he-IL", { minimumFractionDigits: 0 });

    const fmtDate = (iso: string | null) => {
        if (!iso) return "—";
        const d = new Date(iso);
        return d.toLocaleDateString("he-IL") + " " + d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
    };

    return (
        <AppShell title="אישור מקדמות">
            <div className="max-w-2xl mx-auto space-y-4" dir="rtl">
                <div className="flex items-center justify-between">
                    <p className="text-sm text-slate-500">
                        {loading ? "טוען..." : items.length === 0 ? "אין מקדמות ממתינות לאישור" : `${items.length} תורים ממתינים לאישור מקדמה`}
                    </p>
                    <button onClick={load} className="text-sm text-slate-400 hover:text-slate-700 transition">רענן</button>
                </div>

                {loading && (
                    <div className="space-y-3">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="bg-white rounded-2xl border border-slate-100 p-5 animate-pulse h-28" />
                        ))}
                    </div>
                )}

                {!loading && items.length === 0 && (
                    <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center text-slate-400">
                        <div className="text-4xl mb-3">✅</div>
                        <p className="font-medium">כל המקדמות אושרו</p>
                    </div>
                )}

                {!loading && items.map(item => (
                    <div key={item.appointment_id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="h-1 bg-amber-400 w-full" />
                        <div className="p-5 flex items-start gap-4">
                            <div className="flex-1 min-w-0 space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-bold text-slate-900 text-base">{item.client_name}</span>
                                    {item.payment_sent_at && (
                                        <span className="text-[11px] bg-emerald-100 text-emerald-700 font-semibold px-2 py-0.5 rounded-full">
                                            לקוח דיווח ששילם
                                        </span>
                                    )}
                                </div>
                                <div className="text-sm text-slate-500">{item.title}</div>
                                <div className="text-sm text-slate-500">📅 {fmtDate(item.starts_at)}</div>
                                <div className="text-sm font-bold text-amber-600">מקדמה נדרשת: {fmt(item.deposit_amount_cents)}</div>
                                <a
                                    href={`https://wa.me/${item.client_phone.replace(/\D/g, "")}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline mt-1"
                                >
                                    💬 {item.client_phone}
                                </a>
                            </div>
                            <div className="flex flex-col gap-2 shrink-0">
                                <button
                                    onClick={() => confirm(item.appointment_id)}
                                    disabled={confirming === item.appointment_id}
                                    className="px-4 py-2.5 bg-emerald-600 text-white text-sm font-bold rounded-xl hover:bg-emerald-700 transition disabled:opacity-50 whitespace-nowrap"
                                >
                                    {confirming === item.appointment_id ? "מאשר..." : "קיבלתי מקדמה ✅"}
                                </button>
                                <a
                                    href={`/clients/${item.client_id}`}
                                    className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl text-center hover:bg-slate-200 transition"
                                >
                                    כרטיס לקוח
                                </a>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </AppShell>
    );
}
