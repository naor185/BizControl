"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";
import confetti from "canvas-confetti";
import LandingPageTemplate from "@/components/LandingPageTemplate";

type Settings = {
    aftercare_message?: string | null;
    review_link_google?: string | null;
    review_link_instagram?: string | null;
    review_link_facebook?: string | null;
    review_link_whatsapp?: string | null;
    aftercare_delay_minutes: number;
    points_per_done_appointment: number;
    points_on_signup: number;
    points_percent_per_payment: number;
    vat_percent: number;
    income_tax_percent: number;
    social_security_percent: number;

    bit_link?: string | null;
    paybox_link?: string | null;

    welcome_wa_template?: string | null;
    welcome_email_template?: string | null;
    confirm_wa_template?: string | null;
    confirm_email_template?: string | null;
    reminder_wa_template?: string | null;
    reminder_email_template?: string | null;
    post_payment_wa_template?: string | null;
    post_payment_email_template?: string | null;
    reschedule_wa_template?: string | null;
    reschedule_email_template?: string | null;
    cancel_wa_template?: string | null;
    cancel_email_template?: string | null;
    deposit_request_wa_template?: string | null;
    deposit_approved_wa_template?: string | null;
    points_redeem_wa_template?: string | null;
    non_member_wa_template?: string | null;

    birthday_wa_template?: string | null;
    birthday_email_template?: string | null;
    birthday_benefit_percent: number;

    whatsapp_provider?: string | null;
    whatsapp_api_key?: string | null;
    whatsapp_phone_id?: string | null;
    whatsapp_instance_id?: string | null;

    resend_api_key?: string | null;
    resend_from_email?: string | null;

    facebook_page_id?: string | null;
    instagram_account_id?: string | null;
    meta_page_access_token?: string | null;

    theme_primary_color: string;
    theme_secondary_color: string;
    logo_filename?: string | null;

    landing_page_active_template: number;
    landing_page_title: string;
    landing_page_description: string;
    landing_page_title_font: string;
    landing_page_desc_font: string;
    landing_page_bg_image?: string | null;
    landing_page_image_1?: string | null;
    landing_page_image_2?: string | null;
    landing_page_image_3?: string | null;

    ai_generations_count: number;
    ai_generations_reset_date: string | null;

    google_calendar_client_id?: string | null;
    google_calendar_client_secret?: string | null;
    google_calendar_refresh_token?: string | null;

    calendar_start_hour?: string;
    calendar_end_hour?: string;

    studio_slug?: string | null;

    // Studio info & policy
    studio_address?: string | null;
    studio_map_link?: string | null;
    studio_portfolio_link?: string | null;
    bank_name?: string | null;
    bank_branch?: string | null;
    bank_account?: string | null;
    cancellation_free_days: number;
    deposit_lock_days: number;
    deposit_fixed_amount_ils: number;
    deposit_min_duration_minutes: number | null;
};

function WebhookUrlBox({ provider, instanceId }: { provider: "green_api" | "meta"; instanceId: string }) {
    const [copied, setCopied] = useState<string | null>(null);
    const domain = typeof window !== "undefined" ? (process.env.NEXT_PUBLIC_API_BASE || window.location.origin) : "";

    const copy = (text: string, key: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(key);
            setTimeout(() => setCopied(null), 2000);
        });
    };

    const CopyBtn = ({ text, label }: { text: string; label: string }) => (
        <button
            type="button"
            onClick={() => copy(text, label)}
            className="flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
        >
            {copied === label ? "✓ הועתק" : "העתק"}
        </button>
    );

    if (provider === "green_api") {
        const webhookUrl = `${domain}/api/webhook/green/${instanceId || "{instance_id}"}`;
        return (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-3">
                <div className="flex items-center gap-2">
                    <span className="text-lg">🔗</span>
                    <h4 className="font-bold text-amber-900 text-sm">כתובת Webhook להגדרה ב-Green API</h4>
                </div>
                <p className="text-xs text-amber-700">
                    בממשק Green API, תחת ה-Instance שלך → Settings → Webhooks, הכנס את הכתובת הבאה:
                </p>
                <div className="flex items-center gap-2 bg-white rounded-xl border border-amber-200 px-3 py-2">
                    <code className="flex-1 text-xs font-mono text-slate-700 break-all dir-ltr text-left">{webhookUrl}</code>
                    <CopyBtn text={webhookUrl} label="green_webhook" />
                </div>
            </div>
        );
    }

    const webhookUrl = `${domain}/api/webhook/meta`;
    const verifyToken = "bizcontrol_verify";
    return (
        <div className="mt-4 bg-blue-50 border border-blue-200 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2">
                <span className="text-lg">🔗</span>
                <h4 className="font-bold text-blue-900 text-sm">הגדרת Webhook ב-Meta Developer Portal</h4>
            </div>
            <p className="text-xs text-blue-700">
                ב-Meta for Developers → WhatsApp → Configuration → Webhook, הכנס:
            </p>
            <div className="space-y-2">
                <div>
                    <div className="text-xs font-bold text-slate-500 mb-1">Callback URL</div>
                    <div className="flex items-center gap-2 bg-white rounded-xl border border-blue-200 px-3 py-2">
                        <code className="flex-1 text-xs font-mono text-slate-700 break-all dir-ltr text-left">{webhookUrl}</code>
                        <CopyBtn text={webhookUrl} label="meta_webhook" />
                    </div>
                </div>
                <div>
                    <div className="text-xs font-bold text-slate-500 mb-1">Verify Token</div>
                    <div className="flex items-center gap-2 bg-white rounded-xl border border-blue-200 px-3 py-2">
                        <code className="flex-1 text-xs font-mono text-slate-700 dir-ltr text-left">{verifyToken}</code>
                        <CopyBtn text={verifyToken} label="meta_token" />
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function AutomationSettingsPage() {
    const [settings, setSettings] = useState<Settings | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [msg, setMsg] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<"branding" | "landing" | "communication" | "policy" | "automation" | "finance" | "integrations">("branding");

    const [aiPrompt, setAiPrompt] = useState("");
    const [isAiLoading, setIsAiLoading] = useState(false);

    // 2FA state
    const [totpEnabled, setTotpEnabled] = useState(false);
    const [totpSetupUri, setTotpSetupUri] = useState<string | null>(null);
    const [totpSetupSecret, setTotpSetupSecret] = useState<string | null>(null);
    const [totpQr, setTotpQr] = useState<string | null>(null);
    const [totpCode, setTotpCode] = useState("");
    const [totpMsg, setTotpMsg] = useState<string | null>(null);
    const [totpLoading, setTotpLoading] = useState(false);

    useEffect(() => {
        apiFetch<{ totp_enabled: boolean }>("/api/auth/me")
            .then(me => setTotpEnabled(me.totp_enabled))
            .catch(() => {});
    }, []);

    useEffect(() => {
        apiFetch<Settings>("/api/studio/automation", { method: "GET" })
            .then((data) => {
                setSettings({
                    ...data,
                    aftercare_delay_minutes: data.aftercare_delay_minutes ?? 30,
                    points_per_done_appointment: data.points_per_done_appointment ?? 0,
                    points_on_signup: data.points_on_signup ?? 50,
                    points_percent_per_payment: data.points_percent_per_payment ?? 5,
                    vat_percent: data.vat_percent ?? 17,
                    income_tax_percent: data.income_tax_percent ?? 10,
                    social_security_percent: data.social_security_percent ?? 5,
                    birthday_benefit_percent: data.birthday_benefit_percent ?? 0,
                    birthday_wa_template: data.birthday_wa_template ?? "",
                    birthday_email_template: data.birthday_email_template ?? "",
                    theme_primary_color: data.theme_primary_color ?? "#000000",
                    theme_secondary_color: data.theme_secondary_color ?? "#ffffff",
                    landing_page_active_template: data.landing_page_active_template ?? 1,
                    landing_page_title: data.landing_page_title ?? "",
                    landing_page_description: data.landing_page_description ?? "",
                    landing_page_title_font: data.landing_page_title_font ?? "Heebo",
                    landing_page_desc_font: data.landing_page_desc_font ?? "Assistant",
                    landing_page_bg_image: data.landing_page_bg_image ?? null,
                    landing_page_image_1: data.landing_page_image_1 ?? null,
                    landing_page_image_2: data.landing_page_image_2 ?? null,
                    landing_page_image_3: data.landing_page_image_3 ?? null,
                    ai_generations_count: data.ai_generations_count ?? 0,
                    ai_generations_reset_date: data.ai_generations_reset_date ?? null,
                    calendar_start_hour: data.calendar_start_hour ?? "08:00",
                    calendar_end_hour: data.calendar_end_hour ?? "23:00",
                    cancellation_free_days: data.cancellation_free_days ?? 7,
                    deposit_lock_days: data.deposit_lock_days ?? 7,
                    deposit_fixed_amount_ils: data.deposit_fixed_amount_ils ?? 0,
                    deposit_min_duration_minutes: data.deposit_min_duration_minutes ?? null,
                    studio_address: data.studio_address ?? "",
                    studio_map_link: data.studio_map_link ?? "",
                    studio_portfolio_link: data.studio_portfolio_link ?? "",
                    bank_name: data.bank_name ?? "",
                    bank_branch: data.bank_branch ?? "",
                    bank_account: data.bank_account ?? "",
                    deposit_request_wa_template: data.deposit_request_wa_template ?? "היי {client_name}! 🎉 התור שלך ל-{appointment_title} נקבע ל-{appointment_date} בשעה {appointment_time}.\n\nלאישור התור נדרשת מקדמה של {deposit_amount}₪ עד 24 שעות.\nניתן לשלם דרך:\n💳 ביט: {bit_link}\n💳 פייבוקס: {paybox_link}\n🏦 העברה בנקאית: {bank_details}\n\nאחרי העברת המקדמה שלח/י אישור ונאשר את התור.\n\nלשאלות: {contact_phone}",
                    deposit_approved_wa_template: data.deposit_approved_wa_template ?? "✅ {client_name}, המקדמה אושרה!\n\nהתור שלך מאושר ונעול:\n📅 תאריך: {appointment_date}\n🕐 שעה: {appointment_time}\n✂️ אמן/ית: {artist_name}\n📍 כתובת: {studio_address}\n🗺️ ניווט: {map_link}\n🖼️ תיק עבודות: {portfolio_link}\n\n*מדיניות ביטולים:* ביטול עד {cancellation_free_days} ימים לפני — החזר מלא. פחות מ-{cancellation_free_days} ימים — ללא החזר מקדמה. שינוי תור אפשרי עד {deposit_lock_days} ימים לפני.\n\nמחכים לך! 🙏",
                    points_redeem_wa_template: data.points_redeem_wa_template ?? "🎁 {client_name}, מימשת {points_used} נקודות בשווי {discount_amount}₪!\n\nנקודות שנותרו: {loyalty_points} נקודות.\nתודה שאתה/את חלק מהמועדון שלנו ❤️",
                    non_member_wa_template: data.non_member_wa_template ?? "היי {client_name}! 👋\n\nשמחים שביקרת אצלנו!\nהצטרף/י למועדון הלקוחות שלנו וקבל/י {points_on_signup} נקודות מתנה לביקור הבא 🎉\n\nהרשמה: {join_link}",
                    // Template defaults — plain text, no placeholders needed
                    confirm_wa_template: data.confirm_wa_template ?? "היי! התור שלך נקבע בהצלחה. מחכים לך 😊",
                    confirm_email_template: data.confirm_email_template ?? "היי! התור שלך נקבע בהצלחה. מחכים לך 😊",
                    reschedule_wa_template: data.reschedule_wa_template ?? "היי! מועד התור שלך עודכן. מחכים לך 🙌",
                    reschedule_email_template: data.reschedule_email_template ?? "היי! מועד התור שלך עודכן. מחכים לך 🙌",
                    post_payment_wa_template: data.post_payment_wa_template ?? "תודה על התשלום! שמחים שבחרת בנו ❤️",
                    post_payment_email_template: data.post_payment_email_template ?? "תודה על התשלום! שמחים שבחרת בנו ❤️",
                    welcome_wa_template: data.welcome_wa_template ?? "ברוך הבא למועדון! אנחנו שמחים שהצטרפת 🎉",
                    welcome_email_template: data.welcome_email_template ?? "ברוך הבא למועדון! אנחנו שמחים שהצטרפת 🎉",
                    reminder_wa_template: data.reminder_wa_template ?? "תזכורת! יש לך תור מחר. מחכים לך 🕐",
                    reminder_email_template: data.reminder_email_template ?? "תזכורת! יש לך תור מחר. מחכים לך 🕐",
                });
            })
            .catch((e) => setErr(e?.message || "שגיאה בטעינת ההגדרות"))
            .finally(() => setLoading(false));
    }, []);

    const handleChange = (field: keyof Settings, val: any) => {
        if (!settings) return;
        setSettings({ ...settings, [field]: val });
    };

    const [logoPreview, setLogoPreview] = useState<string | null>(null);
    const [logoDragging, setLogoDragging] = useState(false);
    const [logoUploading, setLogoUploading] = useState(false);

    const uploadLogoFile = async (file: File) => {
        // Show instant local preview
        const reader = new FileReader();
        reader.onload = e => setLogoPreview(e.target?.result as string);
        reader.readAsDataURL(file);

        const formData = new FormData();
        formData.append("file", file);
        setLogoUploading(true);
        setErr(null);
        try {
            const res = await apiFetch<{ filename: string }>("/api/studio/upload/logo", {
                method: "POST",
                body: formData,
            });
            if (settings) {
                setSettings({ ...settings, logo_filename: res.filename });
                setMsg("לוגו הועלה בהצלחה! ✅");
                setTimeout(() => setMsg(null), 3000);
            }
        } catch (e: unknown) {
            setErr((e as { message?: string })?.message || "שגיאה בהעלאת לוגו");
            setLogoPreview(null);
        } finally {
            setLogoUploading(false);
        }
    };

    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        await uploadLogoFile(e.target.files[0]);
    };

    const handleLogoDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setLogoDragging(false);
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith("image/")) await uploadLogoFile(file);
    };

    const handleGenericUpload = async (e: React.ChangeEvent<HTMLInputElement>, fieldName: keyof Settings) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const file = e.target.files[0];

        const formData = new FormData();
        formData.append("file", file);

        setSaving(true);
        setErr(null);
        try {
            const res = await apiFetch<{ filename: string }>("/api/studio/upload/image", {
                method: "POST",
                body: formData,
            });
            if (settings) {
                setSettings({ ...settings, [fieldName]: res.filename });
                setMsg("תמונה הועלתה בהצלחה!");
                setTimeout(() => setMsg(null), 3000);
            }
        } catch (e: any) {
            setErr(e?.message || "שגיאה בהעלאת תמונה");
        } finally {
            setSaving(false);
        }
    };

    const handleSave = async () => {
        if (!settings) return;
        setErr(null);
        setMsg(null);
        setSaving(true);
        try {
            const res = await apiFetch<Settings>("/api/studio/automation", {
                method: "PATCH",
                body: JSON.stringify(settings),
            });
            setSettings(res);
            setMsg("ההגדרות נשמרו בהצלחה!");

            // Trigger Confetti
            confetti({
                particleCount: 150,
                spread: 70,
                origin: { y: 0.6 },
                colors: [settings.theme_primary_color || '#000', settings.theme_secondary_color || '#fff', '#fbbf24', '#ec4899', '#3b82f6']
            });

            setTimeout(() => setMsg(null), 3500);
        } catch (e: any) {
            setErr(e?.message || "שגיאה בשמירת הגדרות");
        } finally {
            setSaving(false);
        }
    };


    const handleAIGenerate = async () => {
        if (!aiPrompt.trim()) {
            setErr("נא להזין תיאור עבור סגנון העסק לפני הפעלת ה-AI.");
            return;
        }

        if (settings && settings.ai_generations_count >= 3) {
            setErr("הגעת למכסת ה-AI החודשית שלך (3 בחודש). נסה שוב בחודש הבא.");
            return;
        }

        setIsAiLoading(true);
        setErr(null);
        try {
            const res = await apiFetch<any>("/api/studio/automation/ai-generate", { // eslint-disable-line @typescript-eslint/no-explicit-any
                method: "POST",
                body: JSON.stringify({ description: aiPrompt })
            });

            if (settings) {
                setSettings({
                    ...settings,
                    theme_primary_color: res.theme_primary_color,
                    theme_secondary_color: res.theme_secondary_color,
                    landing_page_title: res.landing_page_title,
                    landing_page_description: res.landing_page_description,
                    ai_generations_count: settings.ai_generations_count + 1
                });
                setMsg("העיצוב המותאם יוצר והוחל בהצלחה! באפשרותך לשמור כעת.");
                setTimeout(() => setMsg(null), 3000);
            }
        } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            setErr(e?.message || "שגיאה בייצור העיצוב ה-AI. נסה שוב.");
        } finally {
            setIsAiLoading(false);
        }
    };


    if (loading) {
        return (
            <RequireAuth>
                <AppShell title="הגדרות מערכת">
                    <div className="flex h-[60vh] items-center justify-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-900"></div>
                    </div>
                </AppShell>
            </RequireAuth>
        );
    }

    if (!settings) {
        return (
            <RequireAuth>
                <AppShell title="הגדרות מערכת">
                    <div className="p-8 text-center text-red-500 bg-red-50 rounded-2xl border border-red-100 mt-10 max-w-lg mx-auto">
                        <h2 className="text-xl font-bold mb-2">אופס!</h2>
                        <p>{err || "לא נמצאו הגדרות במערכת"}</p>
                    </div>
                </AppShell>
            </RequireAuth>
        );
    }

    const tabs = [
        { id: "branding", label: "מיתוג ועיצוב", icon: "🎨" },
        { id: "landing", label: "דפי נחיתה", icon: "🚀" },
        { id: "communication", label: "הודעות אוטומטיות", icon: "📩" },
        { id: "policy", label: "מדיניות וכתובת", icon: "📋" },
        { id: "automation", label: "חוקים ואוטומציה", icon: "⚙️" },
        { id: "finance", label: "תשלומים ופיננסים", icon: "💰" },
        { id: "integrations", label: "חיבורים", icon: "🔌" },
    ] as const;

    return (
        <RequireAuth>
            <AppShell title="הגדרות מערכת מתקדמות">

                {/* Prominent Success Popup */}
                {msg && (
                    <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 animate-in fade-in zoom-in duration-300">
                        <div className="bg-emerald-500 text-white px-8 py-4 rounded-2xl shadow-2xl font-bold flex items-center gap-3 border-4 border-emerald-400">
                            <span className="text-2xl">✅</span>
                            {msg}
                        </div>
                    </div>
                )}

                <div className="max-w-5xl mx-auto pb-32">

                    {/* Header describing the section */}
                    <div className="mb-8">
                        <h1 className="text-3xl font-bold text-slate-800 tracking-tight">הגדרות סטודיו</h1>
                        <p className="text-slate-500 mt-2 text-lg">ניהול מראה המערכת, דפי נחיתה, חוקי מועדון לקוחות וחיבורים חיצוניים.</p>
                    </div>

                    {/* Navigation Tabs */}
                    <div className="flex overflow-x-auto gap-2 bg-slate-200/50 p-1.5 rounded-xl mb-8">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-all duration-300 text-sm md:text-base ${activeTab === tab.id
                                    ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/5"
                                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-200"
                                    }`}
                            >
                                <span>{tab.icon}</span>
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* Content area */}
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

                        {/* 1. BRANDING TAB */}
                        {activeTab === "branding" && (
                            <div className="bg-white rounded-2xl border border-slate-100 shadow-xl shadow-slate-200/40 p-6 md:p-10 overflow-hidden relative">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-bl-full -z-10"></div>
                                <h3 className="text-2xl font-bold text-slate-800 mb-6">עיצוב ומיתוג</h3>
                                <div className="grid md:grid-cols-2 gap-8">
                                    <div className="md:col-span-2">
                                        <label className="block text-sm font-semibold text-slate-700 mb-4">לוגו העסק</label>
                                        <div className="flex flex-col sm:flex-row items-center gap-8">

                                            {/* Circle preview */}
                                            <div className="relative shrink-0 group"
                                                onDragOver={e => { e.preventDefault(); setLogoDragging(true); }}
                                                onDragLeave={() => setLogoDragging(false)}
                                                onDrop={handleLogoDrop}>
                                                <div className={`w-36 h-36 rounded-full border-4 overflow-hidden flex items-center justify-center transition-all ${logoDragging ? "border-blue-400 scale-105" : "border-slate-200"} ${logoUploading ? "opacity-60" : ""} bg-slate-50 shadow-lg`}>
                                                    {logoPreview || settings.logo_filename ? (
                                                        // eslint-disable-next-line @next/next/no-img-element
                                                        <img
                                                            src={logoPreview || `${process.env.NEXT_PUBLIC_API_BASE || ""}/uploads/${settings.logo_filename}`}
                                                            alt="לוגו"
                                                            className="w-full h-full object-cover"
                                                            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                                                        />
                                                    ) : (
                                                        <div className="text-center text-slate-400 px-2">
                                                            <div className="text-3xl mb-1">🏢</div>
                                                            <div className="text-xs">גרור לכאן</div>
                                                        </div>
                                                    )}
                                                    {logoUploading && (
                                                        <div className="absolute inset-0 flex items-center justify-center bg-white/70 rounded-full">
                                                            <div className="w-8 h-8 rounded-full border-4 border-slate-200 border-t-sky-500 animate-spin" />
                                                        </div>
                                                    )}
                                                </div>
                                                {logoDragging && (
                                                    <div className="absolute inset-0 rounded-full border-4 border-blue-400 border-dashed bg-blue-50/50 flex items-center justify-center">
                                                        <span className="text-blue-500 text-sm font-bold">שחרר כאן</span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Upload controls */}
                                            <div className="flex-1 space-y-3 text-right">
                                                <p className="text-sm font-semibold text-slate-700">הלוגו של הסטודיו שלך</p>
                                                <p className="text-xs text-slate-500 leading-relaxed">הלוגו מופיע בדפי הנחיתה, בממשק הכניסה ובהודעות ללקוחות. מומלץ תמונה מרובעת (PNG/JPG) ברזולוציה 400×400 לפחות.</p>

                                                <label className="cursor-pointer flex items-center justify-center gap-2 w-full py-3 rounded-xl border-2 border-dashed border-slate-300 hover:border-sky-400 hover:bg-sky-50 text-slate-600 hover:text-sky-600 font-medium text-sm transition-all">
                                                    <span className="text-lg">📤</span>
                                                    <span>{settings.logo_filename ? "החלף תמונה" : "בחר תמונה"}</span>
                                                    <input type="file" className="hidden" accept="image/*" onChange={handleLogoUpload} />
                                                </label>

                                                {settings.logo_filename && (
                                                    <button
                                                        onClick={() => { setSettings({ ...settings, logo_filename: null }); setLogoPreview(null); }}
                                                        className="w-full py-2 text-xs text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors border border-red-100">
                                                        🗑️ הסר לוגו
                                                    </button>
                                                )}

                                                <p className="text-[11px] text-slate-400">ניתן גם לגרור קובץ ישירות לעיגול</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 2. LANDING PAGES TAB */}
                        {activeTab === "landing" && (
                            <div className="space-y-6">

                            {/* Unique Link Banner */}
                            {settings.studio_slug && (() => {
                                const link = `${typeof window !== "undefined" ? window.location.origin : ""}/s/${settings.studio_slug}`;
                                return (
                                    <div className="bg-gradient-to-l from-pink-50 to-purple-50 border border-pink-200 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-bold text-pink-900 mb-1">הקישור הייחודי שלך לדף הנחיתה</p>
                                            <p className="text-xs text-pink-700 mb-2">שלח את הקישור הזה ללקוחות שלך — הם יגיעו לדף ההצטרפות למועדון</p>
                                            <div className="flex items-center bg-white rounded-xl border border-pink-200 px-3 py-2">
                                                <code className="flex-1 text-xs font-mono text-slate-700 break-all" dir="ltr">{link}</code>
                                            </div>
                                        </div>
                                        <div className="flex gap-2 flex-shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => { navigator.clipboard.writeText(link); setMsg("הקישור הועתק!"); setTimeout(() => setMsg(null), 2000); }}
                                                className="bg-pink-600 hover:bg-pink-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm transition-all whitespace-nowrap"
                                            >
                                                העתק קישור
                                            </button>
                                            <a href={link} target="_blank" rel="noopener noreferrer" className="bg-white border border-pink-200 hover:bg-pink-50 text-pink-700 px-4 py-2.5 rounded-xl font-bold text-sm transition-all whitespace-nowrap">
                                                תצוגה מקדימה
                                            </a>
                                        </div>
                                    </div>
                                );
                            })()}

                            <div className="bg-white rounded-2xl border border-slate-100 shadow-xl shadow-slate-200/40 p-6 md:p-10 relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-32 h-32 bg-pink-500/10 rounded-br-full -z-10"></div>

                                <div className="grid lg:grid-cols-2 gap-10">
                                    {/* Left Side: Settings Form */}
                                    <div className="flex flex-col gap-8">
                                        <div>
                                            <h3 className="text-2xl font-bold text-slate-800 mb-2">עיצוב דף הנחיתה</h3>
                                            <p className="text-slate-500">איך יראה דף ההרשמה שהלקוחות שלך רואים כשהם מצטרפים למועדון?</p>
                                        </div>

                                        {/* AI Generator Box - MOVED TO TOP */}
                                        <div className="p-6 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl border border-indigo-100 shadow-inner">
                                            <div className="flex items-center justify-between gap-2 mb-3">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xl">✨</span>
                                                    <h4 className="font-bold text-indigo-900">מחולל עיצוב ב-AI</h4>
                                                </div>
                                                <div className={`text-xs font-bold px-2.5 py-1 rounded-full ${settings.ai_generations_count >= 3 ? 'bg-red-100 text-red-700' : 'bg-indigo-100 text-indigo-700'}`}>
                                                    נסיונות החודש: {Math.max(0, 3 - settings.ai_generations_count)}/3 נותרו
                                                </div>
                                            </div>
                                            <p className="text-sm text-indigo-700/80 mb-4">תאר/י את האווירה של העסק שלך וניתן לבינה מלאכותית לעצב ולכתוב לך את דף הנחיתה המושלם!</p>

                                            <div className="flex flex-col sm:flex-row gap-3">
                                                <input
                                                    type="text"
                                                    value={aiPrompt}
                                                    onChange={(e) => setAiPrompt(e.target.value)}
                                                    placeholder="לדוגמה: סטודיו באווירה אפלה ואקסקלוסיבית..."
                                                    className="flex-1 bg-white border border-indigo-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 text-sm disabled:opacity-50"
                                                    disabled={isAiLoading || settings.ai_generations_count >= 3}
                                                />
                                                <button
                                                    onClick={(e) => { e.preventDefault(); handleAIGenerate(); }}
                                                    disabled={isAiLoading || settings.ai_generations_count >= 3}
                                                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-6 py-2.5 rounded-xl transition-all disabled:opacity-50 flex justify-center items-center gap-2 whitespace-nowrap shadow-md"
                                                >
                                                    {isAiLoading ? (
                                                        <>
                                                            <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin"></div>
                                                            מייצר...
                                                        </>
                                                    ) : (
                                                        "צור עיצוב"
                                                    )}
                                                </button>
                                            </div>
                                        </div>

                                        {/* Color Pickers - MOVED FROM BRANDING */}
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <label className="block text-sm font-semibold text-slate-700">צבע ראשי (Primary)</label>
                                                <div className="flex items-center gap-3 bg-slate-50 p-2 rounded-xl border border-slate-200 focus-within:ring-2 focus-within:ring-purple-500 transition-all">
                                                    <input
                                                        type="color"
                                                        value={settings.theme_primary_color || "#000000"}
                                                        onChange={e => handleChange("theme_primary_color", e.target.value)}
                                                        className="h-10 w-12 rounded cursor-pointer border-0 p-0"
                                                    />
                                                    <input
                                                        type="text" dir="ltr"
                                                        value={settings.theme_primary_color || "#000000"}
                                                        onChange={e => handleChange("theme_primary_color", e.target.value)}
                                                        className="bg-transparent w-full text-xs outline-none uppercase font-mono font-medium text-slate-700"
                                                    />
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <label className="block text-sm font-semibold text-slate-700">צבע משני (Secondary)</label>
                                                <div className="flex items-center gap-3 bg-slate-50 p-2 rounded-xl border border-slate-200 focus-within:ring-2 focus-within:ring-purple-500 transition-all">
                                                    <input
                                                        type="color"
                                                        value={settings.theme_secondary_color || "#ffffff"}
                                                        onChange={e => handleChange("theme_secondary_color", e.target.value)}
                                                        className="h-10 w-12 rounded cursor-pointer border-0 p-0"
                                                    />
                                                    <input
                                                        type="text" dir="ltr"
                                                        value={settings.theme_secondary_color || "#ffffff"}
                                                        onChange={e => handleChange("theme_secondary_color", e.target.value)}
                                                        className="bg-transparent w-full text-xs outline-none uppercase font-mono font-medium text-slate-700"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-4">תבנית דף הנחיתה</label>
                                            <div className="grid gap-3">
                                                {[
                                                    { id: 1, name: "תבנית קלאסית", desc: "כרטיס הרשמה ממורכז ומרשים." },
                                                    { id: 2, name: "מסך מפוצל", desc: "מודרני ויוקרתי, הלוגו והצבע הראשי בצד ימין." },
                                                    { id: 3, name: "מינימליסטית", desc: "נקי ורך, בסגנון מגזין אופנה (Vogue)." }
                                                ].map(t => (
                                                    <label
                                                        key={t.id}
                                                        className={`relative cursor-pointer flex flex-col p-4 rounded-xl border-2 transition-all duration-300 ${settings.landing_page_active_template === t.id
                                                            ? 'border-pink-500 bg-pink-50/50 shadow-md transform -translate-y-0.5'
                                                            : 'border-slate-200 hover:border-pink-300 hover:bg-slate-50 opacity-80'
                                                            }`}
                                                    >
                                                        <input
                                                            type="radio"
                                                            name="template"
                                                            value={t.id}
                                                            checked={settings.landing_page_active_template === t.id}
                                                            onChange={() => handleChange("landing_page_active_template", t.id)}
                                                            className="sr-only"
                                                        />
                                                        <div className="font-bold text-slate-800 text-sm mb-1">{t.name}</div>
                                                        <div className="text-xs text-slate-500 leading-relaxed">{t.desc}</div>

                                                        {settings.landing_page_active_template === t.id && (
                                                            <div className="absolute top-4 left-4 w-4 h-4 bg-pink-500 rounded-full flex items-center justify-center">
                                                                <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
                                                            </div>
                                                        )}
                                                    </label>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="space-y-4 pt-4 border-t border-slate-100">
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <label className="block text-sm font-semibold text-slate-700">פונט לכותרת</label>
                                                    <select
                                                        value={settings.landing_page_title_font}
                                                        onChange={e => handleChange("landing_page_title_font", e.target.value)}
                                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-pink-500 transition-all text-sm"
                                                    >
                                                        <option value="Heebo">Heebo</option>
                                                        <option value="Assistant">Assistant</option>
                                                        <option value="Rubik">Rubik</option>
                                                        <option value="M PLUS Rounded 1c">M PLUS Rounded 1c</option>
                                                        <option value="Varela Round">Varela Round</option>
                                                    </select>
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="block text-sm font-semibold text-slate-700">פונט לתיאור</label>
                                                    <select
                                                        value={settings.landing_page_desc_font}
                                                        onChange={e => handleChange("landing_page_desc_font", e.target.value)}
                                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-pink-500 transition-all text-sm"
                                                    >
                                                        <option value="Heebo">Heebo</option>
                                                        <option value="Assistant">Assistant</option>
                                                        <option value="Rubik">Rubik</option>
                                                        <option value="M PLUS Rounded 1c">M PLUS Rounded 1c</option>
                                                        <option value="Varela Round">Varela Round</option>
                                                    </select>
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <label className="block text-sm font-semibold text-slate-700">תמונת רקע לדף (אופציונלי)</label>
                                                {settings.landing_page_bg_image ? (
                                                    <div className="flex items-center gap-4">
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img src={`${process.env.NEXT_PUBLIC_API_BASE || ""}/uploads/${settings.landing_page_bg_image}`} alt="BG" className="h-16 w-16 object-cover rounded-lg border border-slate-200" />
                                                        <button onClick={() => handleChange("landing_page_bg_image", null)} className="text-red-500 text-sm font-bold hover:underline">הסר תמונה</button>
                                                    </div>
                                                ) : (
                                                    <label className="cursor-pointer inline-flex items-center justify-center px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl transition-colors border border-slate-300 w-full">
                                                        <span>העלה תמונת רקע</span>
                                                        <input type="file" className="hidden" accept="image/*" onChange={(e) => handleGenericUpload(e, "landing_page_bg_image")} />
                                                    </label>
                                                )}
                                            </div>

                                            <div className="space-y-2">
                                                <label className="block text-sm font-semibold text-slate-700">כותרת עמוד ההרשמה</label>
                                                <input
                                                    type="text"
                                                    placeholder="למשל: הצטרפו למועדון הלקוחות האקסקלוסיבי שלנו!"
                                                    value={settings.landing_page_title || ""}
                                                    onChange={e => handleChange("landing_page_title", e.target.value)}
                                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-pink-500 focus:bg-white transition-all text-sm"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="block text-sm font-semibold text-slate-700">תיאור ופרטי המבצע</label>
                                                <textarea
                                                    placeholder="למשל: הירשמו עכשיו וקבלו 50 נקודות מתנה לפגישה הראשונה..."
                                                    rows={3}
                                                    value={settings.landing_page_description || ""}
                                                    onChange={e => handleChange("landing_page_description", e.target.value)}
                                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-pink-500 focus:bg-white transition-all resize-y text-sm"
                                                />
                                            </div>

                                            <div className="space-y-2 pt-4">
                                                <label className="block text-sm font-semibold text-slate-700">גלריית תמונות (עד 3 - יוצג כסליידר אוטומטי)</label>
                                                <div className="grid grid-cols-3 gap-2">
                                                    {[1, 2, 3].map(num => {
                                                        const key = `landing_page_image_${num}` as keyof Settings;
                                                        const val = settings[key] as string | null;
                                                        return (
                                                            <div key={num} className="border border-slate-200 rounded-xl h-24 flex items-center justify-center relative overflow-hidden bg-slate-50">
                                                                {val ? (
                                                                    <>
                                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                                        <img src={`${process.env.NEXT_PUBLIC_API_BASE || ""}/uploads/${val}`} alt={`img-${num}`} className="w-full h-full object-cover" />
                                                                        <button onClick={() => handleChange(key, null)} className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow-md pb-0.5">&times;</button>
                                                                    </>
                                                                ) : (
                                                                    <label className="cursor-pointer flex flex-col items-center justify-center w-full h-full hover:bg-slate-100 transition-colors">
                                                                        <span className="text-xl text-slate-400">+</span>
                                                                        <input type="file" className="hidden" accept="image/*" onChange={(e) => handleGenericUpload(e, key)} />
                                                                    </label>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                <p className="text-xs text-slate-400 mt-1">העלה את העבודות הטובות ביותר שלך כדי להרשים את הלקוחות בעמוד ההרשמה.</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right Side: Live Preview Browser Window */}
                                    <div className="bg-slate-100/50 p-6 rounded-3xl border border-slate-200 flex flex-col h-[750px] sticky top-10">
                                        <div className="flex items-center justify-between mb-4">
                                            <h4 className="font-bold text-slate-700 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-pink-500 animate-pulse"></span>תצוגה מקדימה</h4>
                                            <span className="text-xs font-mono text-slate-400 bg-white px-2 py-1 rounded shadow-sm">Preview</span>
                                        </div>

                                        <div className="mb-4 bg-white border border-slate-200 rounded-xl p-3 flex flex-col gap-2">
                                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">לינק הצטרפות אישי</label>
                                            <div className="flex items-center gap-2">
                                                <input readOnly value={settings.studio_slug ? `${typeof window !== "undefined" ? window.location.origin : ""}/s/${settings.studio_slug}` : "לא הוגדר slug לסטודיו"} className="flex-1 bg-slate-50 text-slate-600 font-mono text-sm px-3 py-2 rounded-lg border border-slate-200 outline-none" dir="ltr" />
                                                <button onClick={() => { const link = `${typeof window !== "undefined" ? window.location.origin : ""}/s/${settings.studio_slug}`; navigator.clipboard.writeText(link); setMsg("הקישור הועתק!"); setTimeout(() => setMsg(null), 2000); }} className="px-3 py-2 bg-pink-50 text-pink-600 hover:bg-pink-100 font-bold rounded-lg text-sm transition-colors ring-1 ring-pink-200">העתק</button>
                                            </div>
                                        </div>

                                        {/* Browser frame container */}
                                        <div className="flex-1 w-full relative bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200 flex flex-col">
                                            {/* Browser Header bar */}
                                            <div className="h-10 bg-slate-100 border-b border-slate-200 flex items-center px-4 gap-2">
                                                <div className="flex gap-1.5">
                                                    <div className="w-3 h-3 rounded-full bg-red-400"></div>
                                                    <div className="w-3 h-3 rounded-full bg-amber-400"></div>
                                                    <div className="w-3 h-3 rounded-full bg-green-400"></div>
                                                </div>
                                                <div className="flex-1 flex justify-center">
                                                    <div className="bg-white/60 text-slate-400 text-[10px] font-mono py-1 px-8 rounded-full border border-slate-200">{settings.studio_slug ? `biz-control.com/s/${settings.studio_slug}` : "slug לא מוגדר"}</div>
                                                </div>
                                            </div>

                                            {/* The actual preview Component */}
                                            <div className="flex-1 overflow-x-hidden overflow-y-auto relative bg-white scrollbar-thin">
                                                <div className="absolute inset-0 origin-top w-[140%] h-[140%] scale-[0.714]">
                                                    <LandingPageTemplate
                                                        themePrimary={settings.theme_primary_color}
                                                        themeSecondary={settings.theme_secondary_color}
                                                        logoUrl={settings.logo_filename ? `${process.env.NEXT_PUBLIC_API_BASE || ""}/uploads/${settings.logo_filename}` : null}
                                                        title={settings.landing_page_title || ""}
                                                        description={settings.landing_page_description || ""}
                                                        templateId={settings.landing_page_active_template}
                                                        bgImage={settings.landing_page_bg_image ? `${process.env.NEXT_PUBLIC_API_BASE || ""}/uploads/${settings.landing_page_bg_image}` : null}
                                                        titleFont={settings.landing_page_title_font}
                                                        descFont={settings.landing_page_desc_font}
                                                        galleryImages={[
                                                            settings.landing_page_image_1 ? `${process.env.NEXT_PUBLIC_API_BASE || ""}/uploads/${settings.landing_page_image_1}` : null,
                                                            settings.landing_page_image_2 ? `${process.env.NEXT_PUBLIC_API_BASE || ""}/uploads/${settings.landing_page_image_2}` : null,
                                                            settings.landing_page_image_3 ? `${process.env.NEXT_PUBLIC_API_BASE || ""}/uploads/${settings.landing_page_image_3}` : null,
                                                        ]}
                                                        isLive={false}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            </div>
                        )}

                        {/* 3. COMMUNICATION & MESSAGES TAB */}
                        {activeTab === "communication" && (
                            <div className="space-y-8">
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-xl shadow-slate-200/40 p-6 md:p-10 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-bl-full -z-10"></div>
                                    <div className="flex items-center gap-3 mb-8">
                                        <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-xl">📩</div>
                                        <div>
                                            <h3 className="text-2xl font-bold text-slate-800">ניהול תבניות ותקשורת</h3>
                                            <p className="text-sm text-slate-500">ערוך את המלל שיישלח ללקוחות בנקודות זמן קריטיות.</p>
                                        </div>
                                    </div>

                                    <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 mb-10 flex gap-4">
                                        <div className="text-2xl">💡</div>
                                        <div className="w-full">
                                            <h4 className="font-bold text-blue-900 text-sm mb-1">משתנים זמינים בהודעות</h4>
                                            <p className="text-xs text-blue-800/80 leading-relaxed mb-2">העתק והדבק את המשתנים הרצויים לתוך תבנית ההודעה:</p>
                                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                                                {[
                                                    "{client_name}", "{appointment_title}", "{appointment_date}", "{appointment_time}",
                                                    "{artist_name}", "{deposit_amount}", "{studio_address}", "{map_link}",
                                                    "{portfolio_link}", "{bit_link}", "{paybox_link}", "{bank_details}",
                                                    "{cancellation_free_days}", "{deposit_lock_days}", "{loyalty_points}", "{join_link}",
                                                    "{points_used}", "{discount_amount}", "{points_on_signup}", "{contact_phone}"
                                                ].map(tag => (
                                                    <button key={tag} type="button" onClick={() => navigator.clipboard.writeText(tag)}
                                                        className="text-[10px] bg-white border border-blue-200 px-1.5 py-1 rounded text-blue-700 hover:bg-blue-100 transition-colors text-right font-mono">
                                                        {tag}
                                                    </button>
                                                ))}
                                            </div>
                                            <p className="text-[10px] text-blue-600 mt-2">לחץ על משתנה כדי להעתיק אותו</p>
                                        </div>
                                    </div>

                                    <div className="space-y-12">
                                        {/* JOIN / Welcome */}
                                        <div className="space-y-6">
                                            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                                                <span className="text-xl">👋</span>
                                                <h4 className="font-bold text-slate-800">הודעת ברוכים הבאים (מיידי בהרשמה)</h4>
                                            </div>
                                            <div className="grid md:grid-cols-2 gap-6">
                                                <div className="space-y-2">
                                                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-widest text-right">WhatsApp Template</label>
                                                    <textarea rows={4} value={settings.welcome_wa_template || ""} onChange={e => handleChange("welcome_wa_template", e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-green-500 text-sm" placeholder="שלום {client_name}, ברוכים הבאים!..." />
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-widest text-right">Email Template</label>
                                                    <textarea rows={4} value={settings.welcome_email_template || ""} onChange={e => handleChange("welcome_email_template", e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 text-sm" placeholder="שלום {client_name}..." />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Confirmation */}
                                        <div className="space-y-6">
                                            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                                                <span className="text-xl">✅</span>
                                                <h4 className="font-bold text-slate-800">אישור תור חדש</h4>
                                            </div>
                                            <div className="grid md:grid-cols-2 gap-6">
                                                <div className="space-y-2">
                                                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-widest text-right">WhatsApp Template</label>
                                                    <textarea rows={4} value={settings.confirm_wa_template || ""} onChange={e => handleChange("confirm_wa_template", e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-green-500 text-sm" placeholder="היי {client_name}, התור נקבע!..." />
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-widest text-right">Email Template</label>
                                                    <textarea rows={4} value={settings.confirm_email_template || ""} onChange={e => handleChange("confirm_email_template", e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 text-sm" placeholder="שלום {client_name}..." />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Reminder */}
                                        <div className="space-y-6">
                                            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                                                <span className="text-xl">🔔</span>
                                                <h4 className="font-bold text-slate-800">תזכורת לתור (24 שעות לפני)</h4>
                                            </div>
                                            <div className="grid md:grid-cols-2 gap-6">
                                                <div className="space-y-2">
                                                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-widest text-right">WhatsApp Template</label>
                                                    <textarea rows={4} value={settings.reminder_wa_template || ""} onChange={e => handleChange("reminder_wa_template", e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-green-500 text-sm" placeholder="תזכורת: מחכים לך מחר!..." />
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-widest text-right">Email Template</label>
                                                    <textarea rows={4} value={settings.reminder_email_template || ""} onChange={e => handleChange("reminder_email_template", e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 text-sm" placeholder="היי {client_name}, רק מזכירים..." />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Reschedule */}
                                        <div className="space-y-6">
                                            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                                                <span className="text-xl">🔄</span>
                                                <h4 className="font-bold text-slate-800">עדכון/הזזת תור</h4>
                                            </div>
                                            <div className="grid md:grid-cols-2 gap-6">
                                                <div className="space-y-2">
                                                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-widest text-right">WhatsApp Template</label>
                                                    <textarea rows={4} value={settings.reschedule_wa_template || ""} onChange={e => handleChange("reschedule_wa_template", e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-green-500 text-sm" />
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-widest text-right">Email Template</label>
                                                    <textarea rows={4} value={settings.reschedule_email_template || ""} onChange={e => handleChange("reschedule_email_template", e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 text-sm" />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Cancellation */}
                                        <div className="space-y-6">
                                            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                                                <span className="text-xl">❌</span>
                                                <h4 className="font-bold text-slate-800">הודעת ביטול תור</h4>
                                            </div>
                                            <div className="grid md:grid-cols-2 gap-6">
                                                <div className="space-y-2">
                                                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-widest text-right">WhatsApp Template</label>
                                                    <textarea rows={4} value={settings.cancel_wa_template || ""} onChange={e => handleChange("cancel_wa_template", e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-red-400 text-sm" />
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-widest text-right">Email Template</label>
                                                    <textarea rows={4} value={settings.cancel_email_template || ""} onChange={e => handleChange("cancel_email_template", e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-red-400 text-sm" />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Birthday Message */}
                                        <div className="space-y-6">
                                            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                                                <span className="text-xl">🎉</span>
                                                <h4 className="font-bold text-slate-800">ברכת יום הולדת והטבה</h4>
                                            </div>
                                            <div className="grid md:grid-cols-2 gap-6">
                                                <div className="space-y-2">
                                                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-widest text-right">WhatsApp Template</label>
                                                    <textarea rows={4} value={settings.birthday_wa_template || ""} onChange={e => handleChange("birthday_wa_template", e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-pink-400 text-sm" placeholder="מזל טוב {client_name}! לרגל יום הולדתך..." />
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-widest text-right">Email Template</label>
                                                    <textarea rows={4} value={settings.birthday_email_template || ""} onChange={e => handleChange("birthday_email_template", e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-pink-400 text-sm" placeholder="יום הולדת שמח {client_name}!..." />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Deposit Request */}
                                        <div className="space-y-4">
                                            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                                                <span className="text-xl">💳</span>
                                                <div>
                                                    <h4 className="font-bold text-slate-800">בקשת מקדמה (נשלח אוטומטית בקביעת תור)</h4>
                                                    <p className="text-xs text-slate-500">נשלח רק לתורים שדורשים מקדמה (מעל 30 דקות)</p>
                                                </div>
                                            </div>
                                            <textarea rows={7} value={settings.deposit_request_wa_template || ""} onChange={e => handleChange("deposit_request_wa_template", e.target.value)}
                                                className="w-full bg-slate-50 border border-emerald-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-mono" />
                                        </div>

                                        {/* Deposit Approved */}
                                        <div className="space-y-4">
                                            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                                                <span className="text-xl">✅</span>
                                                <div>
                                                    <h4 className="font-bold text-slate-800">אישור מקדמה + פרטים מלאים</h4>
                                                    <p className="text-xs text-slate-500">נשלח אוטומטית אחרי שאתה מאשר את קבלת המקדמה במערכת</p>
                                                </div>
                                            </div>
                                            <textarea rows={10} value={settings.deposit_approved_wa_template || ""} onChange={e => handleChange("deposit_approved_wa_template", e.target.value)}
                                                className="w-full bg-slate-50 border border-emerald-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-mono" />
                                        </div>

                                        {/* Non-Member */}
                                        <div className="space-y-4">
                                            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                                                <span className="text-xl">👤</span>
                                                <div>
                                                    <h4 className="font-bold text-slate-800">הזמנה למועדון — לקוח שאינו חבר</h4>
                                                    <p className="text-xs text-slate-500">נשלח ללקוח חדש שביקר אך עוד לא נרשם למועדון</p>
                                                </div>
                                            </div>
                                            <textarea rows={5} value={settings.non_member_wa_template || ""} onChange={e => handleChange("non_member_wa_template", e.target.value)}
                                                className="w-full bg-slate-50 border border-purple-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-purple-500 text-sm font-mono" />
                                        </div>

                                        {/* Points Redeem */}
                                        <div className="space-y-4">
                                            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                                                <span className="text-xl">🎁</span>
                                                <div>
                                                    <h4 className="font-bold text-slate-800">מימוש נקודות מהקרדיט</h4>
                                                    <p className="text-xs text-slate-500">נשלח ללקוח כשהוא ממש נקודות נאמנות</p>
                                                </div>
                                            </div>
                                            <textarea rows={4} value={settings.points_redeem_wa_template || ""} onChange={e => handleChange("points_redeem_wa_template", e.target.value)}
                                                className="w-full bg-slate-50 border border-amber-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-amber-500 text-sm font-mono" />
                                        </div>

                                        {/* Post-Payment & Aftercare */}
                                        <div className="space-y-6">
                                            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                                                <span className="text-xl">🩹</span>
                                                <h4 className="font-bold text-slate-800">הוראות טיפול (Aftercare) וסיום תור</h4>
                                            </div>
                                            <div className="space-y-4">
                                                <div className="space-y-2">
                                                    <label className="block text-sm font-bold text-slate-700">הוראות טיפול (נשלח אוטומטית בסיום התור)</label>
                                                    <textarea rows={6} value={settings.aftercare_message || ""} onChange={e => handleChange("aftercare_message", e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 text-sm" placeholder="כאן כותבים את הוראות הטיפול בקעקוע..." />
                                                </div>
                                                <div className="grid md:grid-cols-2 gap-6">
                                                    <div className="space-y-2">
                                                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-widest text-right">שורת אישור תשלום (WhatsApp)</label>
                                                        <textarea rows={3} value={settings.post_payment_wa_template || ""} onChange={e => handleChange("post_payment_wa_template", e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-green-500 text-sm" placeholder="תודה שביקרת אצלנו!..." />
                                                    </div>
                                                    <div className="space-y-2">
                                                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-widest text-right">שורת אישור תשלום (Email)</label>
                                                        <textarea rows={3} value={settings.post_payment_email_template || ""} onChange={e => handleChange("post_payment_email_template", e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 text-sm" />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Review Links */}
                                        <div className="space-y-6 pt-4">
                                            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                                                <span className="text-xl">⭐</span>
                                                <h4 className="font-bold text-slate-800">קישורי רשתות וביקורות</h4>
                                            </div>
                                            <div className="grid md:grid-cols-2 gap-6">
                                                <div className="space-y-2 md:col-span-2">
                                                    <label className="block text-sm font-bold text-slate-700">Google Review Link</label>
                                                    <input type="url" dir="ltr" value={settings.review_link_google || ""} onChange={e => handleChange("review_link_google", e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-yellow-500 text-sm" />
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="block text-sm font-semibold text-slate-700">Instagram</label>
                                                    <input type="url" dir="ltr" value={settings.review_link_instagram || ""} onChange={e => handleChange("review_link_instagram", e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-pink-500 text-sm" />
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="block text-sm font-semibold text-slate-700">Facebook</label>
                                                    <input type="url" dir="ltr" value={settings.review_link_facebook || ""} onChange={e => handleChange("review_link_facebook", e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 3.5 POLICY TAB */}
                        {activeTab === "policy" && (
                            <div className="space-y-8">
                                {/* Studio Info */}
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-xl shadow-slate-200/40 p-6 md:p-10 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/10 rounded-bl-full -z-10"></div>
                                    <h3 className="text-2xl font-bold text-slate-800 mb-2">פרטי הסטודיו</h3>
                                    <p className="text-slate-500 text-sm mb-8">פרטים אלו ישולבו אוטומטית בהודעות ללקוחות (כתובת, מפה, תיק עבודות).</p>
                                    <div className="space-y-5">
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-1">כתובת הסטודיו</label>
                                            <input type="text" value={settings.studio_address || ""} onChange={e => handleChange("studio_address", e.target.value)}
                                                placeholder="לדוג׳: רחוב הרצל 12, תל אביב"
                                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500 text-sm" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-1">קישור למפה (Waze / Google Maps)</label>
                                            <input type="url" dir="ltr" value={settings.studio_map_link || ""} onChange={e => handleChange("studio_map_link", e.target.value)}
                                                placeholder="https://waze.com/ul?..."
                                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500 text-sm" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-1">קישור לתיק עבודות (Instagram / אתר)</label>
                                            <input type="url" dir="ltr" value={settings.studio_portfolio_link || ""} onChange={e => handleChange("studio_portfolio_link", e.target.value)}
                                                placeholder="https://instagram.com/..."
                                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-orange-500 text-sm" />
                                        </div>
                                    </div>
                                </div>

                                {/* Bank Details */}
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-xl shadow-slate-200/40 p-6 md:p-10 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-bl-full -z-10"></div>
                                    <h3 className="text-2xl font-bold text-slate-800 mb-2">פרטי העברה בנקאית</h3>
                                    <p className="text-slate-500 text-sm mb-8">פרטים אלו ישולבו אוטומטית בהודעת בקשת המקדמה דרך המשתנה <code className="bg-slate-100 px-1 rounded text-xs">{"{bank_details}"}</code></p>
                                    <div className="grid md:grid-cols-3 gap-5">
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-1">שם הבנק</label>
                                            <input type="text" value={settings.bank_name || ""} onChange={e => handleChange("bank_name", e.target.value)}
                                                placeholder="לדוג׳: בנק הפועלים"
                                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-1">מספר סניף</label>
                                            <input type="text" dir="ltr" value={settings.bank_branch || ""} onChange={e => handleChange("bank_branch", e.target.value)}
                                                placeholder="612"
                                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-1">מספר חשבון</label>
                                            <input type="text" dir="ltr" value={settings.bank_account || ""} onChange={e => handleChange("bank_account", e.target.value)}
                                                placeholder="123456"
                                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
                                        </div>
                                    </div>
                                    {(settings.bank_name || settings.bank_branch || settings.bank_account) && (
                                        <div className="mt-4 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-600" dir="ltr">
                                            <span className="font-semibold text-slate-800">תצוגה מקדימה: </span>
                                            {settings.bank_name} | סניף {settings.bank_branch} | חשבון {settings.bank_account}
                                        </div>
                                    )}
                                </div>

                                {/* Cancellation Policy */}
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-xl shadow-slate-200/40 p-6 md:p-10 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/10 rounded-bl-full -z-10"></div>
                                    <h3 className="text-2xl font-bold text-slate-800 mb-2">מדיניות ביטולים ומקדמה</h3>
                                    <p className="text-slate-500 text-sm mb-8">הגדרות אלו ישולבו אוטומטית בהודעת אישור המקדמה.</p>
                                    <div className="grid md:grid-cols-2 gap-8">
                                        <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-100">
                                            <label className="block text-base font-bold text-slate-800 mb-2">ביטול חינם עד כמה ימים לפני? ✅</label>
                                            <p className="text-sm text-slate-500 mb-4">לקוח יקבל החזר מקדמה מלא אם יבטל לפחות X ימים לפני התור.</p>
                                            <div className="flex items-center gap-3">
                                                <input type="number" min="0" max="60"
                                                    value={settings.cancellation_free_days ?? 7}
                                                    onChange={e => handleChange("cancellation_free_days", parseInt(e.target.value) || 0)}
                                                    className="w-24 text-center bg-white border border-emerald-200 rounded-xl px-4 py-3 font-bold text-xl outline-none focus:ring-2 focus:ring-emerald-500" />
                                                <span className="text-slate-600 font-medium">ימים לפני</span>
                                            </div>
                                        </div>
                                        <div className="bg-red-50 p-6 rounded-2xl border border-red-100">
                                            <label className="block text-base font-bold text-slate-800 mb-2">נעילת שינוי תור עד כמה ימים לפני? 🔒</label>
                                            <p className="text-sm text-slate-500 mb-4">לאחר תשלום מקדמה, הלקוח לא יוכל לשנות את התור X ימים לפניו.</p>
                                            <div className="flex items-center gap-3">
                                                <input type="number" min="0" max="60"
                                                    value={settings.deposit_lock_days ?? 7}
                                                    onChange={e => handleChange("deposit_lock_days", parseInt(e.target.value) || 0)}
                                                    className="w-24 text-center bg-white border border-red-200 rounded-xl px-4 py-3 font-bold text-xl outline-none focus:ring-2 focus:ring-red-500" />
                                                <span className="text-slate-600 font-medium">ימים לפני</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
                                        <span className="font-bold">תצוגה מקדימה של מדיניות הביטולים: </span>
                                        ביטול עד {settings.cancellation_free_days ?? 7} ימים לפני — החזר מלא של המקדמה. פחות מ-{settings.cancellation_free_days ?? 7} ימים — ללא החזר. שינוי תור אפשרי עד {settings.deposit_lock_days ?? 7} ימים לפני בלבד.
                                    </div>
                                </div>

                                {/* Deposit Auto-Fill */}
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-xl shadow-slate-200/40 p-6 md:p-10 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-bl-full -z-10"></div>
                                    <h3 className="text-2xl font-bold text-slate-800 mb-2">מקדמה אוטומטית ביומן</h3>
                                    <p className="text-slate-500 text-sm mb-8">כאשר קובעים תור ביומן, שדה המקדמה יתמלא אוטומטית על פי הגדרות אלו.</p>
                                    <div className="grid md:grid-cols-2 gap-8">
                                        <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-100">
                                            <label className="block text-base font-bold text-slate-800 mb-2">סכום מקדמה קבוע 💳</label>
                                            <p className="text-sm text-slate-500 mb-4">כמה ₪ יוצג אוטומטית בשדה המקדמה בעת קביעת תור? (0 = ללא)</p>
                                            <div className="flex items-center gap-3">
                                                <input type="number" min="0"
                                                    value={settings.deposit_fixed_amount_ils ?? 0}
                                                    onChange={e => handleChange("deposit_fixed_amount_ils", parseInt(e.target.value) || 0)}
                                                    className="w-24 text-center bg-white border border-emerald-200 rounded-xl px-4 py-3 font-bold text-xl outline-none focus:ring-2 focus:ring-emerald-500" />
                                                <span className="text-slate-600 font-medium">₪</span>
                                            </div>
                                        </div>
                                        <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                                            <label className="block text-base font-bold text-slate-800 mb-2">מינימום דקות לתור עם מקדמה ⏱️</label>
                                            <p className="text-sm text-slate-500 mb-4">מקדמה תתמלא אוטומטית רק אם התור ארוך מ-X דקות. (ריק = תמיד)</p>
                                            <div className="flex items-center gap-3">
                                                <input type="number" min="0"
                                                    value={settings.deposit_min_duration_minutes ?? ""}
                                                    onChange={e => handleChange("deposit_min_duration_minutes", e.target.value === "" ? null : parseInt(e.target.value) || 0)}
                                                    placeholder="ללא הגבלה"
                                                    className="w-24 text-center bg-white border border-slate-200 rounded-xl px-4 py-3 font-bold text-xl outline-none focus:ring-2 focus:ring-blue-500" />
                                                <span className="text-slate-600 font-medium">דקות</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 4. LOYALTY RULES & CALENDAR TAB */}
                        {activeTab === "automation" && (
                            <div className="space-y-6">
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-xl shadow-slate-200/40 p-6 md:p-10 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-bl-full -z-10"></div>
                                    <h3 className="text-2xl font-bold text-slate-800 mb-6">חוקי מועדון ואוטומציה</h3>

                                    <div className="grid md:grid-cols-2 gap-8">
                                        <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                                            <label className="block text-base font-bold text-slate-800 mb-2">תזמון הודעת Aftercare</label>
                                            <p className="text-sm text-slate-500 mb-4">כמה דקות לאחר סיום התור תישלח ללקוח ההודעה והבקשה לביקורת?</p>
                                            <div className="flex items-center gap-3">
                                                <input
                                                    type="number"
                                                    value={settings.aftercare_delay_minutes ?? 0}
                                                    onChange={e => handleChange("aftercare_delay_minutes", parseInt(e.target.value) || 0)}
                                                    className="w-24 text-center bg-white border border-slate-200 rounded-xl px-4 py-3 font-semibold text-lg outline-none focus:ring-2 focus:ring-blue-500"
                                                />
                                                <span className="text-slate-600 font-medium">דקות</span>
                                            </div>
                                        </div>

                                        <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                                            <label className="block text-base font-bold text-slate-800 mb-2">מתנת הצטרפות למועדון</label>
                                            <p className="text-sm text-slate-500 mb-4">כמה נקודות יקבל לקוח חדש ברגע שיירשם דרך דף הנחיתה?</p>
                                            <div className="flex items-center gap-3">
                                                <input
                                                    type="number"
                                                    value={settings.points_on_signup ?? 0}
                                                    onChange={e => handleChange("points_on_signup", parseInt(e.target.value) || 0)}
                                                    className="w-24 text-center bg-white border border-slate-200 rounded-xl px-4 py-3 font-semibold text-lg outline-none focus:ring-2 focus:ring-pink-500"
                                                />
                                                <span className="text-slate-600 font-medium">נקודות</span>
                                            </div>
                                        </div>

                                        <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                                            <label className="block text-base font-bold text-slate-800 mb-2">אחוז צבירה מקסימלי (% קאשבק מתשלום)</label>
                                            <p className="text-sm text-slate-500 mb-4">כמה נקודות זוכה הלקוח אוטומטית כ-Cashback לאחר תשלום?</p>
                                            <div className="flex items-center gap-3">
                                                <input
                                                    type="number"
                                                    value={settings.points_percent_per_payment ?? 0}
                                                    onChange={e => handleChange("points_percent_per_payment", parseInt(e.target.value) || 0)}
                                                    className="w-24 text-center bg-white border border-slate-200 rounded-xl px-4 py-3 font-semibold text-lg outline-none focus:ring-2 focus:ring-pink-500"
                                                    min="0" max="100"
                                                />
                                                <span className="text-slate-600 font-medium">אחוזים (%)</span>
                                            </div>
                                        </div>

                                        <div className="bg-pink-50 p-6 rounded-2xl border border-pink-100">
                                            <label className="block text-base font-bold text-slate-800 mb-2">אחוז הנחת יום הולדת 🎉</label>
                                            <p className="text-sm text-slate-500 mb-4">איזו הנחה יקבל לקוח בחודש של יום ההולדת שלו?</p>
                                            <div className="flex items-center gap-3">
                                                <input
                                                    type="number"
                                                    value={settings.birthday_benefit_percent ?? 0}
                                                    onChange={e => handleChange("birthday_benefit_percent", parseInt(e.target.value) || 0)}
                                                    className="w-24 text-center bg-white border border-pink-200 rounded-xl px-4 py-3 font-semibold text-lg outline-none focus:ring-2 focus:ring-pink-500"
                                                    min="0" max="100"
                                                />
                                                <span className="text-pink-600 font-medium font-bold">אחוז הנחה (%)</span>
                                            </div>
                                        </div>

                                        <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 md:col-span-2">
                                            <label className="block text-base font-bold text-slate-800 mb-2">שעות פעילות הסטודיו ביומן</label>
                                            <p className="text-sm text-slate-500 mb-4">טווח השעות שיוצג ביומן התורים כדי לשמור על תצוגה נקייה.</p>
                                            <div className="flex items-center gap-6">
                                                <div className="flex items-center gap-3">
                                                    <span className="text-sm font-semibold text-slate-700">שעת פתיחה:</span>
                                                    <input
                                                        type="time"
                                                        value={settings.calendar_start_hour || "08:00"}
                                                        onChange={e => handleChange("calendar_start_hour", e.target.value)}
                                                        className="w-32 text-center bg-white border border-slate-200 rounded-xl px-4 py-2 font-semibold text-lg outline-none focus:ring-2 focus:ring-blue-500" dir="ltr"
                                                    />
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <span className="text-sm font-semibold text-slate-700">שעת סגירה:</span>
                                                    <input
                                                        type="time"
                                                        value={settings.calendar_end_hour || "23:00"}
                                                        onChange={e => handleChange("calendar_end_hour", e.target.value)}
                                                        className="w-32 text-center bg-white border border-slate-200 rounded-xl px-4 py-2 font-semibold text-lg outline-none focus:ring-2 focus:ring-blue-500" dir="ltr"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 5. FINANCE TAB */}
                        {activeTab === "finance" && (
                            <div className="bg-white rounded-2xl border border-slate-100 shadow-xl shadow-slate-200/40 p-6 md:p-10 relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-bl-full -z-10"></div>
                                <h3 className="text-2xl font-bold text-slate-800 mb-6">ניהול פיננסי ומיסוי</h3>
                                
                                <div className="grid md:grid-cols-2 gap-8">
                                    <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 md:col-span-2">
                                        <label className="block text-base font-bold text-slate-800 mb-2">הגדרות מיסוי 💰</label>
                                        <p className="text-sm text-slate-500 mb-4">הכנס את אחוזי המס שלך כדי שהדשבורד יציג לך כמה כסף באמת נשאר לך בכיס (נטו) אחרי הכל.</p>
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                                            <div className="space-y-2">
                                                <span className="text-sm font-semibold text-slate-700">מע״מ (%)</span>
                                                <input
                                                    type="number"
                                                    value={settings.vat_percent ?? 0}
                                                    onChange={e => handleChange("vat_percent", parseFloat(e.target.value) || 0)}
                                                    className="w-full text-center bg-white border border-slate-200 rounded-xl px-4 py-2 font-semibold text-lg outline-none focus:ring-2 focus:ring-emerald-500"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <span className="text-sm font-semibold text-slate-700">מס הכנסה (%)</span>
                                                <input
                                                    type="number"
                                                    value={settings.income_tax_percent ?? 0}
                                                    onChange={e => handleChange("income_tax_percent", parseFloat(e.target.value) || 0)}
                                                    className="w-full text-center bg-white border border-slate-200 rounded-xl px-4 py-2 font-semibold text-lg outline-none focus:ring-2 focus:ring-emerald-500"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <span className="text-sm font-semibold text-slate-700">ביטוח לאומי (%)</span>
                                                <input
                                                    type="number"
                                                    value={settings.social_security_percent ?? 0}
                                                    onChange={e => handleChange("social_security_percent", parseFloat(e.target.value) || 0)}
                                                    className="w-full text-center bg-white border border-slate-200 rounded-xl px-4 py-2 font-semibold text-lg outline-none focus:ring-2 focus:ring-emerald-500"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                                        <label className="block text-base font-bold text-slate-800 mb-2">קישורי תשלום מהירים (Bit/Paybox)</label>
                                        <p className="text-sm text-slate-500 mb-4">קישורים אלו יצורפו לחשבוניות ולהודעות התשלום שיישלחו ללקוחות.</p>
                                        <div className="space-y-4">
                                            <div className="space-y-1">
                                                <span className="text-xs font-bold text-slate-500 uppercase">לינק Bit</span>
                                                <input type="url" dir="ltr" value={settings.bit_link || ""} onChange={e => handleChange("bit_link", e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                                            </div>
                                            <div className="space-y-1">
                                                <span className="text-xs font-bold text-slate-500 uppercase">לינק Paybox</span>
                                                <input type="url" dir="ltr" value={settings.paybox_link || ""} onChange={e => handleChange("paybox_link", e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 6. INTEGRATIONS TAB */}
                        {activeTab === "integrations" && (
                            <div className="bg-white rounded-2xl border border-slate-100 shadow-xl shadow-slate-200/40 p-6 md:p-10">
                                <div className="mb-8">
                                    <h3 className="text-2xl font-bold text-slate-800 mb-2">חיבורים חיצוניים</h3>
                                    <p className="text-slate-500">כל חיבור מגיע עם אשף הגדרה אישי שמנחה אותך שלב אחרי שלב.</p>
                                </div>

                                <div className="flex flex-col gap-4">
                                    {[
                                        {
                                            icon: "💬",
                                            color: "bg-emerald-100",
                                            title: "WhatsApp",
                                            desc: "שלח הודעות אוטומטיות, תזכורות ועדכונים ללקוחות. לידים חדשים נוצרים אוטומטית.",
                                            connected: !!(settings.whatsapp_api_key),
                                            href: "/integrations/whatsapp",
                                            logo: null,
                                        },
                                        {
                                            icon: "✉️",
                                            color: "bg-indigo-100",
                                            title: "אימייל",
                                            desc: "שלח אישורי תור, תזכורות ועדכונים ללקוחות באימייל דרך Resend",
                                            connected: !!(settings.resend_api_key),
                                            href: "/integrations/email",
                                            logo: null,
                                        },
                                        {
                                            icon: "📸",
                                            color: "bg-gradient-to-br from-purple-100 to-pink-100",
                                            title: "Instagram",
                                            desc: "קבל לידים אוטומטית מהודעות DM ומפרסומות Lead Ads באינסטגרם",
                                            connected: !!(settings.instagram_account_id),
                                            href: "/integrations/meta",
                                            logo: null,
                                        },
                                        {
                                            icon: "👍",
                                            color: "bg-blue-100",
                                            title: "Facebook",
                                            desc: "קבל לידים אוטומטית מ-Messenger ומפרסומות Lead Ads בפייסבוק",
                                            connected: !!(settings.facebook_page_id),
                                            href: "/integrations/meta",
                                            logo: null,
                                        },
                                        {
                                            icon: "📅",
                                            color: "bg-sky-100",
                                            title: "Google Calendar",
                                            desc: "סנכרן תורים ופגישות ישירות ליומן Google שלך",
                                            connected: !!(settings.google_calendar_refresh_token),
                                            href: "/integrations/google-calendar",
                                            logo: null,
                                        },
                                    ].map(item => (
                                        <div key={item.href} className="flex items-center gap-5 p-5 rounded-2xl border-2 border-slate-100 hover:border-slate-200 bg-slate-50/50 transition-all">
                                            <div className={`w-14 h-14 rounded-2xl ${item.color} flex items-center justify-center text-3xl flex-shrink-0`}>
                                                {item.icon}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-3 mb-1">
                                                    <h4 className="font-bold text-slate-800 text-lg">{item.title}</h4>
                                                    {item.connected ? (
                                                        <span className="text-xs font-bold px-3 py-1 rounded-full bg-emerald-100 text-emerald-700">מחובר ✓</span>
                                                    ) : (
                                                        <span className="text-xs font-bold px-3 py-1 rounded-full bg-slate-200 text-slate-500">לא מחובר</span>
                                                    )}
                                                </div>
                                                <p className="text-sm text-slate-500">{item.desc}</p>
                                            </div>
                                            <Link href={item.href} className="flex-shrink-0 bg-slate-900 hover:bg-slate-700 text-white px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 whitespace-nowrap">
                                                {item.connected ? "ערוך הגדרות" : "הגדר עכשיו"} <span>←</span>
                                            </Link>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                    </div>
                </div>

                {/* 2FA Section */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mt-6">
                    <div className="flex items-center gap-3 mb-4">
                        <span className="text-2xl">🔐</span>
                        <div>
                            <h3 className="font-bold text-slate-800">אימות דו-שלבי (2FA)</h3>
                            <p className="text-sm text-slate-500">הגן על החשבון שלך עם קוד נוסף בכניסה</p>
                        </div>
                        <span className={`mr-auto text-xs font-semibold px-3 py-1 rounded-full ${totpEnabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                            {totpEnabled ? "מופעל ✓" : "כבוי"}
                        </span>
                    </div>

                    {totpMsg && (
                        <div className={`text-sm rounded-xl px-4 py-3 mb-4 ${totpMsg.startsWith("✓") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                            {totpMsg}
                        </div>
                    )}

                    {!totpEnabled && !totpSetupUri && (
                        <button
                            onClick={async () => {
                                setTotpLoading(true);
                                setTotpMsg(null);
                                try {
                                    const data = await apiFetch<{ secret: string; otpauth_uri: string }>("/api/auth/2fa/setup");
                                    setTotpSetupSecret(data.secret);
                                    setTotpSetupUri(data.otpauth_uri);
                                    const QRCode = (await import("qrcode")).default;
                                    setTotpQr(await QRCode.toDataURL(data.otpauth_uri));
                                } catch {
                                    setTotpMsg("שגיאה בטעינת ה-QR");
                                } finally {
                                    setTotpLoading(false);
                                }
                            }}
                            disabled={totpLoading}
                            className="bg-black text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-gray-800 disabled:opacity-50 transition"
                        >
                            {totpLoading ? "טוען..." : "הפעל אימות דו-שלבי"}
                        </button>
                    )}

                    {!totpEnabled && totpSetupUri && (
                        <div className="space-y-4">
                            <p className="text-sm text-slate-600">סרוק את ה-QR באפליקציית אימות (Google Authenticator / Authy):</p>
                            {totpQr && <img src={totpQr} alt="QR Code" className="w-44 h-44 rounded-xl border" />}
                            <p className="text-xs text-slate-400 font-mono break-all">או הכנס ידנית: <span className="font-bold text-slate-700">{totpSetupSecret}</span></p>
                            <div className="flex gap-3">
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={6}
                                    value={totpCode}
                                    onChange={e => setTotpCode(e.target.value.replace(/\D/g, ""))}
                                    placeholder="הכנס קוד 6 ספרות"
                                    dir="ltr"
                                    className="flex-1 border rounded-xl px-4 py-2 text-center font-mono text-lg tracking-widest outline-none focus:ring-2 focus:ring-black/20"
                                />
                                <button
                                    onClick={async () => {
                                        setTotpLoading(true);
                                        setTotpMsg(null);
                                        try {
                                            await apiFetch("/api/auth/2fa/enable", {
                                                method: "POST",
                                                body: JSON.stringify({ secret: totpSetupSecret, code: totpCode }),
                                            });
                                            setTotpEnabled(true);
                                            setTotpSetupUri(null);
                                            setTotpSetupSecret(null);
                                            setTotpQr(null);
                                            setTotpCode("");
                                            setTotpMsg("✓ אימות דו-שלבי הופעל בהצלחה");
                                        } catch (e: unknown) {
                                            setTotpMsg((e as Error)?.message || "קוד שגוי");
                                        } finally {
                                            setTotpLoading(false);
                                        }
                                    }}
                                    disabled={totpLoading || totpCode.length < 6}
                                    className="bg-black text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-gray-800 disabled:opacity-50 transition"
                                >
                                    {totpLoading ? "מאמת..." : "אמת והפעל"}
                                </button>
                            </div>
                        </div>
                    )}

                    {totpEnabled && (
                        <div className="space-y-3">
                            <p className="text-sm text-slate-600">להשבתה, הכנס קוד מאפליקציית האימות:</p>
                            <div className="flex gap-3">
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={6}
                                    value={totpCode}
                                    onChange={e => setTotpCode(e.target.value.replace(/\D/g, ""))}
                                    placeholder="קוד 6 ספרות"
                                    dir="ltr"
                                    className="flex-1 border rounded-xl px-4 py-2 text-center font-mono text-lg tracking-widest outline-none focus:ring-2 focus:ring-black/20"
                                />
                                <button
                                    onClick={async () => {
                                        setTotpLoading(true);
                                        setTotpMsg(null);
                                        try {
                                            await apiFetch("/api/auth/2fa/disable", {
                                                method: "POST",
                                                body: JSON.stringify({ code: totpCode }),
                                            });
                                            setTotpEnabled(false);
                                            setTotpCode("");
                                            setTotpMsg("✓ אימות דו-שלבי הושבת");
                                        } catch (e: unknown) {
                                            setTotpMsg((e as Error)?.message || "קוד שגוי");
                                        } finally {
                                            setTotpLoading(false);
                                        }
                                    }}
                                    disabled={totpLoading || totpCode.length < 6}
                                    className="border border-red-200 text-red-600 text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-red-50 disabled:opacity-50 transition"
                                >
                                    {totpLoading ? "..." : "השבת"}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Floating Save Button */}
                <div className="fixed bottom-10 left-1/2 transform -translate-x-1/2 z-40">
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className={`group relative overflow-hidden px-10 py-4 rounded-2xl font-bold text-white shadow-2xl transition-all duration-300 flex items-center gap-3 ${saving ? 'bg-slate-400 scale-95' : 'bg-slate-900 hover:bg-sky-700 hover:-translate-y-1 active:scale-95'
                            }`}
                    >
                        {saving && (
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        )}
                        <span className="relative z-10">{saving ? "שומר שינויים..." : "שמור הגדרות סטודיו"}</span>
                        {!saving && <span className="text-xl group-hover:translate-x-1 transition-transform">✨</span>}
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-shimmer"></div>
                    </button>
                </div>

            </AppShell>
        </RequireAuth>
    );
}
