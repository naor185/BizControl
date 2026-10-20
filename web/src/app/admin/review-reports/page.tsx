"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Ban, Check, Flag, RefreshCw, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { BIZFIND_URL } from "@/lib/config";
import { toast } from "@/lib/toast";

import { tx, intl } from "@/lib/i18n";
// BizFind reviews that customers reported (Apple 1.2: act on a report within 24 hours). Keep the review, remove it,
// or remove it and bar its writer from writing reviews. The rules: app/services/review_moderation.py.

type Reported = {
    id: string; studio_name: string; studio_slug: string; client_name: string; rating: number; comment: string | null;
    created_at: string; writer_email: string | null; reports: number; reasons: string[]; first_reported_at: string;
};

// how long ago the first report came in — past 24 hours shows red
function since(iso: string) {
    const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
    return { late: hours >= 24, text: hours < 1 ? tx("פחות משעה") : hours < 24 ? tx("לפני {0} שעות", { 0: hours }) : tx("לפני {0} ימים", { 0: Math.floor(hours / 24) }) };
}

export default function AdminReviewReportsPage() {
    const [rows, setRows] = useState<Reported[] | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    const load = useCallback(() => {
        apiFetch<Reported[]>("/api/admin/review-reports").then(setRows).catch(e => {
            setRows([]);
            toast.error(e instanceof Error ? e.message : tx("הטעינה נכשלה"));
        });
    }, []);
    useEffect(load, [load]);

    const act = async (r: Reported, path: "keep" | "remove", barWriter = false) => {
        setBusy(r.id);
        try {
            await apiFetch(`/api/admin/review-reports/${r.id}/${path}`, {
                method: "POST", ...(path === "remove" ? { body: JSON.stringify({ bar_writer: barWriter }) } : {}),
            });
            setRows(list => (list || []).filter(x => x.id !== r.id));
            toast.success(path === "keep" ? tx("הביקורת נשארה") : barWriter ? tx("הביקורת נמחקה והכותב/ת נחסם/ה") : tx("הביקורת נמחקה"));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : tx("הפעולה נכשלה"));
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
            <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
                <ArrowRight className="ltr:-scale-x-100 h-4 w-4" /> {tx("חזרה לאדמין")}
            </Link>

            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-black text-slate-900">{tx("ביקורות שדווחו")}</h1>
                    <p className="text-slate-500 text-sm mt-1">
                        {tx("ביקורות ב-BizFind שלקוחות דיווחו עליהן. אפל דורשים לטפל בכל דיווח תוך 24 שעות. בכל דיווח חדש נשלח אליך מייל.")}
                    </p>
                </div>
                <button onClick={load} className="px-4 py-2 text-sm font-bold bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center gap-2 text-slate-700">
                    <RefreshCw className="h-4 w-4" /> {tx("רענון")}
                </button>
            </div>

            {rows === null ? (
                <p className="text-center text-slate-400 py-12">{tx("טוען...")}</p>
            ) : rows.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-slate-200 rounded-2xl text-slate-500">
                    <Check className="h-8 w-8 mx-auto mb-2 text-emerald-500" aria-hidden />
                    {tx("אין דיווחים פתוחים")}
                </div>
            ) : (
                <div className="space-y-3">
                    {rows.map(r => {
                        const age = since(r.first_reported_at);
                        return (
                            <div key={r.id} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                                <div className="flex items-center justify-between gap-3 flex-wrap text-xs">
                                    <a href={`${BIZFIND_URL}/b/${r.studio_slug}`} target="_blank" rel="noopener" className="font-bold text-slate-800 hover:underline">
                                        {r.studio_name}
                                    </a>
                                    <span className={`inline-flex items-center gap-1 font-semibold ${age.late ? "text-rose-600" : "text-amber-600"}`}>
                                        <Flag className="h-3.5 w-3.5" aria-hidden />
                                        {r.reports === 1 ? tx("דיווח אחד") : tx("{0} דיווחים", { 0: r.reports })} · {r.reasons.join(", ")} · {age.text}
                                    </span>
                                </div>
                                <div>
                                    <div className="flex items-center gap-2 text-sm">
                                        <span className="font-semibold text-slate-800">{r.client_name}</span>
                                        <span className="text-amber-500">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
                                        <span className="text-xs text-slate-400">{new Date(r.created_at).toLocaleDateString(intl())}</span>
                                    </div>
                                    {r.comment && <p className="text-sm text-slate-600 mt-1 break-words">{r.comment}</p>}
                                    <p className="text-xs text-slate-400 mt-1" dir="ltr">{r.writer_email || tx("ביקורת ישנה — בלי כותב/ת מחובר/ת")}</p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <button type="button" disabled={busy === r.id} onClick={() => act(r, "keep")}
                                        className="text-xs px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg font-semibold hover:bg-slate-50 disabled:opacity-50">
                                        {tx("השארת הביקורת")}
                                    </button>
                                    <button type="button" disabled={busy === r.id} onClick={() => act(r, "remove")}
                                        className="text-xs px-3 py-1.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg font-semibold hover:bg-rose-100 disabled:opacity-50 inline-flex items-center gap-1">
                                        <Trash2 className="h-3.5 w-3.5" aria-hidden /> {tx("מחיקה")}
                                    </button>
                                    {r.writer_email && (
                                        <button type="button" disabled={busy === r.id} onClick={() => act(r, "remove", true)}
                                            className="text-xs px-3 py-1.5 bg-rose-600 text-white rounded-lg font-semibold hover:bg-rose-700 disabled:opacity-50 inline-flex items-center gap-1">
                                            <Ban className="h-3.5 w-3.5" aria-hidden /> {tx("מחיקה וחסימת הכותב/ת")}
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
