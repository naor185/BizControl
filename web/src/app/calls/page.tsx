"use client";
import { toast } from "@/lib/toast";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";

type Call = {
    id: string;
    direction: "inbound" | "outbound";
    from_number: string;
    to_number: string;
    client_id: string | null;
    client_name: string | null;
    user_id: string | null;
    answered_by_name: string | null;
    started_at: string;
    ended_at: string | null;
    duration_seconds: number | null;
    status: "answered" | "missed" | "voicemail";
    recording_url: string | null;
    transcript: string | null;
    ai_summary: Record<string, unknown> | null;
    quoted_price_cents: number | null;
    notes: string | null;
    created_at: string;
};

const STATUS_META: Record<Call["status"], { label: string; color: string }> = {
    answered:  { label: "נענתה",     color: "bg-emerald-50 text-emerald-700" },
    missed:    { label: "לא נענתה",  color: "bg-red-50 text-red-600" },
    voicemail: { label: "תא קולי",   color: "bg-amber-50 text-amber-700" },
};

const EMPTY_FORM = {
    direction: "inbound" as "inbound" | "outbound",
    phone: "",
    duration_minutes: "",
    status: "answered" as Call["status"],
    notes: "",
    quoted_price: "",
};

function fmtDuration(sec: number | null) {
    if (!sec) return "—";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtTime(iso: string) {
    const d = new Date(iso);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    const time = d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
    if (diffDays === 0) return time;
    if (diffDays === 1) return `אתמול · ${time}`;
    return `${d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" })} · ${time}`;
}

function waLink(phone: string) {
    return `https://wa.me/972${phone.replace(/\D/g, "").replace(/^0/, "")}`;
}

export default function CallsPage() {
    const router = useRouter();
    const [calls, setCalls] = useState<Call[]>([]);
    const [loading, setLoading] = useState(true);
    const [directionFilter, setDirectionFilter] = useState<"" | "inbound" | "outbound">("");
    const [statusFilter, setStatusFilter] = useState<"" | Call["status"]>("");

    const [showLogModal, setShowLogModal] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (directionFilter) params.set("direction", directionFilter);
            if (statusFilter) params.set("status", statusFilter);
            const data = await apiFetch<Call[]>(`/api/calls?${params.toString()}`);
            setCalls(data);
        } catch {
            toast.error("שגיאה בטעינת שיחות");
        } finally {
            setLoading(false);
        }
    }, [directionFilter, statusFilter]);

    useEffect(() => { load(); }, [load]);

    const submitLog = async () => {
        if (!form.phone.trim()) { toast.error("נדרש מספר טלפון"); return; }
        setSaving(true);
        try {
            await apiFetch("/api/calls", {
                method: "POST",
                body: JSON.stringify({
                    direction: form.direction,
                    phone: form.phone.trim(),
                    duration_seconds: form.duration_minutes ? Math.round(parseFloat(form.duration_minutes) * 60) : null,
                    status: form.status,
                    notes: form.notes.trim() || null,
                    quoted_price_cents: form.quoted_price ? Math.round(parseFloat(form.quoted_price) * 100) : null,
                }),
            });
            toast.success("השיחה נרשמה");
            setShowLogModal(false);
            setForm(EMPTY_FORM);
            load();
        } catch {
            toast.error("שגיאה בשמירת השיחה");
        } finally {
            setSaving(false);
        }
    };

    const createAppointment = async (call: Call) => {
        try {
            const res = await apiFetch<{ client_id: string }>(`/api/calls/${call.id}/create-appointment`, { method: "POST" });
            router.push(`/calendar?client=${res.client_id}`);
        } catch {
            toast.error("שגיאה ביצירת תור");
        }
    };

    return (
        <RequireAuth>
            <AppShell title="שיחות">
                <div className="max-w-4xl mx-auto space-y-4" dir="rtl">
                    {/* Filters + new log button */}
                    <div className="flex flex-wrap items-center gap-2">
                        <select
                            value={directionFilter}
                            onChange={e => setDirectionFilter(e.target.value as typeof directionFilter)}
                            className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white"
                        >
                            <option value="">כל הכיוונים</option>
                            <option value="inbound">נכנסות</option>
                            <option value="outbound">יוצאות</option>
                        </select>
                        <select
                            value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
                            className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white"
                        >
                            <option value="">כל הסטטוסים</option>
                            <option value="answered">נענתה</option>
                            <option value="missed">לא נענתה</option>
                            <option value="voicemail">תא קולי</option>
                        </select>
                        <div className="flex-1" />
                        <button
                            onClick={() => setShowLogModal(true)}
                            className="bg-slate-900 text-white rounded-xl px-4 py-2 text-sm font-semibold hover:bg-slate-800 transition-colors"
                        >
                            + לוג שיחה
                        </button>
                    </div>

                    {/* List */}
                    {loading ? (
                        <div className="text-center text-slate-400 py-12">טוען...</div>
                    ) : calls.length === 0 ? (
                        <div className="text-center text-slate-400 py-16 bg-white rounded-2xl border border-slate-100">
                            <div className="text-3xl mb-2">📞</div>
                            אין שיחות רשומות עדיין
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {calls.map(call => {
                                const meta = STATUS_META[call.status];
                                const phone = call.direction === "inbound" ? call.from_number : call.to_number;
                                const hasExtra = !!(call.recording_url || call.transcript || call.ai_summary);
                                const expanded = expandedId === call.id;
                                const summary = call.ai_summary as Record<string, unknown> | null;
                                return (
                                    <div key={call.id} className="bg-white rounded-2xl border border-slate-100 p-4">
                                        <div className="flex items-center gap-3">
                                            <div className="text-xl shrink-0">{call.direction === "inbound" ? "📥" : "📤"}</div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-semibold text-slate-900">
                                                        {call.client_name || phone}
                                                    </span>
                                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.color}`}>
                                                        {meta.label}
                                                    </span>
                                                    {!call.client_id && (
                                                        <span className="text-xs text-slate-400">לקוח לא מזוהה</span>
                                                    )}
                                                </div>
                                                <div className="text-xs text-slate-400 mt-0.5">
                                                    {fmtTime(call.started_at)} · {fmtDuration(call.duration_seconds)}
                                                    {call.answered_by_name ? ` · ${call.answered_by_name}` : ""}
                                                    {call.quoted_price_cents ? ` · הוצע ₪${(call.quoted_price_cents / 100).toFixed(0)}` : ""}
                                                </div>
                                                {call.notes && (
                                                    <div className="text-sm text-slate-600 mt-1 truncate">{call.notes}</div>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1.5 shrink-0">
                                                <a
                                                    href={waLink(phone)}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-emerald-50 text-emerald-600"
                                                    title="שלח וואטסאפ"
                                                >
                                                    📱
                                                </a>
                                                <button
                                                    onClick={() => createAppointment(call)}
                                                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-sky-50 text-sky-600"
                                                    title="צור תור"
                                                >
                                                    📅
                                                </button>
                                                {hasExtra && (
                                                    <button
                                                        onClick={() => setExpandedId(expanded ? null : call.id)}
                                                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500"
                                                        title="הקלטה, תמלול וסיכום AI"
                                                    >
                                                        {expanded ? "▲" : "▼"}
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {expanded && hasExtra && (
                                            <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
                                                {call.recording_url && (
                                                    <audio controls src={call.recording_url} className="w-full h-9" />
                                                )}
                                                {summary && (
                                                    <div className="bg-violet-50 border border-violet-100 rounded-xl p-3 text-sm space-y-1">
                                                        <div className="font-semibold text-violet-800 mb-1">🤖 סיכום AI</div>
                                                        {typeof summary.intent === "string" && <div><b>ביקש:</b> {summary.intent}</div>}
                                                        {typeof summary.offered === "string" && <div><b>הוצע:</b> {summary.offered}</div>}
                                                        {typeof summary.quoted_price_ils === "number" && <div><b>מחיר שהוצע:</b> ₪{summary.quoted_price_ils}</div>}
                                                        {typeof summary.objections === "string" && summary.objections && <div><b>התנגדויות:</b> {summary.objections}</div>}
                                                        {typeof summary.closing_likelihood === "string" && <div><b>סיכוי לסגירה:</b> {summary.closing_likelihood}</div>}
                                                        {typeof summary.next_step === "string" && <div><b>המלצה להמשך:</b> {summary.next_step}</div>}
                                                    </div>
                                                )}
                                                {call.transcript && (
                                                    <details className="text-sm text-slate-600">
                                                        <summary className="cursor-pointer font-medium text-slate-700">תמלול מלא</summary>
                                                        <p className="mt-2 whitespace-pre-wrap leading-relaxed">{call.transcript}</p>
                                                    </details>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {showLogModal && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" dir="rtl">
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
                            <h2 className="text-lg font-bold text-slate-900">לוג שיחה</h2>

                            <div className="flex gap-2">
                                {(["inbound", "outbound"] as const).map(d => (
                                    <button
                                        key={d}
                                        onClick={() => setForm(f => ({ ...f, direction: d }))}
                                        className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                                            form.direction === d
                                                ? "bg-slate-900 text-white border-slate-900"
                                                : "bg-white text-slate-600 border-slate-200"
                                        }`}
                                    >
                                        {d === "inbound" ? "📥 נכנסת" : "📤 יוצאת"}
                                    </button>
                                ))}
                            </div>

                            <div>
                                <label className="text-xs font-semibold text-slate-500 mb-1 block">מספר טלפון</label>
                                <input
                                    value={form.phone}
                                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                                    placeholder="050-0000000"
                                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-semibold text-slate-500 mb-1 block">משך (דקות)</label>
                                    <input
                                        type="number"
                                        value={form.duration_minutes}
                                        onChange={e => setForm(f => ({ ...f, duration_minutes: e.target.value }))}
                                        placeholder="5"
                                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-slate-500 mb-1 block">סטטוס</label>
                                    <select
                                        value={form.status}
                                        onChange={e => setForm(f => ({ ...f, status: e.target.value as Call["status"] }))}
                                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                                    >
                                        <option value="answered">נענתה</option>
                                        <option value="missed">לא נענתה</option>
                                        <option value="voicemail">תא קולי</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-semibold text-slate-500 mb-1 block">מחיר שהוצע (₪, אופציונלי)</label>
                                <input
                                    type="number"
                                    value={form.quoted_price}
                                    onChange={e => setForm(f => ({ ...f, quoted_price: e.target.value }))}
                                    placeholder="500"
                                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                                />
                            </div>

                            <div>
                                <label className="text-xs font-semibold text-slate-500 mb-1 block">הערות</label>
                                <textarea
                                    value={form.notes}
                                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                                    rows={3}
                                    placeholder="מה הלקוח ביקש, מה סוכם..."
                                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none"
                                />
                            </div>

                            <div className="flex gap-2 pt-2">
                                <button
                                    onClick={() => { setShowLogModal(false); setForm(EMPTY_FORM); }}
                                    className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold"
                                >
                                    ביטול
                                </button>
                                <button
                                    onClick={submitLog}
                                    disabled={saving}
                                    className="flex-1 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold disabled:opacity-50"
                                >
                                    {saving ? "שומר..." : "שמור שיחה"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </AppShell>
        </RequireAuth>
    );
}
