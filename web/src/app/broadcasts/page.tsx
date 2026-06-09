"use client";

import { useEffect, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";

type Broadcast = {
    id: string;
    title: string;
    body: string;
    audience: string;
    scheduled_at: string;
    status: string;
    recipient_count: number;
    sent_count: number;
    created_at: string;
};

const AUDIENCE_LABELS: Record<string, string> = {
    all: "כל הלקוחות",
    club: "חברי מועדון בלבד",
    non_club: "לא חברי מועדון",
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
    scheduled: { label: "מתוזמן", color: "bg-blue-100 text-blue-700" },
    processing: { label: "בשליחה...", color: "bg-yellow-100 text-yellow-700" },
    sent: { label: "נשלח", color: "bg-green-100 text-green-700" },
    canceled: { label: "בוטל", color: "bg-slate-100 text-slate-500" },
};

function toLocalDatetimeValue(isoStr?: string) {
    if (!isoStr) return "";
    const d = new Date(isoStr);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function BroadcastsPage() {
    const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [canceling, setCanceling] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Form state
    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [audience, setAudience] = useState("all");
    const [scheduledAt, setScheduledAt] = useState("");
    const [testPhone, setTestPhone] = useState("");
    const [sendingTest, setSendingTest] = useState(false);
    const [testResult, setTestResult] = useState<string | null>(null);

    const load = async () => {
        try {
            const data = await apiFetch<Broadcast[]>("/api/broadcasts");
            setBroadcasts(data);
        } catch { /* silent */ }
        finally { setLoading(false); }
    };

    useEffect(() => { load(); }, []);

    const resetForm = () => {
        setTitle(""); setBody(""); setAudience("all"); setScheduledAt("");
        setError(null);
    };

    const handleCreate = async () => {
        if (!title.trim() || !body.trim() || !scheduledAt) {
            setError("יש למלא כותרת, הודעה ותאריך שליחה");
            return;
        }
        const dt = new Date(scheduledAt);
        if (dt <= new Date()) {
            setError("התאריך חייב להיות בעתיד");
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await apiFetch("/api/broadcasts", {
                method: "POST",
                body: JSON.stringify({
                    title: title.trim(),
                    body: body.trim(),
                    audience,
                    scheduled_at: dt.toISOString(),
                }),
            });
            setSuccess("התפוצה נקבעה בהצלחה ✅");
            setShowForm(false);
            resetForm();
            load();
            setTimeout(() => setSuccess(null), 4000);
        } catch (e: any) {
            setError(e?.message || "שגיאה ביצירת תפוצה");
        } finally {
            setSaving(false);
        }
    };

    const handleSendTest = async () => {
        if (!body.trim()) { setTestResult("יש לכתוב תוכן הודעה קודם"); return; }
        if (!testPhone.trim()) { setTestResult("יש להזין מספר טלפון לבדיקה"); return; }
        setSendingTest(true);
        setTestResult(null);
        try {
            await apiFetch("/api/broadcasts/test", {
                method: "POST",
                body: JSON.stringify({ body: body.trim(), phone: testPhone.trim() }),
            });
            setTestResult(`✅ הודעת בדיקה נשלחה ל-${testPhone.trim()}`);
        } catch (e: any) {
            setTestResult(`❌ שגיאה: ${e?.message || "שגיאה בשליחה"}`);
        } finally {
            setSendingTest(false);
        }
    };

    const handleCancel = async (id: string) => {
        if (!confirm("לבטל את התפוצה הזו?")) return;
        setCanceling(id);
        try {
            await apiFetch(`/api/broadcasts/${id}`, { method: "DELETE" });
            load();
        } catch (e: any) {
            alert(e?.message || "שגיאה בביטול");
        } finally {
            setCanceling(null);
        }
    };

    const upcoming = broadcasts.filter(b => b.status === "scheduled");
    const past = broadcasts.filter(b => b.status !== "scheduled");

    return (
        <RequireAuth>
            <AppShell title="הודעות תפוצה">
                <div className="space-y-6 max-w-3xl mx-auto">

                    {/* Header */}
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900">הודעות תפוצה</h1>
                            <p className="text-sm text-slate-500 mt-0.5">שלח הודעת וואטסאפ לקבוצת לקוחות בתאריך ושעה שתבחר</p>
                        </div>
                        {!showForm && (
                            <button
                                onClick={() => { setShowForm(true); setError(null); }}
                                className="px-5 py-2.5 bg-slate-900 text-white text-sm font-bold rounded-xl hover:bg-slate-700 transition"
                            >
                                + תפוצה חדשה
                            </button>
                        )}
                    </div>

                    {success && (
                        <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-xl px-4 py-3 font-medium">{success}</div>
                    )}

                    {/* New broadcast form */}
                    {showForm && (
                        <div className="bg-white rounded-2xl border-2 border-slate-200 shadow-sm p-6 space-y-4">
                            <h2 className="font-bold text-slate-800 text-lg">תפוצה חדשה</h2>

                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">כותרת פנימית (לא נשלחת ללקוח)</label>
                                <input
                                    type="text"
                                    placeholder='למשל: "מבצע חגי קיץ"'
                                    value={title}
                                    onChange={e => setTitle(e.target.value)}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-400"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">תוכן ההודעה</label>
                                <textarea
                                    rows={5}
                                    placeholder="כתוב את ההודעה שתשלח ללקוחות..."
                                    value={body}
                                    onChange={e => setBody(e.target.value)}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-400 resize-none"
                                />
                                <div className="text-xs text-slate-400 text-left mt-0.5">{body.length} תווים</div>
                            </div>

                            {/* Test message */}
                            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
                                <div className="text-sm font-semibold text-slate-700">📱 שלח הודעת בדיקה</div>
                                <div className="text-xs text-slate-400">שלח לעצמך כדי לראות איך ההודעה תיראה לפני השליחה הרשמית</div>
                                <div className="flex gap-2">
                                    <input
                                        type="tel"
                                        placeholder="מספר טלפון לבדיקה..."
                                        value={testPhone}
                                        onChange={e => { setTestPhone(e.target.value); setTestResult(null); }}
                                        className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-400"
                                        dir="ltr"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleSendTest}
                                        disabled={sendingTest}
                                        className="px-4 py-2 bg-slate-700 text-white text-sm font-bold rounded-xl hover:bg-slate-900 disabled:opacity-40 transition shrink-0"
                                    >
                                        {sendingTest ? "שולח..." : "שלח בדיקה"}
                                    </button>
                                </div>
                                {testResult && (
                                    <div className={`text-xs font-medium px-3 py-1.5 rounded-lg ${testResult.startsWith("✅") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                                        {testResult}
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">קהל יעד</label>
                                    <select
                                        value={audience}
                                        onChange={e => setAudience(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-400"
                                    >
                                        <option value="all">כל הלקוחות</option>
                                        <option value="club">חברי מועדון בלבד</option>
                                        <option value="non_club">לא חברי מועדון</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">תאריך ושעת שליחה</label>
                                    <input
                                        type="datetime-local"
                                        value={scheduledAt}
                                        onChange={e => setScheduledAt(e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-400"
                                        dir="ltr"
                                    />
                                </div>
                            </div>

                            {error && (
                                <div className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{error}</div>
                            )}

                            <div className="flex gap-3 pt-1">
                                <button
                                    onClick={handleCreate}
                                    disabled={saving}
                                    className="flex-1 py-3 bg-slate-900 text-white text-sm font-bold rounded-xl hover:bg-slate-700 disabled:opacity-40 transition"
                                >
                                    {saving ? "שומר..." : "קבע תפוצה 📨"}
                                </button>
                                <button
                                    onClick={() => { setShowForm(false); resetForm(); }}
                                    className="px-5 py-3 text-sm font-semibold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition"
                                >
                                    ביטול
                                </button>
                            </div>
                        </div>
                    )}

                    {loading ? (
                        <div className="flex justify-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900" />
                        </div>
                    ) : (
                        <>
                            {/* Upcoming */}
                            {upcoming.length > 0 && (
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                                    <div className="px-6 py-4 border-b border-slate-100 bg-blue-50/50">
                                        <h2 className="font-bold text-slate-800">מתוזמנות ({upcoming.length})</h2>
                                    </div>
                                    <div className="divide-y divide-slate-50">
                                        {upcoming.map(b => (
                                            <BroadcastRow
                                                key={b.id}
                                                b={b}
                                                onCancel={handleCancel}
                                                canceling={canceling === b.id}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}

                            {upcoming.length === 0 && !showForm && (
                                <div className="text-center py-10 text-slate-400 text-sm bg-white rounded-2xl border border-dashed border-slate-200">
                                    אין תפוצות מתוזמנות — לחץ "+ תפוצה חדשה" כדי ליצור
                                </div>
                            )}

                            {/* History */}
                            {past.length > 0 && (
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                                    <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                                        <h2 className="font-bold text-slate-800">היסטוריה ({past.length})</h2>
                                    </div>
                                    <div className="divide-y divide-slate-50">
                                        {past.map(b => (
                                            <BroadcastRow key={b.id} b={b} onCancel={handleCancel} canceling={false} />
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </AppShell>
        </RequireAuth>
    );
}

function BroadcastRow({ b, onCancel, canceling }: { b: Broadcast; onCancel: (id: string) => void; canceling: boolean }) {
    const [expanded, setExpanded] = useState(false);
    const s = STATUS_LABELS[b.status] || { label: b.status, color: "bg-slate-100 text-slate-500" };
    const dt = new Date(b.scheduled_at);
    const dateStr = dt.toLocaleDateString("he-IL", { weekday: "short", day: "2-digit", month: "2-digit", year: "2-digit" });
    const timeStr = dt.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });

    return (
        <div className="px-6 py-4">
            <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-800">{b.title}</span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.color}`}>{s.label}</span>
                        <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{AUDIENCE_LABELS[b.audience] || b.audience}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                        {dateStr} · {timeStr}
                        {b.status === "sent" && (
                            <span className="mr-2 text-green-600 font-medium">נשלח ל-{b.sent_count} נמענים</span>
                        )}
                        {b.status === "scheduled" && b.recipient_count > 0 && (
                            <span className="mr-2 text-blue-600 font-medium">~{b.recipient_count} נמענים מתוכננים</span>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={() => setExpanded(v => !v)}
                        className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-50 transition"
                    >
                        {expanded ? "הסתר ▲" : "הצג הודעה ▼"}
                    </button>
                    {b.status === "scheduled" && (
                        <button
                            onClick={() => onCancel(b.id)}
                            disabled={canceling}
                            className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded-lg hover:bg-red-50 transition disabled:opacity-50"
                        >
                            {canceling ? "..." : "בטל"}
                        </button>
                    )}
                </div>
            </div>
            {expanded && (
                <div className="mt-3 bg-slate-50 rounded-xl px-4 py-3 text-sm text-slate-700 whitespace-pre-wrap border border-slate-100">
                    {b.body}
                </div>
            )}
        </div>
    );
}
