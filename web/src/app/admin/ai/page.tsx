"use client";
import { toast } from "@/lib/toast";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

type AIStats = {
    total_conversations: number;
    total_messages: number;
    total_tokens: number;
    estimated_cost_usd: number;
    blocked_attempts: number;
    tool_calls: number;
    active_studios: number;
};

type AuditLog = {
    id: string;
    event_type: string;
    studio_id: string | null;
    user_id: string | null;
    details: Record<string, unknown> | null;
    created_at: string;
};

type Conversation = {
    id: string;
    studio_id: string;
    studio_name: string;
    message_count: number;
    total_tokens: number;
    created_at: string;
};

const EVENT_COLORS: Record<string, string> = {
    message: "bg-emerald-50 text-emerald-700 border-emerald-200",
    tool_call: "bg-blue-50 text-blue-700 border-blue-200",
    blocked: "bg-red-50 text-red-700 border-red-200",
    blocked_tool: "bg-orange-50 text-orange-700 border-orange-200",
    error: "bg-rose-50 text-rose-700 border-rose-200",
    rate_limited: "bg-amber-50 text-amber-700 border-amber-200",
};

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
    return (
        <div className={`bg-white rounded-2xl border p-5 shadow-sm ${color}`}>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">{label}</div>
            <div className="text-2xl font-black text-slate-900">{typeof value === "number" ? value.toLocaleString("he-IL") : value}</div>
            {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
        </div>
    );
}

export default function AdminAIPage() {
    const [stats, setStats] = useState<AIStats | null>(null);
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<"overview" | "logs" | "conversations">("overview");
    const [logFilter, setLogFilter] = useState<string>("all");

    const load = async () => {
        setLoading(true);
        try {
            const [s, l, c] = await Promise.all([
                apiFetch<AIStats>("/api/ai/admin/stats"),
                apiFetch<AuditLog[]>("/api/ai/admin/logs?limit=100"),
                apiFetch<Conversation[]>("/api/ai/admin/conversations?limit=50"),
            ]);
            setStats(s);
            setLogs(l);
            setConversations(c);
        } catch {
            toast.error("שגיאה בטעינת נתוני AI");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const filteredLogs = logFilter === "all" ? logs : logs.filter(l => l.event_type === logFilter);

    const formatDate = (iso: string) =>
        new Date(iso).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

    return (
        <div className="max-w-5xl mx-auto py-8 px-4 space-y-8" dir="rtl">

            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-black text-slate-900">AI Assistant — ניהול</h1>
                    <p className="text-slate-500 text-sm mt-1">ניטור שיחות, שימוש ב-Tokens, ואירועי אבטחה</p>
                </div>
                <button
                    onClick={load}
                    className="px-4 py-2 text-sm font-bold bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                >
                    רענן
                </button>
            </div>

            {loading ? (
                <div className="flex justify-center py-16">
                    <div className="w-10 h-10 rounded-full border-4 border-slate-200 border-t-indigo-500 animate-spin" />
                </div>
            ) : (
                <>
                    {/* Stats grid */}
                    {stats && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <StatCard label="שיחות" value={stats.total_conversations} color="border-indigo-100" />
                            <StatCard label="הודעות" value={stats.total_messages} color="border-blue-100" />
                            <StatCard label="Tokens" value={stats.total_tokens.toLocaleString()} sub={`~$${stats.estimated_cost_usd}`} color="border-purple-100" />
                            <StatCard label="סטודיואים פעילים" value={stats.active_studios} color="border-emerald-100" />
                            <StatCard label="קריאות לכלים" value={stats.tool_calls} color="border-sky-100" />
                            <StatCard label="ניסיונות חסומים" value={stats.blocked_attempts} color="border-red-100" />
                        </div>
                    )}

                    {/* Tabs */}
                    <div className="flex gap-1 p-1 bg-slate-100 rounded-2xl w-fit">
                        {(["overview", "logs", "conversations"] as const).map(t => (
                            <button
                                key={t}
                                onClick={() => setTab(t)}
                                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${tab === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                            >
                                {t === "overview" ? "📊 סקירה" : t === "logs" ? "🔍 Audit Log" : "💬 שיחות"}
                            </button>
                        ))}
                    </div>

                    {/* Audit Logs */}
                    {tab === "logs" && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 flex-wrap">
                                {["all", "message", "tool_call", "blocked", "blocked_tool", "error"].map(f => (
                                    <button
                                        key={f}
                                        onClick={() => setLogFilter(f)}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${logFilter === f ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300"}`}
                                    >
                                        {f === "all" ? "הכל" : f}
                                    </button>
                                ))}
                            </div>
                            <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-slate-100 bg-slate-50">
                                                <th className="text-right px-4 py-3 text-xs font-bold text-slate-500">זמן</th>
                                                <th className="text-right px-4 py-3 text-xs font-bold text-slate-500">סוג</th>
                                                <th className="text-right px-4 py-3 text-xs font-bold text-slate-500">פרטים</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredLogs.slice(0, 50).map(log => (
                                                <tr key={log.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                                                    <td className="px-4 py-2.5 text-slate-400 text-xs whitespace-nowrap font-mono">
                                                        {formatDate(log.created_at)}
                                                    </td>
                                                    <td className="px-4 py-2.5">
                                                        <span className={`inline-flex text-[11px] font-bold px-2 py-0.5 rounded-full border ${EVENT_COLORS[log.event_type] || "bg-slate-50 text-slate-600 border-slate-200"}`}>
                                                            {log.event_type}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-2.5 text-slate-600 text-xs max-w-xs truncate">
                                                        {log.details
                                                            ? (() => {
                                                                const d = log.details as Record<string, unknown>;
                                                                if (d.message) return `"${String(d.message).slice(0, 80)}"`;
                                                                if (d.tool) return `כלי: ${d.tool}`;
                                                                if (d.question) return `"${String(d.question).slice(0, 80)}"`;
                                                                return JSON.stringify(d).slice(0, 100);
                                                              })()
                                                            : "—"
                                                        }
                                                    </td>
                                                </tr>
                                            ))}
                                            {filteredLogs.length === 0 && (
                                                <tr>
                                                    <td colSpan={3} className="px-4 py-8 text-center text-slate-400 text-sm">
                                                        אין רשומות
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Conversations */}
                    {tab === "conversations" && (
                        <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm">
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-100 bg-slate-50">
                                            <th className="text-right px-4 py-3 text-xs font-bold text-slate-500">סטודיו</th>
                                            <th className="text-right px-4 py-3 text-xs font-bold text-slate-500">הודעות</th>
                                            <th className="text-right px-4 py-3 text-xs font-bold text-slate-500">Tokens</th>
                                            <th className="text-right px-4 py-3 text-xs font-bold text-slate-500">תאריך</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {conversations.map(c => (
                                            <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                                                <td className="px-4 py-2.5 font-medium text-slate-800">{c.studio_name}</td>
                                                <td className="px-4 py-2.5 text-slate-600">{c.message_count}</td>
                                                <td className="px-4 py-2.5 text-slate-600">{c.total_tokens.toLocaleString()}</td>
                                                <td className="px-4 py-2.5 text-slate-400 text-xs font-mono whitespace-nowrap">{formatDate(c.created_at)}</td>
                                            </tr>
                                        ))}
                                        {conversations.length === 0 && (
                                            <tr>
                                                <td colSpan={4} className="px-4 py-8 text-center text-slate-400 text-sm">
                                                    אין שיחות עדיין
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Overview tab */}
                    {tab === "overview" && (
                        <div className="grid md:grid-cols-2 gap-6">
                            <div className="bg-white rounded-3xl border border-slate-100 p-6 shadow-sm space-y-3">
                                <h3 className="font-bold text-slate-800">אירועי אבטחה אחרונים</h3>
                                <div className="space-y-2">
                                    {logs.filter(l => ["blocked", "blocked_tool"].includes(l.event_type)).slice(0, 5).map(log => (
                                        <div key={log.id} className="flex items-center gap-3 p-2.5 bg-red-50 rounded-xl border border-red-100">
                                            <span className="text-red-500 text-lg">🛡️</span>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-xs font-bold text-red-700">{log.event_type}</div>
                                                <div className="text-xs text-red-500 truncate">
                                                    {(log.details as Record<string, unknown>)?.message
                                                        ? `"${String((log.details as Record<string, unknown>).message).slice(0, 60)}"`
                                                        : (log.details as Record<string, unknown>)?.tool
                                                        ? `כלי: ${(log.details as Record<string, unknown>).tool}`
                                                        : "—"}
                                                </div>
                                            </div>
                                            <div className="text-[10px] text-slate-400 whitespace-nowrap">{formatDate(log.created_at)}</div>
                                        </div>
                                    ))}
                                    {logs.filter(l => ["blocked", "blocked_tool"].includes(l.event_type)).length === 0 && (
                                        <p className="text-slate-400 text-sm text-center py-4">אין ניסיונות חסומים</p>
                                    )}
                                </div>
                            </div>

                            <div className="bg-white rounded-3xl border border-slate-100 p-6 shadow-sm space-y-3">
                                <h3 className="font-bold text-slate-800">שיחות אחרונות</h3>
                                <div className="space-y-2">
                                    {conversations.slice(0, 5).map(c => (
                                        <div key={c.id} className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl">
                                            <div>
                                                <div className="text-sm font-semibold text-slate-800">{c.studio_name}</div>
                                                <div className="text-xs text-slate-400">{c.message_count} הודעות · {c.total_tokens.toLocaleString()} tokens</div>
                                            </div>
                                            <div className="text-[10px] text-slate-400">{formatDate(c.created_at)}</div>
                                        </div>
                                    ))}
                                    {conversations.length === 0 && (
                                        <p className="text-slate-400 text-sm text-center py-4">אין שיחות עדיין</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
