"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import ClientsTabs from "@/components/ClientsTabs";
import { apiFetch } from "@/lib/api";

type Reason = "link" | "whatsapp" | "owner" | "unknown" | "no_consent";
type Row = {
    client_id: string;
    full_name: string;
    phone: string | null;
    is_club_member: boolean;
    reason: Reason;
    opted_out_at: string | null;
};

const REASON: Record<Reason, { label: string; cls: string }> = {
    link: { label: "🔗 לחץ/ה על קישור ההסרה", cls: "bg-rose-50 text-rose-700 border-rose-100" },
    whatsapp: { label: "💬 ענה/תה \"הסר\" בוואטסאפ", cls: "bg-rose-50 text-rose-700 border-rose-100" },
    unknown: { label: "הוסר/ה — לפני שהמערכת שמרה איך", cls: "bg-slate-50 text-slate-600 border-slate-200" },
    owner: { label: "✋ כובה בכרטיס הלקוח", cls: "bg-amber-50 text-amber-700 border-amber-100" },
    no_consent: { label: "לא אישר/ה בהרשמה", cls: "bg-slate-50 text-slate-500 border-slate-200" },
};

const GROUPS: { id: string; label: string; reasons: Reason[] }[] = [
    { id: "asked", label: "ביקשו להסיר", reasons: ["link", "whatsapp", "unknown"] },
    { id: "owner", label: "כובו בכרטיס הלקוח", reasons: ["owner"] },
    { id: "no_consent", label: "לא אישרו בהרשמה", reasons: ["no_consent"] },
    { id: "all", label: "הכל", reasons: ["link", "whatsapp", "unknown", "owner", "no_consent"] },
];

export default function MarketingOptoutsPage() {
    const [rows, setRows] = useState<Row[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [group, setGroup] = useState("asked");
    const [search, setSearch] = useState("");

    useEffect(() => {
        apiFetch<Row[]>("/api/clients/marketing-optouts")
            .then(setRows)
            .catch((e: unknown) => setError((e as Error)?.message || "שגיאה בטעינה"));
    }, []);

    const shown = useMemo(() => {
        const reasons = GROUPS.find(g => g.id === group)!.reasons;
        const q = search.trim().toLowerCase();
        return (rows || []).filter(r => reasons.includes(r.reason) &&
            (!q || r.full_name.toLowerCase().includes(q) || (r.phone || "").includes(q)));
    }, [rows, group, search]);

    return (
        <RequireAuth>
            <AppShell title="לקוחות">
                <div className="space-y-5 animate-page-in">
                    <ClientsTabs />

                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                        <div className="p-5 border-b border-slate-100">
                            <h2 className="font-bold text-slate-800">🔕 לא מקבלים הודעות שיווקיות</h2>
                            <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                                לקוחות שביקשו להסיר את עצמם (בקישור ההסרה או בתשובת &quot;הסר&quot; בוואטסאפ), שכיבית להם בכרטיס, או שלא אישרו בהרשמה.
                                הם לא מקבלים תפוצות, הזמנות למועדון וקופוני יום הולדת — אבל אישורי תור, תזכורות וקבלות ממשיכים להגיע אליהם.
                            </p>
                            <p className="text-xs text-slate-400 mt-2">לקוח שביקש לחזור לקבל הודעות: פותחים את כרטיס הלקוח ומדליקים את המתג &quot;הודעות שיווקיות&quot;.</p>
                        </div>

                        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row gap-3">
                            <input type="text" placeholder="חיפוש לפי שם או טלפון..." value={search} onChange={e => setSearch(e.target.value)}
                                className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
                            <div className="flex gap-2 flex-wrap">
                                {GROUPS.map(g => {
                                    const count = (rows || []).filter(r => g.reasons.includes(r.reason)).length;
                                    return (
                                        <button key={g.id} type="button" onClick={() => setGroup(g.id)}
                                            className={`px-3.5 py-2 rounded-xl text-sm font-medium border transition-colors whitespace-nowrap ${group === g.id ? "bg-rose-500 text-white border-rose-500" : "bg-white text-slate-600 border-slate-200 hover:bg-rose-50"}`}>
                                            {g.label} <span className={group === g.id ? "text-rose-100" : "text-slate-400"}>({count})</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {error ? (
                            <div className="py-12 text-center text-red-500 text-sm">{error}</div>
                        ) : rows === null ? (
                            <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-rose-500" /></div>
                        ) : shown.length === 0 ? (
                            <div className="py-14 text-center text-slate-400 text-sm">
                                <div className="text-4xl mb-2">🔔</div>
                                {group === "asked" ? "אף לקוח לא ביקש להסיר את עצמו" : "אין לקוחות ברשימה הזו"}
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-100 text-xs text-slate-500 font-semibold">
                                            <th className="text-right px-5 py-3">שם</th>
                                            <th className="text-right px-5 py-3 hidden sm:table-cell">טלפון</th>
                                            <th className="text-right px-5 py-3">איך</th>
                                            <th className="text-right px-5 py-3">מתי</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {shown.map(r => (
                                            <tr key={r.client_id} className="hover:bg-slate-50 transition-colors">
                                                <td className="px-5 py-3.5">
                                                    <Link href={`/clients/${r.client_id}`} className="font-medium text-slate-800 hover:text-rose-600">
                                                        {r.full_name}
                                                    </Link>
                                                    {r.is_club_member && <span className="mr-1.5 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-bold">👑 מועדון</span>}
                                                    <div className="text-xs text-slate-400 sm:hidden" dir="ltr">{r.phone}</div>
                                                </td>
                                                <td className="px-5 py-3.5 text-slate-500 hidden sm:table-cell" dir="ltr">{r.phone || "—"}</td>
                                                <td className="px-5 py-3.5">
                                                    <span className={`inline-block text-xs font-medium px-2.5 py-0.5 rounded-full border ${REASON[r.reason].cls}`}>{REASON[r.reason].label}</span>
                                                </td>
                                                <td className="px-5 py-3.5 text-slate-500 text-xs whitespace-nowrap">
                                                    {r.opted_out_at ? new Date(r.opted_out_at).toLocaleDateString("he-IL") : "—"}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </AppShell>
        </RequireAuth>
    );
}
