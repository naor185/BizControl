"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";

// ── Placeholder definitions ────────────────────────────────────────────────────
const PLACEHOLDERS = [
    { key: "{client_name}",           label: "שם לקוח" },
    { key: "{appointment_title}",     label: "שם שירות" },
    { key: "{appointment_date}",      label: "תאריך תור" },
    { key: "{appointment_time}",      label: "שעת תור" },
    { key: "{artist_name}",           label: "שם אמן/מטפל" },
    { key: "{studio_address}",        label: "כתובת הסטודיו" },
    { key: "{map_link}",              label: "🗺️ קישור מפה" },
    { key: "{portfolio_link}",        label: "🖼️ תיק עבודות" },
    { key: "{bit_link}",              label: "💳 קישור ביט" },
    { key: "{paybox_link}",           label: "💳 קישור פייבוקס" },
    { key: "{payment_link}",          label: "💳 קישור תשלום" },
    { key: "{deposit_amount}",        label: "₪ סכום מקדמה" },
    { key: "{cancellation_free_days}",label: "ימי ביטול חינם" },
    { key: "{deposit_lock_days}",     label: "ימי נעילת מקדמה" },
    { key: "{loyalty_points}",        label: "נקודות לקוח" },
    { key: "{coupon_code}",           label: "🎁 קוד קופון" },
    { key: "{benefit_percent}",       label: "% הנחה יום הולדת" },
];

// ── Automation sections ────────────────────────────────────────────────────────
interface AutomSection {
    id: string;
    title: string;
    icon: string;
    templateKey: string;
    toggleKey?: string;
    toggleLabel?: string;
    description: string;
    hints: string[];   // which placeholders are most relevant
}

const SECTIONS: AutomSection[] = [
    {
        id: "confirm", title: "אישור תור", icon: "✅",
        templateKey: "confirm_wa_template",
        description: "נשלחת ללקוח מיד לאחר קביעת תור (ללא מקדמה)",
        hints: ["client_name","appointment_title","appointment_date","appointment_time","artist_name","studio_address","map_link","portfolio_link","cancellation_free_days"],
    },
    {
        id: "deposit_request", title: "בקשת מקדמה", icon: "💳",
        templateKey: "deposit_request_wa_template",
        description: "נשלחת כשנקבע תור שדורש מקדמה",
        hints: ["client_name","appointment_title","appointment_date","appointment_time","artist_name","studio_address","map_link","bit_link","paybox_link","payment_link","deposit_amount","cancellation_free_days"],
    },
    {
        id: "deposit_approved", title: "מקדמה אושרה", icon: "✅💳",
        templateKey: "deposit_approved_wa_template",
        description: "נשלחת ללקוח לאחר שבעל הסטודיו אישר את קבלת המקדמה",
        hints: ["client_name","appointment_date","appointment_time","artist_name","studio_address","map_link","portfolio_link","cancellation_free_days","deposit_lock_days"],
    },
    {
        id: "reminder_1day", title: "תזכורת — יום לפני", icon: "📅",
        templateKey: "reminder_wa_template",
        toggleKey: "reminder_1_day_enabled", toggleLabel: "שלח תזכורת יום לפני",
        description: "נשלחת ~24 שעות לפני התור",
        hints: ["client_name","appointment_title","appointment_date","appointment_time","studio_address","map_link","deposit_amount","payment_link"],
    },
    {
        id: "reminder_3day", title: "תזכורת — 3 ימים לפני", icon: "📅",
        templateKey: "reminder_3day_wa_template",
        toggleKey: "reminder_3_days_enabled", toggleLabel: "שלח תזכורת 3 ימים לפני",
        description: "נשלחת ~3 ימים לפני התור",
        hints: ["client_name","appointment_title","appointment_date","appointment_time","studio_address","map_link"],
    },
    {
        id: "reminder_7day", title: "תזכורת — שבוע לפני", icon: "📅",
        templateKey: "reminder_7day_wa_template",
        toggleKey: "reminder_7_days_enabled", toggleLabel: "שלח תזכורת שבוע לפני",
        description: "נשלחת ~7 ימים לפני התור",
        hints: ["client_name","appointment_title","appointment_date","appointment_time"],
    },
    {
        id: "reminder_sameday", title: "תזכורת — ביום התור", icon: "☀️",
        templateKey: "same_day_reminder_wa_template",
        toggleKey: "same_day_reminder_enabled", toggleLabel: "שלח תזכורת בבוקר יום התור",
        description: "נשלחת בשעה 08:00 ביום התור",
        hints: ["client_name","appointment_title","appointment_time","studio_address","map_link","deposit_amount","payment_link"],
    },
    {
        id: "cancel", title: "ביטול תור", icon: "❌",
        templateKey: "cancel_wa_template",
        description: "נשלחת ללקוח כאשר תור מבוטל",
        hints: ["client_name","appointment_title","appointment_date","appointment_time"],
    },
    {
        id: "reschedule", title: "שינוי תור", icon: "🔄",
        templateKey: "reschedule_wa_template",
        description: "נשלחת ללקוח כאשר תור מועבר לזמן אחר",
        hints: ["client_name","appointment_title","appointment_date","appointment_time","artist_name","studio_address","map_link"],
    },
    {
        id: "post_payment", title: "לאחר תשלום", icon: "🧾",
        templateKey: "post_payment_wa_template",
        description: "נשלחת ללקוח לאחר ביצוע תשלום בקופה",
        hints: ["client_name","appointment_title","appointment_date","loyalty_points"],
    },
    {
        id: "birthday", title: "יום הולדת", icon: "🎂",
        templateKey: "birthday_wa_template",
        toggleKey: "birthday_automation_enabled", toggleLabel: "שלח הודעת יום הולדת",
        description: "נשלחת חודש לפני יום ההולדת לחברי מועדון",
        hints: ["client_name","coupon_code","benefit_percent"],
    },
    {
        id: "welcome", title: "ברוכים הבאים", icon: "👋",
        templateKey: "welcome_wa_template",
        description: "נשלחת ללקוח חדש כאשר מצטרף למועדון",
        hints: ["client_name","loyalty_points"],
    },
];

// ── Template editor ────────────────────────────────────────────────────────────
function TemplateEditor({
    section, value, toggleValue, onChange, onToggle, onClear, saving,
}: {
    section: AutomSection;
    value: string;
    toggleValue?: boolean;
    onChange: (v: string) => void;
    onToggle?: (v: boolean) => void;
    onClear: () => void;
    saving: boolean;
}) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const insertPlaceholder = (ph: string) => {
        const el = textareaRef.current;
        if (!el) { onChange(value + ph); return; }
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const next = value.substring(0, start) + ph + value.substring(end);
        onChange(next);
        setTimeout(() => {
            el.focus();
            el.setSelectionRange(start + ph.length, start + ph.length);
        }, 0);
    };

    const relevantPhs = PLACEHOLDERS.filter(p => section.hints.includes(p.key.replace(/[{}]/g, "")));
    const otherPhs = PLACEHOLDERS.filter(p => !section.hints.includes(p.key.replace(/[{}]/g, "")));

    return (
        <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, padding: "1.25rem", background: "rgba(255,255,255,.03)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                <div>
                    <span style={{ fontSize: "1.1rem", marginLeft: "0.4rem" }}>{section.icon}</span>
                    <span style={{ fontWeight: 800, fontSize: "1rem" }}>{section.title}</span>
                    <div style={{ color: "#64748b", fontSize: "0.78rem", marginTop: "0.2rem" }}>{section.description}</div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    {section.toggleKey && onToggle && (
                        <button
                            onClick={() => onToggle(!toggleValue)}
                            style={{ padding: "0.35rem 0.9rem", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: "0.78rem",
                                background: toggleValue ? "rgba(74,222,128,.15)" : "rgba(248,113,113,.1)",
                                color: toggleValue ? "#4ade80" : "#f87171",
                                border: `1px solid ${toggleValue ? "rgba(74,222,128,.3)" : "rgba(248,113,113,.2)"}`,
                            }}
                        >
                            {toggleValue ? "✓ פעיל" : "כבוי"}
                        </button>
                    )}
                    <button
                        onClick={onClear}
                        title="מחק תבנית — ישתמש בברירת מחדל"
                        style={{ padding: "0.35rem 0.75rem", borderRadius: 10, border: "1px solid rgba(248,113,113,.2)", background: "rgba(248,113,113,.08)", color: "#f87171", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}
                    >
                        🗑 מחק
                    </button>
                </div>
            </div>

            {/* Placeholder buttons */}
            <div style={{ marginBottom: "0.5rem" }}>
                <div style={{ fontSize: "0.72rem", color: "#64748b", marginBottom: "0.35rem" }}>לחץ להוסיף לתבנית:</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                    {relevantPhs.map(p => (
                        <button key={p.key} onClick={() => insertPlaceholder(p.key)}
                            style={{ padding: "0.25rem 0.6rem", borderRadius: 8, border: "1px solid rgba(167,139,250,.4)", background: "rgba(167,139,250,.12)", color: "#a78bfa", cursor: "pointer", fontSize: "0.72rem", fontWeight: 700 }}>
                            {p.label}
                        </button>
                    ))}
                    {otherPhs.length > 0 && (
                        <details style={{ display: "inline-block" }}>
                            <summary style={{ padding: "0.25rem 0.6rem", borderRadius: 8, border: "1px solid rgba(100,116,139,.3)", background: "rgba(100,116,139,.08)", color: "#64748b", cursor: "pointer", fontSize: "0.72rem", fontWeight: 600, listStyle: "none" }}>
                                + עוד...
                            </summary>
                            <div style={{ position: "absolute", zIndex: 50, background: "#1e293b", border: "1px solid rgba(255,255,255,.15)", borderRadius: 10, padding: "0.5rem", display: "flex", flexWrap: "wrap", gap: "0.3rem", maxWidth: 300, marginTop: "0.25rem" }}>
                                {otherPhs.map(p => (
                                    <button key={p.key} onClick={() => insertPlaceholder(p.key)}
                                        style={{ padding: "0.25rem 0.6rem", borderRadius: 8, border: "1px solid rgba(100,116,139,.3)", background: "rgba(100,116,139,.08)", color: "#94a3b8", cursor: "pointer", fontSize: "0.72rem" }}>
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </details>
                    )}
                </div>
            </div>

            {/* Textarea */}
            <textarea
                ref={textareaRef}
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={`השאר ריק לשימוש בתבנית ברירת מחדל`}
                rows={6}
                dir="rtl"
                style={{ width: "100%", background: "rgba(0,0,0,.3)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, padding: "0.75rem", color: "#e2e8f0", fontSize: "0.85rem", resize: "vertical", outline: "none", lineHeight: 1.7, boxSizing: "border-box", fontFamily: "inherit" }}
            />
            {!value && (
                <div style={{ fontSize: "0.72rem", color: "#475569", marginTop: "0.25rem" }}>ריק = ברירת מחדל של המערכת</div>
            )}
        </div>
    );
}

// ── Main page ──────────────────────────────────────────────────────────────────
type Settings = Record<string, string | boolean | null | undefined>;

export default function MessageTemplatesPage() {
    const [settings, setSettings] = useState<Settings>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);

    useEffect(() => {
        apiFetch<Settings>("/api/studio/automation")
            .then(d => { setSettings(d); setLoading(false); })
            .catch(() => setLoading(false));
    }, []);

    const set = useCallback((key: string, val: string | boolean | null) => {
        setSettings(prev => ({ ...prev, [key]: val }));
        setDirty(true);
    }, []);

    const save = async () => {
        setSaving(true);
        try {
            await apiFetch("/api/studio/automation", { method: "PATCH", body: JSON.stringify(settings) });
            toast.success("התבניות נשמרו בהצלחה ✓");
            setDirty(false);
        } catch (e: any) {
            toast.error(e?.message || "שגיאה בשמירה");
        } finally {
            setSaving(false);
        }
    };

    return (
        <RequireAuth>
            <AppShell>
                <div style={{ maxWidth: 780, margin: "0 auto", padding: "1.5rem 1.25rem 4rem", direction: "rtl" }}>

                    {/* Header */}
                    <div style={{ marginBottom: "1.75rem" }}>
                        <h1 style={{ fontSize: "1.6rem", fontWeight: 900, margin: 0 }}>💬 תבניות הודעות</h1>
                        <p style={{ color: "#64748b", fontSize: "0.85rem", marginTop: "0.4rem" }}>
                            ערוך את הטקסט של כל הודעה אוטומטית. השאר ריק לשימוש בברירת מחדל.
                        </p>
                        <div style={{ marginTop: "0.75rem", background: "rgba(167,139,250,.08)", border: "1px solid rgba(167,139,250,.2)", borderRadius: 12, padding: "0.75rem 1rem", fontSize: "0.82rem", color: "#a78bfa" }}>
                            <strong>איך זה עובד:</strong> לחץ על כפתורי המשתנים (למשל "שם לקוח") להוסיפם לתבנית.
                            המשתנים יוחלפו אוטומטית בנתונים האמיתיים של כל לקוח/תור.
                            <br />כדי להסיר קישור — פשוט מחק אותו מהתבנית.
                        </div>
                    </div>

                    {loading ? (
                        <div style={{ textAlign: "center", color: "#64748b", padding: "3rem" }}>טוען...</div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                            {SECTIONS.map(section => (
                                <TemplateEditor
                                    key={section.id}
                                    section={section}
                                    value={(settings[section.templateKey] as string) || ""}
                                    toggleValue={section.toggleKey ? (settings[section.toggleKey] as boolean) ?? true : undefined}
                                    onChange={v => set(section.templateKey, v || null)}
                                    onToggle={section.toggleKey ? v => set(section.toggleKey!, v) : undefined}
                                    onClear={() => set(section.templateKey, null)}
                                    saving={saving}
                                />
                            ))}
                        </div>
                    )}

                    {/* Sticky save button */}
                    {dirty && (
                        <div style={{ position: "fixed", bottom: "1.5rem", left: "50%", transform: "translateX(-50%)", zIndex: 100 }}>
                            <button
                                onClick={save}
                                disabled={saving}
                                style={{ background: "linear-gradient(135deg,#7c3aed,#4c1d95)", border: "none", borderRadius: 16, color: "#fff", padding: "0.85rem 2.5rem", fontWeight: 800, fontSize: "1rem", cursor: "pointer", boxShadow: "0 8px 24px rgba(124,58,237,.5)" }}
                            >
                                {saving ? "שומר..." : "💾 שמור שינויים"}
                            </button>
                        </div>
                    )}
                </div>
            </AppShell>
        </RequireAuth>
    );
}
