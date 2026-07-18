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

type AutomationSettings = {
    welcome_wa_template?: string | null;
    non_member_wa_template?: string | null;
    birthday_wa_template?: string | null;
    bit_link?: string | null;
    paybox_link?: string | null;
    studio_address?: string | null;
    studio_name?: string | null;
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

// Templates that are relevant for broadcast use
const BROADCAST_TEMPLATES = [
    { key: "non_member_wa_template", label: "הזמנה למועדון לקוחות", icon: "🌟", desc: "שלח ללקוחות שאינם חברים" },
    { key: "welcome_wa_template", label: "ברוך הבא / עדכון כללי", icon: "👋", desc: "הודעת ברוכים הבאים או כללית" },
    { key: "birthday_wa_template", label: "הודעת יום הולדת", icon: "🎂", desc: "מבצע / הטבה ליום הולדת" },
];

export default function BroadcastsPage() {
    const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [canceling, setCanceling] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Shabbat block setting
    const [blockShabbat, setBlockShabbat] = useState(false);

    // Automation settings (templates + links)
    const [autoSettings, setAutoSettings] = useState<AutomationSettings>({});
    const [studioId, setStudioId] = useState<string>("");

    // Form state
    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [audience, setAudience] = useState("all");
    const [scheduledAt, setScheduledAt] = useState("");
    const [testPhone, setTestPhone] = useState("");
    const [sendingTest, setSendingTest] = useState(false);
    const [testResult, setTestResult] = useState<string | null>(null);

    // Template picker
    const [showTemplates, setShowTemplates] = useState(false);

    // Media state
    const [mediaUrl, setMediaUrl] = useState<string | null>(null);
    const [mediaPreview, setMediaPreview] = useState<string | null>(null);
    const [mediaIsVideo, setMediaIsVideo] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const load = async () => {
        try {
            const data = await apiFetch<Broadcast[]>("/api/broadcasts");
            setBroadcasts(data);
        } catch { /* silent */ }
        finally { setLoading(false); }
    };

    useEffect(() => {
        load();
        Promise.all([
            apiFetch<{ block_shabbat_messages: boolean }>("/api/studio/automation"),
            apiFetch<AutomationSettings>("/api/studio/automation"),
            apiFetch<{ studio_id: string }>("/api/auth/me"),
        ]).then(([shabbat, settings, me]) => {
            setBlockShabbat((shabbat as any).block_shabbat_messages ?? false);
            setAutoSettings(settings);
            setStudioId(me.studio_id);
        }).catch(() => {});
    }, []);

    const clubJoinLink = studioId
        ? `${typeof window !== "undefined" ? window.location.origin : ""}/join/${studioId}`
        : "";

    const giftCardShopLink = studioId
        ? `${typeof window !== "undefined" ? window.location.origin : ""}/gift/${studioId}`
        : "";

    // Insert text at cursor position in textarea
    const insertAtCursor = (text: string) => {
        const ta = textareaRef.current;
        if (!ta) {
            setBody(prev => prev ? prev + "\n" + text : text);
            return;
        }
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const before = body.slice(0, start);
        const after = body.slice(end);
        const separator = before && !before.endsWith("\n") ? "\n" : "";
        const newBody = before + separator + text + after;
        setBody(newBody);
        // Restore cursor
        setTimeout(() => {
            ta.focus();
            const pos = start + separator.length + text.length;
            ta.setSelectionRange(pos, pos);
        }, 0);
    };

    const applyTemplate = (templateBody: string) => {
        setBody(templateBody);
        setShowTemplates(false);
    };

    const appendTemplate = (templateBody: string) => {
        setBody(prev => prev ? prev + "\n\n" + templateBody : templateBody);
        setShowTemplates(false);
    };

    const resetForm = () => {
        setTitle(""); setBody(""); setAudience("all"); setScheduledAt("");
        setMediaUrl(null); setMediaPreview(null); setMediaIsVideo(false);
        setShowTemplates(false);
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

    const handleDuplicate = (b: Broadcast) => {
        setTitle(b.title);
        setBody(b.body);
        setAudience(b.audience);
        setScheduledAt("");
        if (b.media_url) {
            setMediaUrl(b.media_url);
            setMediaPreview(b.media_url);
            setMediaIsVideo(/\.(mp4|mov|avi|3gp|webm)(\?|$)/i.test(b.media_url));
        } else {
            setMediaUrl(null); setMediaPreview(null); setMediaIsVideo(false);
        }
        setShowTemplates(false);
        setError(null);
        setSuccess(null);
        setShowForm(true);
        if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
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
                <div className="space-y-6 max-w-3xl mx-auto" dir="rtl">

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

                            {/* Message body + toolbar */}
                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="text-sm font-semibold text-slate-700">תוכן ההודעה</label>
                                    <button
                                        type="button"
                                        onClick={() => setShowTemplates(v => !v)}
                                        className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1"
                                    >
                                        📋 {showTemplates ? "הסתר טמפלטים" : "בחר מטמפלט"}
                                    </button>
                                </div>

                                {/* Template picker panel */}
                                {showTemplates && (
                                    <div className="mb-3 bg-blue-50 border border-blue-100 rounded-xl p-3 space-y-2">
                                        <div className="text-xs font-bold text-blue-700 mb-1">בחר טמפלט — לחץ להחלפה או להוספה בסוף</div>
                                        {BROADCAST_TEMPLATES.map(t => {
                                            const tmplBody = (autoSettings as any)[t.key] as string | null | undefined;
                                            if (!tmplBody) return null;
                                            return (
                                                <div key={t.key} className="bg-white rounded-xl border border-blue-100 p-3">
                                                    <div className="flex items-center justify-between gap-2 mb-1.5">
                                                        <span className="text-sm font-semibold text-slate-700">{t.icon} {t.label}</span>
                                                        <div className="flex gap-1.5 shrink-0">
                                                            <button type="button" onClick={() => appendTemplate(tmplBody)}
                                                                className="text-xs px-2.5 py-1 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 font-medium">
                                                                + הוסף
                                                            </button>
                                                            <button type="button" onClick={() => applyTemplate(tmplBody)}
                                                                className="text-xs px-2.5 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium">
                                                                החלף
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2 whitespace-pre-wrap line-clamp-3 font-mono">
                                                        {tmplBody}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {BROADCAST_TEMPLATES.every(t => !(autoSettings as any)[t.key]) && (
                                            <div className="text-xs text-blue-500 text-center py-2">
                                                לא הוגדרו טמפלטים — הגדר אותם בעמוד <a href="/message-templates" className="underline font-semibold">תבניות הודעות</a>
                                            </div>
                                        )}
                                    </div>
                                )}

                                <textarea
                                    ref={textareaRef}
                                    rows={5}
                                    placeholder="כתוב את ההודעה שתשלח ללקוחות... השתמש ב-{client_name} להתאמה אישית"
                                    value={body}
                                    onChange={e => setBody(e.target.value)}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-400 resize-none"
                                />
                                <div className="text-xs text-slate-400 text-left mt-0.5">{body.length} תווים</div>

                                {/* Quick insert toolbar */}
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    <span className="text-xs text-slate-400 font-medium self-center ml-1">הוסף:</span>
                                    <button type="button"
                                        onClick={() => insertAtCursor("{client_name}")}
                                        className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 font-mono">
                                        {"{client_name}"}
                                    </button>
                                    {clubJoinLink && (
                                        <button type="button"
                                            onClick={() => insertAtCursor(`🌟 הצטרף למועדון הלקוחות שלנו:\n${clubJoinLink}`)}
                                            className="text-xs px-2.5 py-1 rounded-lg bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 font-medium">
                                            🌟 לינק מועדון
                                        </button>
                                    )}
                                    {giftCardShopLink && (
                                        <button type="button"
                                            onClick={() => insertAtCursor(`🎁 כרטיס מתנה לך או למישהו שאתה אוהב:\n${giftCardShopLink}`)}
                                            className="text-xs px-2.5 py-1 rounded-lg bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 font-medium">
                                            🎁 לינק כרטיס מתנה
                                        </button>
                                    )}
                                    {autoSettings.bit_link && (
                                        <button type="button"
                                            onClick={() => insertAtCursor(`לתשלום ב-Bit: ${autoSettings.bit_link}`)}
                                            className="text-xs px-2.5 py-1 rounded-lg bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 font-medium">
                                            💰 Bit
                                        </button>
                                    )}
                                    {autoSettings.paybox_link && (
                                        <button type="button"
                                            onClick={() => insertAtCursor(`לתשלום ב-PayBox: ${autoSettings.paybox_link}`)}
                                            className="text-xs px-2.5 py-1 rounded-lg bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 font-medium">
                                            💳 PayBox
                                        </button>
                                    )}
                                    {autoSettings.studio_address && (
                                        <button type="button"
                                            onClick={() => insertAtCursor(`📍 ${autoSettings.studio_address}`)}
                                            className="text-xs px-2.5 py-1 rounded-lg bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 font-medium">
                                            📍 כתובת
                                        </button>
                                    )}
                                    <button type="button"
                                        onClick={() => insertAtCursor("{optout_link}")}
                                        className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 font-mono">
                                        {"{optout_link}"}
                                    </button>
                                </div>

                                {/* Personalization hint */}
                                <div className="mt-2 text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100 space-y-1">
                                    <div>💡 <span className="font-mono text-slate-500">{"{client_name}"}</span> יוחלף אוטומטית בשם כל לקוח/ה בעת השליחה</div>
                                    <div>🔗 שורת &quot;להסרה מרשימת התפוצה: [קישור]&quot; מתווספת אוטומטית בסוף כל הודעה — אפשר להשתמש ב-<span className="font-mono text-slate-500">{"{optout_link}"}</span> כדי לקבוע איפה היא תופיע בטקסט במקום זה</div>
                                </div>
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
                                    {blockShabbat && scheduledAt && new Date(scheduledAt).getDay() === 6 && (
                                        <div className="mt-2 flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-xl px-3 py-2.5">
                                            <span className="text-lg leading-none mt-0.5">🕍</span>
                                            <div className="text-sm text-amber-800">
                                                <span className="font-bold">שים לב — התאריך שנבחר חל בשבת.</span>
                                                <br />
                                                <span>המערכת שלך מוגדרת לחסום שליחה בשבת — ההודעות <span className="font-semibold">לא יישלחו</span> עד יום ראשון. מומלץ לשנות את תאריך השליחה.</span>
                                            </div>
                                        </div>
                                    )}
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
                                            <BroadcastRow key={b.id} b={b} onCancel={handleCancel} canceling={false} onDuplicate={handleDuplicate} />
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

function BroadcastRow({ b, onCancel, canceling, onDuplicate }: { b: Broadcast; onCancel: (id: string) => void; canceling: boolean; onDuplicate?: (b: Broadcast) => void }) {
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
                    {b.status !== "scheduled" && onDuplicate && (
                        <button
                            type="button"
                            onClick={() => onDuplicate(b)}
                            className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded-lg hover:bg-blue-50 transition font-medium"
                        >
                            🔁 שכפל ושלח שוב
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
