"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Bell, Mail, MessageCircle, RefreshCw, RotateCcw, X } from "lucide-react";
import { apiFetch } from "@/lib/api";

// The message queue — the superadmin's (owner, 2026-10-11): every business's outgoing WhatsApp / e-mail / push,
// its status and error; retry or cancel (/api/admin/messages, app/api/admin_message_routes.py). A business owner
// doesn't see it; the superadmin also gets an e-mail when a business's messages fail.

type Job = {
    id: string; studio_id: string; studio_name: string; channel: string; to: string | null; subject: string | null;
    body: string; reminder_type: string | null; status: string; attempts: number; last_error: string | null;
    scheduled_at: string | null; sent_at: string | null; created_at: string | null;
};
const STATUS: Record<string, { label: string; cls: string }> = {
    pending:  { label: "ממתין",  cls: "bg-sky-50 text-sky-700" },
    sent:     { label: "נשלח",   cls: "bg-emerald-50 text-emerald-700" },
    failed:   { label: "נכשל",   cls: "bg-rose-50 text-rose-700" },
    canceled: { label: "בוטל",   cls: "bg-slate-100 text-slate-500" },
};
const FILTERS: { key: string; label: string }[] = [
    { key: "", label: "הכול" }, { key: "failed", label: "נכשלו" }, { key: "pending", label: "ממתינים" }, { key: "sent", label: "נשלחו" },
];
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "—");

function ChannelIcon({ channel }: { channel: string }) {
    if (channel === "whatsapp") return <MessageCircle className="h-4 w-4 text-emerald-700" aria-label="WhatsApp" />;
    if (channel === "email") return <Mail className="h-4 w-4 text-slate-500" aria-label="מייל" />;
    return <Bell className="h-4 w-4 text-slate-500" aria-label="התראה" />;
}

export default function AdminMessagesPage() {
    const [studioId, setStudioId] = useState("");
    const [status, setStatus] = useState("");
    const [jobs, setJobs] = useState<Job[] | null>(null);
    const [studios, setStudios] = useState<{ id: string; name: string }[]>([]);
    const [err, setErr] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    const load = useCallback(() => {
        const q = new URLSearchParams();
        if (studioId) q.set("studio_id", studioId);
        if (status) q.set("status", status);
        apiFetch<Job[]>(`/api/admin/messages?${q}`).then(j => { setJobs(j); setErr(null); })
            .catch(e => { setJobs([]); setErr(e instanceof Error ? e.message : "הטעינה נכשלה"); });
    }, [studioId, status]);
    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        const q = new URLSearchParams(window.location.search);   // a link from an alert e-mail or a business's page
        if (q.get("studio_id")) setStudioId(q.get("studio_id") as string);
        if (q.get("status")) setStatus(q.get("status") as string);
        apiFetch<{ id: string; name: string }[]>("/api/admin/crm/customers").then(rows => setStudios(rows.map(r => ({ id: r.id, name: r.name })))).catch(() => {});
    }, []);

    const failed = useMemo(() => (jobs ?? []).filter(j => j.status === "failed").length, [jobs]);
    const act = async (path: string, key: string) => {
        setBusy(key); setErr(null);
        try {
            await apiFetch(path, { method: "POST" });
            load();
        } catch (e) {
            setErr(e instanceof Error ? e.message : "הפעולה נכשלה");
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="max-w-7xl mx-auto py-8 px-4 space-y-5" dir="rtl">
            <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
                <ArrowRight className="h-4 w-4" /> חזרה לאדמין
            </Link>
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-black text-slate-900">תור הודעות</h1>
                    <p className="text-slate-500 text-sm mt-1">כל ההודעות שהעסקים שולחים — WhatsApp, מייל והתראות. בעלי העסקים לא רואים את המסך הזה; כשהודעה של עסק נכשלת מגיע אליך מייל.</p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => act(`/api/admin/messages/retry-all-failed${studioId ? `?studio_id=${studioId}` : ""}`, "all")}
                        disabled={busy === "all" || failed === 0}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl disabled:opacity-40">
                        <RotateCcw className="h-4 w-4" /> {busy === "all" ? "רגע..." : `לנסות שוב את כל הנכשלות${studioId ? " של העסק" : ""}`}
                    </button>
                    <button onClick={load} aria-label="רענון" className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700"><RefreshCw className="h-4 w-4" /></button>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <select value={studioId} onChange={e => setStudioId(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white">
                    <option value="">כל העסקים</option>
                    {studios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {FILTERS.map(f => (
                    <button key={f.key || "all"} type="button" onClick={() => setStatus(f.key)} aria-pressed={status === f.key}
                        className={`px-3 py-1.5 rounded-full text-sm font-semibold border ${status === f.key ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"}`}>
                        {f.label}
                    </button>
                ))}
            </div>

            {err && <p className="text-sm text-rose-600">{err}</p>}
            {jobs === null ? <p className="text-center text-slate-400 py-12">טוען...</p> : (
                <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-slate-500 border-b border-slate-100">
                                {["", "עסק", "אל", "ההודעה", "מצב", "מתי", ""].map((h, i) => <th key={i} className="text-right font-semibold px-4 py-3 whitespace-nowrap">{h}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {jobs.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-10">אין הודעות</td></tr>}
                            {jobs.map(j => {
                                const st = STATUS[j.status] ?? { label: j.status, cls: "bg-slate-100 text-slate-600" };
                                return (
                                    <tr key={j.id} className="border-b border-slate-50 last:border-0 align-top">
                                        <td className="px-4 py-3"><ChannelIcon channel={j.channel} /></td>
                                        <td className="px-4 py-3 whitespace-nowrap">
                                            <Link href={`/admin/studios/${j.studio_id}`} className="font-semibold text-slate-800 hover:underline">{j.studio_name}</Link>
                                            {j.reminder_type && <div className="text-[11px] text-slate-400">{j.reminder_type}</div>}
                                        </td>
                                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap" dir="ltr">{j.to ?? "—"}</td>
                                        <td className="px-4 py-3 text-slate-700 max-w-md">
                                            {j.subject && <div className="font-semibold">{j.subject}</div>}
                                            <div className="line-clamp-2 whitespace-pre-wrap" title={j.body}>{j.body}</div>
                                            {j.last_error && <div className="mt-1 text-xs text-rose-700 bg-rose-50 rounded px-2 py-1">{j.last_error}</div>}
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap">
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                                            {j.attempts > 0 && j.status !== "sent" && <div className="text-[11px] text-slate-400 mt-0.5">{j.attempts} ניסיונות</div>}
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-slate-500 tabular-nums">{when(j.sent_at || j.scheduled_at)}</td>
                                        <td className="px-4 py-3 whitespace-nowrap">
                                            {j.status === "failed" && (
                                                <button onClick={() => act(`/api/admin/messages/${j.id}/retry`, j.id)} disabled={busy === j.id}
                                                    className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 hover:underline disabled:opacity-50">
                                                    <RotateCcw className="h-3.5 w-3.5" /> לנסות שוב
                                                </button>
                                            )}
                                            {j.status === "pending" && (
                                                <button onClick={() => act(`/api/admin/messages/${j.id}/cancel`, j.id)} disabled={busy === j.id}
                                                    className="inline-flex items-center gap-1 text-xs font-bold text-rose-700 hover:underline disabled:opacity-50">
                                                    <X className="h-3.5 w-3.5" /> ביטול
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
