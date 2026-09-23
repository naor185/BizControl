"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";

type ConnectorStat = {
    slug: string;
    name: string;
    version: string;
    auth_type: string;
    entities: string[];
    enabled: boolean;
    total: number;
    completed: number;
    partial: number;
    failed: number;
    rolled_back: number;
    in_progress: number;
    last_error: { error: string; at: string } | null;
};

type RecentMigration = {
    id: string;
    code: string;
    studio: string;
    source_name: string;
    entity: string;
    status: string;
    rows: number;
    result: Record<string, number> | null;
    error: string | null;
    created_at: string;
};

const AUTH_LABELS: Record<string, string> = { file: "העלאת קובץ", api_key: "מפתח API", oauth: "OAuth", api: "API", manual: "ידני" };
const STATUS_LABELS: Record<string, string> = {
    draft: "מיפוי", scanning: "סורק", preview: "תצוגה מקדימה", importing: "מייבא",
    completed: "הושלם", partial: "חלקי", failed: "נכשל", rolled_back: "בוטל",
};

// Super Admin: every connector, whether it is on, how its imports ended, and recent imports across studios.
// No client data and no credentials are shown here.
export default function AdminMigrationsPage() {
    const [data, setData] = useState<{ connectors: ConnectorStat[]; recent: RecentMigration[] } | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(() => {
        apiFetch<{ connectors: ConnectorStat[]; recent: RecentMigration[] }>("/api/admin/migrations/overview")
            .then(d => { setData(d); setError(null); })
            .catch(e => setError(e instanceof Error ? e.message : "הטעינה נכשלה"));
    }, []);

    useEffect(() => { load(); }, [load]);

    async function toggle(c: ConnectorStat) {
        try {
            await apiFetch(`/api/admin/migrations/connectors/${c.slug}`, { method: "PATCH", body: JSON.stringify({ enabled: !c.enabled }) });
            load();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "השינוי נכשל");
        }
    }

    return (
        <div className="max-w-6xl mx-auto py-8 px-4 space-y-8" dir="rtl">
            <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
                <ArrowRight className="h-4 w-4" /> חזרה לאדמין
            </Link>

            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-900">ייבוא נתונים — Connectors</h1>
                    <p className="text-slate-500 text-sm mt-1">מקורות הייבוא, מצבם, וכל הייבואים האחרונים בכל העסקים. בלי נתוני לקוחות ובלי פרטי התחברות.</p>
                </div>
                <button onClick={load} className="px-4 py-2 text-sm font-bold bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center gap-2 text-slate-700">
                    <RefreshCw className="h-4 w-4" /> רענן
                </button>
            </div>

            {error && <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3">{error}</div>}

            {data && (
                <>
                    <section className="space-y-3">
                        <h2 className="font-bold text-slate-800">Connectors</h2>
                        <div className="grid md:grid-cols-2 gap-4">
                            {data.connectors.map(c => (
                                <div key={c.slug} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <div className="font-bold text-slate-900">{c.name}</div>
                                            <div className="text-xs text-slate-500 mt-0.5">
                                                <span className="font-mono" dir="ltr">{c.slug} v{c.version}</span> · {AUTH_LABELS[c.auth_type] || c.auth_type} · {c.entities.join(", ")}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => toggle(c)}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${c.enabled ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-500 border border-slate-200"}`}
                                        >
                                            {c.enabled ? "פעיל — לחץ לכיבוי" : "כבוי — לחץ להפעלה"}
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
                                        {[
                                            ["סה״כ", c.total, "text-slate-900"], ["הושלמו", c.completed, "text-emerald-700"], ["חלקי", c.partial, "text-amber-700"],
                                            ["נכשלו", c.failed, "text-rose-700"], ["בוטלו", c.rolled_back, "text-slate-500"], ["בתהליך", c.in_progress, "text-sky-700"],
                                        ].map(([label, n, cls]) => (
                                            <div key={label as string} className="rounded-xl bg-slate-50 py-2">
                                                <div className={`text-lg font-extrabold tabular-nums ${cls}`}>{n as number}</div>
                                                <div className="text-[11px] text-slate-500">{label as string}</div>
                                            </div>
                                        ))}
                                    </div>
                                    {c.last_error && (
                                        <div className="text-xs text-rose-700 bg-rose-50 rounded-lg px-3 py-2">
                                            שגיאה אחרונה ({new Date(c.last_error.at).toLocaleString("he-IL")}): {c.last_error.error}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="space-y-3">
                        <h2 className="font-bold text-slate-800">ייבואים אחרונים</h2>
                        {data.recent.length === 0 ? (
                            <p className="text-sm text-slate-500">עוד לא בוצעו ייבואים.</p>
                        ) : (
                            <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-slate-50 text-slate-500 text-xs">
                                        <tr>
                                            {["קוד", "עסק", "מקור", "מה", "מצב", "שורות", "תוצאה", "נוצר", "שגיאה"].map(h => (
                                                <th key={h} className="text-right font-semibold px-3 py-2 whitespace-nowrap">{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {data.recent.map(m => (
                                            <tr key={m.id}>
                                                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap" dir="ltr">{m.code}</td>
                                                <td className="px-3 py-2">{m.studio}</td>
                                                <td className="px-3 py-2 whitespace-nowrap">{m.source_name}</td>
                                                <td className="px-3 py-2">{m.entity}</td>
                                                <td className="px-3 py-2 whitespace-nowrap">{STATUS_LABELS[m.status] || m.status}</td>
                                                <td className="px-3 py-2 tabular-nums">{m.rows}</td>
                                                <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">
                                                    {m.result ? `נוצרו ${m.result.created || 0} · עודכנו ${m.result.updated || 0} · נכשלו ${m.result.failed || 0}` : "—"}
                                                </td>
                                                <td className="px-3 py-2 text-xs whitespace-nowrap">{new Date(m.created_at).toLocaleString("he-IL")}</td>
                                                <td className="px-3 py-2 text-xs text-rose-700 max-w-xs truncate" title={m.error || ""}>{m.error || ""}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </section>
                </>
            )}
        </div>
    );
}
