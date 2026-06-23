"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";

// ── Placeholder definitions ────────────────────────────────────────────────────
const PLACEHOLDERS = [
    { key: "{client_name}",            label: "שם לקוח" },
    { key: "{appointment_title}",      label: "שם שירות" },
    { key: "{service_name}",           label: "שם שירות" },
    { key: "{appointment_date}",       label: "תאריך תור" },
    { key: "{appointment_time}",       label: "שעת תור" },
    { key: "{artist_name}",            label: "שם אמן/מטפל" },
    { key: "{studio_name}",            label: "שם הסטודיו" },
    { key: "{studio_address}",         label: "כתובת הסטודיו" },
    { key: "{map_link}",               label: "🗺️ קישור מפה" },
    { key: "{portfolio_link}",         label: "🖼️ תיק עבודות" },
    { key: "{bit_link}",               label: "💳 קישור ביט" },
    { key: "{paybox_link}",            label: "💳 קישור פייבוקס" },
    { key: "{payment_link}",           label: "💳 קישור תשלום" },
    { key: "{deposit_amount}",         label: "₪ סכום מקדמה" },
    { key: "{cancellation_free_days}", label: "ימי ביטול חינם" },
    { key: "{deposit_lock_days}",      label: "ימי נעילת מקדמה" },
    { key: "{loyalty_points}",         label: "נקודות לקוח" },
    { key: "{coupon_code}",            label: "🎁 קוד קופון" },
    { key: "{benefit_percent}",        label: "% הנחה יום הולדת" },
    { key: "{join_link}",              label: "🔗 קישור הצטרפות" },
    { key: "{points_used}",            label: "נקודות שנוצלו" },
    { key: "{discount_amount}",        label: "₪ סכום הנחה" },
    { key: "{receipt_link}",           label: "🧾 קישור קבלה" },
    { key: "{booking_link}",           label: "🔗 קישור הזמנה" },
    { key: "{total_amount}",           label: "₪ סכום כולל" },
    { key: "{rejection_reason}",       label: "סיבת דחייה" },
    { key: "{service_note}",           label: "הערת שירות" },
];

// ── Section types ──────────────────────────────────────────────────────────────
interface AutomSection {
    id: string;
    title: string;
    icon: string;
    templateKey: string;
    emailKey?: string;
    toggleKey?: string;
    toggleLabel?: string;
    delayKey?: string;
    delayLabel?: string;
    description: string;
    hints: string[];
    bizfind?: boolean;
}
interface SectionGroup { id: string; title: string; icon: string; sections: AutomSection[]; }

const GROUPS: SectionGroup[] = [
    {
        id: "appointments", title: "תורים", icon: "📅",
        sections: [
            {
                id: "confirm", title: "אישור תור", icon: "✅",
                templateKey: "confirm_wa_template", emailKey: "confirm_email_template",
                description: "נשלחת מיד לאחר קביעת תור (ללא מקדמה)",
                hints: ["client_name","appointment_title","appointment_date","appointment_time","artist_name","studio_address","map_link","portfolio_link","cancellation_free_days"],
            },
            {
                id: "deposit_request", title: "בקשת מקדמה", icon: "💳",
                templateKey: "deposit_request_wa_template",
                description: "נשלחת כשנקבע תור שדורש מקדמה",
                hints: ["client_name","appointment_title","appointment_date","appointment_time","studio_address","map_link","bit_link","paybox_link","payment_link","deposit_amount","cancellation_free_days"],
            },
            {
                id: "deposit_approved", title: "מקדמה אושרה", icon: "✅💳",
                templateKey: "deposit_approved_wa_template",
                description: "נשלחת לאחר אישור קבלת המקדמה",
                hints: ["client_name","appointment_date","appointment_time","artist_name","studio_address","map_link","portfolio_link","cancellation_free_days","deposit_lock_days"],
            },
            {
                id: "reschedule", title: "שינוי תור", icon: "🔄",
                templateKey: "reschedule_wa_template", emailKey: "reschedule_email_template",
                description: "נשלחת כאשר תור מועבר לזמן אחר",
                hints: ["client_name","appointment_title","appointment_date","appointment_time","artist_name","studio_address","map_link"],
            },
            {
                id: "cancel", title: "ביטול תור", icon: "❌",
                templateKey: "cancel_wa_template", emailKey: "cancel_email_template",
                description: "נשלחת כאשר תור מבוטל",
                hints: ["client_name","appointment_title","appointment_date","appointment_time"],
            },
        ],
    },
    {
        id: "reminders", title: "תזכורות", icon: "🔔",
        sections: [
            {
                id: "reminder_sameday", title: "תזכורת — ביום התור", icon: "☀️",
                templateKey: "same_day_reminder_wa_template",
                toggleKey: "same_day_reminder_enabled", toggleLabel: "שלח תזכורת בבוקר יום התור",
                description: "נשלחת בשעה 08:00 ביום התור",
                hints: ["client_name","appointment_title","appointment_time","studio_address","map_link","deposit_amount","payment_link"],
            },
            {
                id: "reminder_1day", title: "תזכורת — יום לפני", icon: "📅",
                templateKey: "reminder_wa_template", emailKey: "reminder_email_template",
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
        ],
    },
    {
        id: "payment", title: "תשלומים וטיפול", icon: "🧾",
        sections: [
            {
                id: "post_payment", title: "לאחר תשלום", icon: "🧾",
                templateKey: "post_payment_wa_template", emailKey: "post_payment_email_template",
                description: "נשלחת ללקוח לאחר ביצוע תשלום בקופה",
                hints: ["client_name","appointment_title","appointment_date","loyalty_points"],
            },
            {
                id: "receipt_link", title: "קישור קבלה", icon: "🧾",
                templateKey: "receipt_link_wa_template",
                description: "נשלחת ללקוח עם קישור לקבלה דיגיטלית לאחר תשלום",
                hints: ["client_name","service_name","receipt_link"],
            },
            {
                id: "pos_receipt", title: "תודה על רכישה (קופה)", icon: "🛍️",
                templateKey: "pos_receipt_wa_template",
                description: "נשלחת ללקוח לאחר רכישה בקופה (POS)",
                hints: ["client_name","total_amount","points_earned","loyalty_points"],
            },
            {
                id: "deposit_reminder", title: "תזכורת מקדמה", icon: "💰",
                templateKey: "deposit_reminder_wa_template",
                description: "נשלחת ללקוח 24 שעות לאחר קביעת תור אם המקדמה טרם שולמה. ניתן גם לשלוח ידנית מלוח הבקרה.",
                hints: ["client_name","date","time","deposit_amount"],
            },
            {
                id: "aftercare", title: "הוראות טיפול לאחר תור", icon: "🩹",
                templateKey: "aftercare_message",
                description: "הוראות אפטרקר שנשלחות לאחר סיום תור",
                hints: ["client_name","appointment_title","artist_name"],
            },
        ],
    },
    {
        id: "bizfind", title: "BizFind — קביעות אונליין", icon: "🌐",
        sections: [
            {
                id: "booking_confirm", title: "אישור קביעה עצמית", icon: "✅",
                templateKey: "booking_confirm_wa_template",
                bizfind: true,
                description: "נשלחת ללקוח שקבע תור עצמאית דרך דף BizFind",
                hints: ["client_name","service_name","appointment_date","appointment_time","studio_name"],
            },
            {
                id: "booking_request_approved", title: "בקשת תור — אושרה", icon: "👍",
                templateKey: "booking_request_approved_wa_template",
                bizfind: true,
                description: "נשלחת ללקוח כאשר בקשת התור שלו אושרה על-ידי הסטודיו",
                hints: ["client_name","artist_name","appointment_date","service_note","booking_link"],
            },
            {
                id: "booking_request_rejected", title: "בקשת תור — נדחתה", icon: "❌",
                templateKey: "booking_request_rejected_wa_template",
                bizfind: true,
                description: "נשלחת ללקוח כאשר בקשת התור שלו נדחתה",
                hints: ["client_name","appointment_date","rejection_reason"],
            },
            {
                id: "waitlist_joined", title: "הצטרפות לרשימת המתנה", icon: "📋",
                templateKey: "waitlist_joined_wa_template",
                bizfind: true,
                description: "נשלחת ללקוח כאשר הוא מצטרף לרשימת ההמתנה",
                hints: ["client_name","studio_name"],
            },
            {
                id: "waitlist_notify", title: "התפנה מקום — רשימת המתנה", icon: "🎉",
                templateKey: "waitlist_notify_wa_template",
                bizfind: true,
                description: "נשלחת ללקוחות ברשימת ההמתנה כאשר מתפנה מקום",
                hints: ["client_name","studio_name","booking_link"],
            },
        ],
    },
    {
        id: "club", title: "מועדון לקוחות", icon: "⭐",
        sections: [
            {
                id: "welcome", title: "ברוכים הבאים", icon: "👋",
                templateKey: "welcome_wa_template", emailKey: "welcome_email_template",
                description: "נשלחת ללקוח חדש כאשר מצטרף למועדון",
                hints: ["client_name","loyalty_points","join_link"],
            },
            {
                id: "birthday", title: "יום הולדת", icon: "🎂",
                templateKey: "birthday_wa_template", emailKey: "birthday_email_template",
                toggleKey: "birthday_automation_enabled", toggleLabel: "שלח הודעת יום הולדת",
                description: "נשלחת חודש לפני יום ההולדת לחברי מועדון",
                hints: ["client_name","coupon_code","benefit_percent"],
            },
            {
                id: "non_member", title: "הזמנה למועדון", icon: "🎁",
                templateKey: "non_member_wa_template",
                toggleKey: "club_invite_enabled", toggleLabel: "שלח הזמנה ללקוחות שאינם חברים",
                delayKey: "club_invite_delay_minutes", delayLabel: "דקות המתנה לאחר ביקור",
                description: "נשלחת ללקוחות שביקרו אך אינם חברי מועדון",
                hints: ["client_name","join_link","loyalty_points"],
            },
            {
                id: "points_redeem", title: "מימוש נקודות", icon: "🏆",
                templateKey: "points_redeem_wa_template",
                description: "נשלחת כאשר לקוח ממש נקודות נאמנות",
                hints: ["client_name","points_used","discount_amount","loyalty_points"],
            },
            {
                id: "points_balance", title: "יתרת נקודות", icon: "⭐",
                templateKey: "points_balance_wa_template",
                description: "נשלחת ידנית מפרופיל הלקוח — מאפשרת ללקוח לדעת כמה נקודות נצברו",
                hints: ["client_name","loyalty_points"],
            },
        ],
    },
];

// ── Template editor ────────────────────────────────────────────────────────────
function PlaceholderBar({ hints, onInsert }: { hints: string[]; onInsert: (ph: string) => void }) {
    const relevant = PLACEHOLDERS.filter(p => hints.includes(p.key.replace(/[{}]/g, "")));
    const other = PLACEHOLDERS.filter(p => !hints.includes(p.key.replace(/[{}]/g, "")));
    return (
        <div style={{ marginBottom: "0.4rem" }}>
            <div style={{ fontSize: "0.7rem", color: "#64748b", marginBottom: "0.3rem" }}>לחץ להוסיף:</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                {relevant.map(p => (
                    <button key={p.key} type="button" onClick={() => onInsert(p.key)}
                        style={{ padding: "0.2rem 0.55rem", borderRadius: 7, border: "1px solid rgba(167,139,250,.4)", background: "rgba(167,139,250,.12)", color: "#a78bfa", cursor: "pointer", fontSize: "0.7rem", fontWeight: 700 }}>
                        {p.label}
                    </button>
                ))}
                {other.length > 0 && (
                    <details style={{ display: "inline-block" }}>
                        <summary style={{ padding: "0.2rem 0.55rem", borderRadius: 7, border: "1px solid rgba(100,116,139,.3)", background: "rgba(100,116,139,.08)", color: "#64748b", cursor: "pointer", fontSize: "0.7rem", fontWeight: 600, listStyle: "none" }}>
                            + עוד
                        </summary>
                        <div style={{ position: "absolute", zIndex: 50, background: "#1e293b", border: "1px solid rgba(255,255,255,.15)", borderRadius: 10, padding: "0.5rem", display: "flex", flexWrap: "wrap", gap: "0.25rem", maxWidth: 300, marginTop: "0.2rem" }}>
                            {other.map(p => (
                                <button key={p.key} type="button" onClick={() => onInsert(p.key)}
                                    style={{ padding: "0.2rem 0.55rem", borderRadius: 7, border: "1px solid rgba(100,116,139,.3)", background: "rgba(100,116,139,.08)", color: "#94a3b8", cursor: "pointer", fontSize: "0.7rem" }}>
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </details>
                )}
            </div>
        </div>
    );
}

function TemplateEditor({
    section, value, emailValue, toggleValue, delayValue,
    onChange, onEmailChange, onToggle, onDelayChange, onClear,
}: {
    section: AutomSection;
    value: string;
    emailValue?: string;
    toggleValue?: boolean;
    delayValue?: number;
    onChange: (v: string) => void;
    onEmailChange?: (v: string) => void;
    onToggle?: (v: boolean) => void;
    onDelayChange?: (v: number) => void;
    onClear: () => void;
}) {
    const waRef = useRef<HTMLTextAreaElement>(null);
    const emailRef = useRef<HTMLTextAreaElement>(null);

    const insertInto = (ph: string, ref: React.RefObject<HTMLTextAreaElement | null>, val: string, setter: (v: string) => void) => {
        const el = ref.current;
        if (!el) { setter(val + ph); return; }
        const start = el.selectionStart;
        const end = el.selectionEnd;
        setter(val.substring(0, start) + ph + val.substring(end));
        setTimeout(() => { el.focus(); el.setSelectionRange(start + ph.length, start + ph.length); }, 0);
    };

    const hasEmail = !!section.emailKey;

    return (
        <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, padding: "1.2rem", background: "rgba(255,255,255,.03)" }}>
            {/* Header row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
                <div>
                    <span style={{ fontSize: "1.05rem", marginLeft: "0.35rem" }}>{section.icon}</span>
                    <span style={{ fontWeight: 800, fontSize: "0.97rem" }}>{section.title}</span>
                    {section.bizfind && (
                        <span style={{ display: "inline-block", fontSize: "0.64rem", fontWeight: 700, background: "rgba(59,130,246,.12)", border: "1px solid rgba(59,130,246,.3)", color: "#60a5fa", padding: "0.1rem 0.45rem", borderRadius: 6, marginRight: "0.4rem", verticalAlign: "middle" }}>
                            BizFind
                        </span>
                    )}
                    <div style={{ color: "#64748b", fontSize: "0.77rem", marginTop: "0.2rem" }}>{section.description}</div>
                </div>
                <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
                    {section.toggleKey && onToggle && (
                        <>
                            <button type="button" onClick={() => onToggle(!toggleValue)}
                                style={{ padding: "0.3rem 0.85rem", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: "0.76rem",
                                    background: toggleValue ? "rgba(74,222,128,.15)" : "rgba(248,113,113,.1)",
                                    color: toggleValue ? "#4ade80" : "#f87171",
                                    border: `1px solid ${toggleValue ? "rgba(74,222,128,.3)" : "rgba(248,113,113,.2)"}`,
                                }}>
                                {toggleValue ? "✓ פעיל" : "כבוי"}
                            </button>
                            {section.delayKey && onDelayChange && toggleValue && (
                                <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.75rem", color: "#94a3b8" }}>
                                    <span>{section.delayLabel}</span>
                                    <input type="number" min={0} step={1} value={delayValue ?? 0}
                                        onChange={e => onDelayChange(Number(e.target.value))}
                                        style={{ width: 64, background: "rgba(0,0,0,.3)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, padding: "0.2rem 0.4rem", color: "#e2e8f0", fontSize: "0.8rem", textAlign: "center" }}
                                    />
                                </label>
                            )}
                        </>
                    )}
                    <button type="button" onClick={onClear} title="מחק — ישתמש בברירת מחדל"
                        style={{ padding: "0.3rem 0.65rem", borderRadius: 10, border: "1px solid rgba(248,113,113,.2)", background: "rgba(248,113,113,.08)", color: "#f87171", cursor: "pointer", fontSize: "0.73rem", fontWeight: 600 }}>
                        🗑 מחק
                    </button>
                </div>
            </div>

            {/* Textareas */}
            <div style={{ display: "grid", gridTemplateColumns: hasEmail ? "1fr 1fr" : "1fr", gap: "0.75rem" }}>
                {/* WhatsApp */}
                <div>
                    {hasEmail && (
                        <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#4ade80", marginBottom: "0.3rem" }}>📱 וואטסאפ</div>
                    )}
                    <PlaceholderBar hints={section.hints} onInsert={ph => insertInto(ph, waRef, value, onChange)} />
                    <textarea ref={waRef} value={value} onChange={e => onChange(e.target.value)}
                        placeholder="השאר ריק לשימוש בברירת מחדל" rows={6} dir="rtl"
                        style={{ width: "100%", background: "rgba(0,0,0,.3)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, padding: "0.7rem", color: "#e2e8f0", fontSize: "0.83rem", resize: "vertical", outline: "none", lineHeight: 1.7, boxSizing: "border-box", fontFamily: "inherit" }}
                    />
                    {!value && <div style={{ fontSize: "0.7rem", color: "#475569", marginTop: "0.2rem" }}>ריק = ברירת מחדל של המערכת</div>}
                </div>

                {/* Email */}
                {hasEmail && onEmailChange && (
                    <div>
                        <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#60a5fa", marginBottom: "0.3rem" }}>📧 מייל</div>
                        <PlaceholderBar hints={section.hints} onInsert={ph => insertInto(ph, emailRef, emailValue || "", onEmailChange)} />
                        <textarea ref={emailRef} value={emailValue || ""} onChange={e => onEmailChange(e.target.value)}
                            placeholder="השאר ריק לשימוש בברירת מחדל" rows={6} dir="rtl"
                            style={{ width: "100%", background: "rgba(0,0,0,.3)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, padding: "0.7rem", color: "#e2e8f0", fontSize: "0.83rem", resize: "vertical", outline: "none", lineHeight: 1.7, boxSizing: "border-box", fontFamily: "inherit" }}
                        />
                        {!emailValue && <div style={{ fontSize: "0.7rem", color: "#475569", marginTop: "0.2rem" }}>ריק = ברירת מחדל של המערכת</div>}
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Main page ──────────────────────────────────────────────────────────────────
type Settings = Record<string, string | boolean | number | null | undefined>;

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

    const set = useCallback((key: string, val: string | boolean | number | null) => {
        setSettings(prev => ({ ...prev, [key]: val }));
        setDirty(true);
    }, []);

    const save = async () => {
        setSaving(true);
        try {
            await apiFetch("/api/studio/automation", { method: "PATCH", body: JSON.stringify(settings) });
            toast.success("התבניות נשמרו בהצלחה ✓");
            setDirty(false);
        } catch (e: unknown) {
            toast.error((e as Error)?.message || "שגיאה בשמירה");
        } finally {
            setSaving(false);
        }
    };

    return (
        <RequireAuth>
            <AppShell>
                <div style={{ maxWidth: 900, margin: "0 auto", padding: "1.5rem 1.25rem 5rem", direction: "rtl" }}>

                    {/* Header */}
                    <div style={{ marginBottom: "1.75rem" }}>
                        <h1 style={{ fontSize: "1.6rem", fontWeight: 900, margin: 0 }}>💬 תבניות הודעות</h1>
                        <p style={{ color: "#64748b", fontSize: "0.85rem", marginTop: "0.4rem" }}>
                            ערוך את הטקסט של כל הודעה אוטומטית. השאר ריק לשימוש בברירת מחדל.
                        </p>
                        <div style={{ marginTop: "0.75rem", background: "rgba(167,139,250,.08)", border: "1px solid rgba(167,139,250,.2)", borderRadius: 12, padding: "0.75rem 1rem", fontSize: "0.82rem", color: "#a78bfa" }}>
                            <strong>איך זה עובד:</strong> לחץ על כפתורי המשתנים להוסיפם לתבנית.
                            המשתנים יוחלפו אוטומטית בנתונים האמיתיים.
                            הודעות עם 📱 נשלחות בוואטסאפ • הודעות עם 📧 נשלחות גם במייל (אם הוגדר).
                        </div>
                    </div>

                    {loading ? (
                        <div style={{ textAlign: "center", color: "#64748b", padding: "3rem" }}>טוען...</div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
                            {GROUPS.map(group => (
                                <div key={group.id}>
                                    {/* Group header */}
                                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.85rem", borderBottom: "1px solid rgba(255,255,255,.08)", paddingBottom: "0.5rem" }}>
                                        <span style={{ fontSize: "1.1rem" }}>{group.icon}</span>
                                        <span style={{ fontWeight: 900, fontSize: "1rem", color: "#cbd5e1", letterSpacing: "0.03em" }}>{group.title}</span>
                                    </div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
                                        {group.sections.map(section => (
                                            <TemplateEditor
                                                key={section.id}
                                                section={section}
                                                value={(settings[section.templateKey] as string) || ""}
                                                emailValue={section.emailKey ? (settings[section.emailKey] as string) || "" : undefined}
                                                toggleValue={section.toggleKey ? (settings[section.toggleKey] as boolean) ?? true : undefined}
                                                delayValue={section.delayKey ? (settings[section.delayKey] as number) ?? 0 : undefined}
                                                onChange={v => set(section.templateKey, v || null)}
                                                onEmailChange={section.emailKey ? v => set(section.emailKey!, v || null) : undefined}
                                                onToggle={section.toggleKey ? v => set(section.toggleKey!, v) : undefined}
                                                onDelayChange={section.delayKey ? v => set(section.delayKey!, v) : undefined}
                                                onClear={() => { set(section.templateKey, null); if (section.emailKey) set(section.emailKey, null); }}
                                            />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Sticky save */}
                    {dirty && (
                        <div style={{ position: "fixed", bottom: "1.5rem", left: "50%", transform: "translateX(-50%)", zIndex: 100 }}>
                            <button type="button" onClick={save} disabled={saving}
                                style={{ background: "linear-gradient(135deg,#7c3aed,#4c1d95)", border: "none", borderRadius: 16, color: "#fff", padding: "0.85rem 2.5rem", fontWeight: 800, fontSize: "1rem", cursor: "pointer", boxShadow: "0 8px 24px rgba(124,58,237,.5)" }}>
                                {saving ? "שומר..." : "💾 שמור שינויים"}
                            </button>
                        </div>
                    )}
                </div>
            </AppShell>
        </RequireAuth>
    );
}
