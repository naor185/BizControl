"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import PasswordInput from "@/components/PasswordInput";

import { tx } from "@/lib/i18n";
// Changing one's own password (POST /api/auth/change-password) — the superadmin's (dark) and a business owner's in
// "החשבון שלי" (light; until 2026-10-14 an owner could only change it through "forgot password").

export default function ChangePasswordForm({ tone = "light" }: { tone?: "light" | "dark" }) {
    const [cur, setCur] = useState("");
    const [next, setNext] = useState("");
    const [conf, setConf] = useState("");
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
    const dark = tone === "dark";

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (next !== conf) { setMsg({ ok: false, text: tx("הסיסמאות החדשות לא תואמות") }); return; }
        if (next.length < 6) { setMsg({ ok: false, text: tx("סיסמה חייבת להכיל לפחות 6 תווים") }); return; }
        setSaving(true); setMsg(null);
        try {
            await apiFetch("/api/auth/change-password", { method: "POST", body: JSON.stringify({ current_password: cur, new_password: next }) });
            setMsg({ ok: true, text: tx("הסיסמה שונתה") });
            setCur(""); setNext(""); setConf("");
        } catch (err: unknown) {
            setMsg({ ok: false, text: (err as Error)?.message || tx("שגיאה בשינוי הסיסמה") });
        } finally { setSaving(false); }
    };

    const input = dark
        ? "w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500"
        : "w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 outline-none focus:ring-2 focus:ring-sky-500";
    const icon = dark ? "text-white/70 hover:text-white" : "text-slate-400 hover:text-slate-600";
    return (
        <form onSubmit={handleSubmit} className="space-y-3">
            <PasswordInput placeholder={tx("סיסמה נוכחית")} autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} required iconClassName={icon} className={input} />
            <PasswordInput placeholder={tx("סיסמה חדשה")} autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} required iconClassName={icon} className={input} />
            <PasswordInput placeholder={tx("אימות סיסמה חדשה")} autoComplete="new-password" value={conf} onChange={e => setConf(e.target.value)} required iconClassName={icon} className={input} />
            {msg && (
                <div role="status" className={`text-sm px-4 py-2.5 rounded-xl ${msg.ok
                    ? (dark ? "bg-green-900/40 text-green-300" : "bg-emerald-50 text-emerald-700")
                    : (dark ? "bg-red-900/40 text-red-300" : "bg-red-50 text-red-700")}`}>{msg.text}</div>
            )}
            <button type="submit" disabled={saving}
                className={`px-5 py-2.5 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-40 ${dark ? "bg-indigo-600 hover:bg-indigo-500" : "bg-slate-900 hover:bg-slate-700"}`}>
                {saving ? tx("שומר...") : tx("שינוי הסיסמה")}
            </button>
        </form>
    );
}
