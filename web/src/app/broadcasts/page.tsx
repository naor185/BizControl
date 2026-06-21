"use client";

import { useEffect, useRef, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { apiFetch, API_BASE } from "@/lib/api";

type Broadcast = {
    id: string;
    title: string;
    body: string;
    audience: string;
    scheduled_at: string;
    status: string;
    recipient_count: number;
    sent_count: number;
    media_url?: string | null;
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

    // Media state
    const [mediaUrl, setMediaUrl] = useState<string | null>(null);
    const [mediaPreview, setMediaPreview] = useState<string | null>(null);
    const [mediaIsVideo, setMediaIsVideo] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

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
        setMediaUrl(null); setMediaPreview(null); setMediaIsVideo(false);
        setError(null);
    };

    const handleMediaSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const isVid = file.type.startsWith("video/");
        setMediaIsVideo(isVid);
        setMediaPreview(URL.createObjectURL(file));
        setUploading(true);
        setMediaUrl(null);
        try {
            const form = new FormData();
            form.append("file", file);
            const token = typeof window !== "undefined" ? localStorage.getItem("bizcontrol_token") : null;
            const res = await fetch(`${API_BASE}/api/broadcasts/upload-media`, {
                method: "POST",
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                body: form,
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err?.detail || "שגיאה בהעלאה");
            }
            const data = await res.json();
            setMediaUrl(data.url);
        } catch (err: any) {
            setError(err?.message || "שגיאה בהעלאת הקובץ");
            setMediaPreview(null);
            setMediaIsVideo(false);
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const removeMedia = () => {
        setMediaUrl(null);
        setMediaPreview(null);
        setMediaIsVideo(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
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
        if (uploading) {
            setError("אנא המתן לסיום העלאת הקובץ");
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
                    media_url: mediaUrl || null,
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
                body: JSON.stringify({ body: body.trim(), phone: testPhone.trim(), media_url: mediaUrl || null }),
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
                                type="button"
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

                            {/* Media upload */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">תמונה / סרטון (אופציונלי)</label>
                                {mediaPreview ? (
                                    <div className="relative w-fit">
                                        {mediaIsVideo ? (
                                            <video
                                                src={mediaPreview}
                                                className="h-40 rounded-xl object-cover border border-slate-200"
                                                controls
                                            />
                                        ) : (
                                            <img
                                                src={mediaPreview}
                                                alt="תצוגה מקדימה"
                                                className="h-40 rounded-xl object-cover border border-slate-200"
                                            />
                                        )}
                                        {uploading && (
                                            <div className="absolute inset-0 bg-white/70 flex items-center justify-center rounded-xl">
                                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-slate-700" />
                                            </div>
                                        )}
                                        {!uploading && (
                                            <button
                                                onClick={removeMedia}
                                                className="absolute top-1.5 right-1.5 bg-white/90 hover:bg-white text-slate-600 hover:text-red-600 rounded-full p-1 shadow transition"
                                                title="הסר מדיה"
                                            >
                                                ✕
                                            </button>
                                        )}
                                        {!uploading && mediaUrl && (
                                            <div className="text-xs text-green-600 mt-1 font-medium">✅ הקובץ הועלה בהצלחה</div>
                                        )}
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        className="flex items-center gap-2 px-4 py-3 bg-slate-50 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 text-sm hover:border-slate-400 hover:bg-slate-100 transition w-full justify-center"
                                    >
                                        <span className="text-lg">📎</span>
                                        <span>לחץ להוספת תמונה או סרטון</span>
                                    </button>
                                )}
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    title="העלה תמונה או סרטון"
                                    accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/x-msvideo,video/3gpp,video/webm"
                                    onChange={handleMediaSelect}
                                    className="hidden"
                                />
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
                                        disabled={sendingTest || uploading}
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
                                        title="קהל יעד"
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
                                        title="תאריך ושעת שליחה"
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
                                    type="button"
                                    onClick={handleCreate}
                                    disabled={saving || uploading}
                                    className="flex-1 py-3 bg-slate-900 text-white text-sm font-bold rounded-xl hover:bg-slate-700 disabled:opacity-40 transition"
                                >
                                    {saving ? "שומר..." : uploading ? "מעלה קובץ..." : "קבע תפוצה 📨"}
                                </button>
                                <button
                                    type="button"
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
    const isVid = b.media_url ? /\.(mp4|mov|avi|3gp|webm)(\?|$)/i.test(b.media_url) : false;

    return (
        <div className="px-6 py-4">
            <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-800">{b.title}</span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.color}`}>{s.label}</span>
                        <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{AUDIENCE_LABELS[b.audience] || b.audience}</span>
                        {b.media_url && (
                            <span className="text-xs text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">{isVid ? "🎬 סרטון" : "🖼️ תמונה"}</span>
                        )}
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
                        type="button"
                        onClick={() => setExpanded(v => !v)}
                        className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-50 transition"
                    >
                        {expanded ? "הסתר ▲" : "הצג הודעה ▼"}
                    </button>
                    {b.status === "scheduled" && (
                        <button
                            type="button"
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
                <div className="mt-3 space-y-2">
                    <div className="bg-slate-50 rounded-xl px-4 py-3 text-sm text-slate-700 whitespace-pre-wrap border border-slate-100">
                        {b.body}
                    </div>
                    {b.media_url && (
                        isVid ? (
                            <video src={b.media_url} controls className="h-40 rounded-xl border border-slate-200 object-cover" />
                        ) : (
                            <img src={b.media_url} alt="מדיה" className="h-40 rounded-xl border border-slate-200 object-cover" />
                        )
                    )}
                </div>
            )}
        </div>
    );
}
