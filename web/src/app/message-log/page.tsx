"use client";

import { useEffect, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";

type MessageJob = {
    id: string;
    channel: string;
    to_phone: string;
    body: string;
    scheduled_at: string;
    status: string;
    attempts: number;
    last_error?: string | null;
    sent_at?: string | null;
    created_at: string;
};

export default function MessageLogPage() {
    const [jobs, setJobs] = useState<MessageJob[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [processingId, setProcessingId] = useState<string | null>(null);

    const loadJobs = async () => {
        try {
            const data = await apiFetch<MessageJob[]>("/api/messages");
            setJobs(data);
        } catch (e: any) {
            setErr(e?.message || "שגיאה בטעינת תור ההודעות");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadJobs();
    }, []);

    const handleAction = async (id: string, action: 'retry' | 'cancel') => {
        try {
            setProcessingId(id);
            await apiFetch(`/api/messages/${id}/${action}`, { method: "POST" });
            loadJobs();
        } catch (e: any) {
            alert(e?.message || `שגיאה בביצוע פעולת ${action}`);
        } finally {
            setProcessingId(null);
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'sent': return <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-full">נשלח ✅</span>;
            case 'pending': return <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-full animate-pulse">בהמתנה ⏳</span>;
            case 'failed': return <span className="px-2 py-1 bg-rose-100 text-rose-700 text-xs font-bold rounded-full">נכשל ❌</span>;
            case 'canceled': return <span className="px-2 py-1 bg-slate-100 text-slate-500 text-xs font-bold rounded-full">בוטל 🚫</span>;
            default: return <span className="px-2 py-1 bg-slate-100 text-slate-500 text-xs font-bold rounded-full">{status}</span>;
        }
    };

    const getChannelIcon = (channel: string) => {
        if (channel === 'whatsapp') return <span title="WhatsApp">🟢</span>;
        if (channel === 'sms') return <span title="SMS">📱</span>;
        if (channel === 'email') return <span title="Email">✉️</span>;
        return channel;
    };

    return (
        <RequireAuth>
            <AppShell title="יומן הודעות ואוטומציה">
                <div className="space-y-6 animate-in fade-in duration-500">
                    <div className="bg-white rounded-3xl border border-slate-100 shadow-xl overflow-hidden">
                        <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                            <div>
                                <h3 className="text-xl font-bold text-slate-800">תור הודעות (Queue) 🤖</h3>
                                <p className="text-sm text-slate-500 mt-1">מעקב אחרי הודעות אישור תור, תזכורות וצבירת נקודות</p>
                            </div>
                            <button
                                onClick={() => { setLoading(true); loadJobs(); }}
                                className="p-2 hover:bg-slate-200 rounded-full transition-colors"
                                title="רענן נתונים"
                            >
                                🔄
                            </button>
                        </div>

                        {loading ? (
                            <div className="p-12 text-center text-slate-400">טוען נתונים...</div>
                        ) : err ? (
                            <div className="p-8 text-rose-500 bg-rose-50 m-6 rounded-2xl border border-rose-100">{err}</div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-right">
                                    <thead>
                                        <tr className="bg-slate-50 text-slate-500 text-xs font-bold uppercase tracking-widest border-b border-slate-100">
                                            <th className="px-8 py-4 w-12 text-center">ערוץ</th>
                                            <th className="px-8 py-4">נמען</th>
                                            <th className="px-8 py-4">תוכן ההודעה</th>
                                            <th className="px-8 py-4">סטטוס</th>
                                            <th className="px-8 py-4">זמן שליחה</th>
                                            <th className="px-8 py-4 text-center">פעולות</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {jobs.length === 0 ? (
                                            <tr>
                                                <td colSpan={6} className="px-8 py-12 text-center text-slate-400 italic">לא נמצאו הודעות בתור</td>
                                            </tr>
                                        ) : jobs.map((j) => (
                                            <tr key={j.id} className="hover:bg-slate-50/80 transition-colors group">
                                                <td className="px-8 py-5 text-center text-xl">
                                                    {getChannelIcon(j.channel)}
                                                </td>
                                                <td className="px-8 py-5">
                                                    <div className="font-bold text-slate-800" dir="ltr">
                                                        {j.to_phone}
                                                    </div>
                                                </td>
                                                <td className="px-8 py-5">
                                                    <div className="text-sm text-slate-600 max-w-xs truncate group-hover:whitespace-normal group-hover:overflow-visible transition-all">
                                                        {j.body}
                                                    </div>
                                                    {j.last_error && (
                                                        <div className="text-[10px] text-rose-500 mt-1 bg-rose-50 px-2 py-0.5 rounded border border-rose-100">
                                                            שגיאה: {j.last_error}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-8 py-5">
                                                    {getStatusBadge(j.status)}
                                                </td>
                                                <td className="px-8 py-5">
                                                    <div className="text-xs font-bold text-slate-500">
                                                        {new Date(j.scheduled_at).toLocaleDateString('he-IL')}
                                                    </div>
                                                    <div className="text-[10px] text-slate-400">
                                                        {new Date(j.scheduled_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                                                    </div>
                                                </td>
                                                <td className="px-8 py-5 text-center">
                                                    <div className="flex justify-center gap-2">
                                                        {j.status === 'failed' && (
                                                            <button
                                                                onClick={() => handleAction(j.id, 'retry')}
                                                                disabled={processingId === j.id}
                                                                className="p-1 px-2 bg-emerald-50 text-emerald-600 text-xs font-bold border border-emerald-100 rounded hover:bg-emerald-100 disabled:opacity-50"
                                                            >
                                                                נסה שוב 🔁
                                                            </button>
                                                        )}
                                                        {j.status === 'pending' && (
                                                            <button
                                                                onClick={() => handleAction(j.id, 'cancel')}
                                                                disabled={processingId === j.id}
                                                                className="p-1 px-2 bg-rose-50 text-rose-600 text-xs font-bold border border-rose-100 rounded hover:bg-rose-100 disabled:opacity-50"
                                                            >
                                                                ביטול 🚫
                                                            </button>
                                                        )}
                                                        {j.status === 'sent' && <span className="text-slate-300">---</span>}
                                                    </div>
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
