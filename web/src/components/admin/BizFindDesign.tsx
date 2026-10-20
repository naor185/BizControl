"use client";

import { useEffect, useMemo, useState } from "react";
import { Palette, RotateCcw, TriangleAlert, Star } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";

import { tx } from "@/lib/i18n";
// BizFind's own look — apart from BizControl's (app/services/bizfind_theme.py; owner, 2026-10-13: "everything for
// BizFind and everything for BizControl separately"). An empty field keeps BizFind's default black and white.

type Theme = { background: string | null; cards: string | null; text: string | null; text_muted: string | null;
    buttons: string | null; heading_font: string | null; body_font: string | null };
const EMPTY: Theme = { background: null, cards: null, text: null, text_muted: null, buttons: null, heading_font: null, body_font: null };
const FONTS = ["Heebo", "Assistant", "Rubik", "M PLUS Rounded 1c", "Varela Round"];
const COLORS: { key: keyof Theme; label: string; fallback: string }[] = [
    { key: "background", label: tx("רקע"), fallback: "#000000" },
    { key: "cards", label: tx("כרטיסים"), fallback: "#0f0f0f" },
    { key: "text", label: tx("טקסט"), fallback: "#ffffff" },
    { key: "text_muted", label: tx("טקסט משני"), fallback: "#adadad" },
    { key: "buttons", label: tx("כפתורים"), fallback: "#ffffff" },
];

const channels = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const luminance = (hex: string) => {
    const [r, g, b] = channels(hex).map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

export default function BizFindDesign() {
    const [theme, setTheme] = useState<Theme>(EMPTY);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        apiFetch<{ bizfind_theme: Theme }>("/api/admin/platform-settings")
            .then(s => setTheme({ ...EMPTY, ...(s.bizfind_theme || {}) }))
            .catch(() => {});
    }, []);

    const eff = useMemo(() => Object.fromEntries(COLORS.map(c => [c.key, theme[c.key] || c.fallback])) as Record<string, string>, [theme]);
    const warnings = useMemo(() => {
        const w: string[] = [];
        if (contrast(eff.text, eff.background) < 4.5) w.push(tx("הטקסט לא קריא מספיק על הרקע"));
        if (contrast(eff.text, eff.cards) < 4.5) w.push(tx("הטקסט לא קריא מספיק על הכרטיסים"));
        if (contrast(eff.text_muted, eff.background) < 3) w.push(tx("הטקסט המשני חלש מדי על הרקע"));
        if (contrast(eff.buttons, eff.background) < 1.5) w.push(tx("הכפתורים כמעט לא נראים על הרקע"));
        return w;
    }, [eff]);

    const save = async (next: Theme) => {
        setSaving(true);
        try {
            const body = Object.fromEntries(Object.entries(next).map(([k, v]) => [k, v ?? ""]));   // "" — back to the default
            const s = await apiFetch<{ bizfind_theme: Theme }>("/api/admin/platform-settings", { method: "PATCH", body: JSON.stringify({ bizfind_theme: body }) });
            setTheme({ ...EMPTY, ...(s.bizfind_theme || {}) });
            toast.success(tx("העיצוב של BizFind נשמר — יופיע אצל הלקוחות בטעינה הבאה"));
        } catch (e) {
            toast.error((e as Error)?.message || tx("שגיאה בשמירה"));
        } finally {
            setSaving(false);
        }
    };

    const onButton = luminance(eff.buttons) > 0.4 ? "#000000" : "#ffffff";
    const cardBg = theme.cards || `rgba(${channels(eff.text).join(",")},.06)`;
    return (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-5">
            <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center"><Palette className="w-6 h-6 text-emerald-300" aria-hidden /></div>
                <div>
                    <h2 className="text-lg font-bold">{tx("עיצוב BizFind")}</h2>
                    <p className="text-slate-400 text-sm mt-0.5">{tx("חל רק על BizFind — האתר והאפליקציה של הלקוחות. שדה ריק נשאר בשחור-לבן של היום.")}</p>
                </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {COLORS.map(c => (
                    <div key={c.key} className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <label htmlFor={`bf-${c.key}`} className="text-xs text-slate-400">{c.label}</label>
                            {theme[c.key] && (
                                <button type="button" onClick={() => setTheme(t => ({ ...t, [c.key]: null }))} className="text-[11px] text-slate-500 hover:text-slate-300">{tx("ברירת מחדל")}</button>
                            )}
                        </div>
                        <div className="flex items-center gap-2 bg-black/30 border border-white/10 rounded-xl p-1.5">
                            <input id={`bf-${c.key}`} type="color" value={eff[c.key]} onChange={e => setTheme(t => ({ ...t, [c.key]: e.target.value }))}
                                className="h-8 w-9 rounded cursor-pointer border-0 p-0 bg-transparent shrink-0" />
                            <span dir="ltr" className="text-xs font-mono text-slate-300 uppercase">{theme[c.key] || tx("ברירת מחדל")}</span>
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
                {(["heading_font", "body_font"] as const).map(k => (
                    <div key={k} className="space-y-1.5">
                        <label htmlFor={`bf-${k}`} className="text-xs text-slate-400 block">{k === "heading_font" ? tx("פונט כותרות") : tx("פונט גוף טקסט")}</label>
                        <select id={`bf-${k}`} value={theme[k] || ""} onChange={e => setTheme(t => ({ ...t, [k]: e.target.value || null }))}
                            className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none" style={{ colorScheme: "dark" }}>
                            <option value="">{tx("ברירת מחדל (")}{k === "heading_font" ? "Heebo" : "Assistant"})</option>
                            {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                    </div>
                ))}
            </div>

            {/* A business page on BizFind, in these colors — before saving */}
            <div>
                <div className="text-xs text-slate-400 mb-2">{tx("תצוגה מקדימה — דף עסק ב-BizFind")}</div>
                <div className="rounded-2xl overflow-hidden border border-white/10 p-4 space-y-3" style={{ background: eff.background, color: eff.text, fontFamily: `"${theme.body_font || "Assistant"}", sans-serif` }}>
                    <div className="text-lg font-black" style={{ fontFamily: `"${theme.heading_font || "Heebo"}", sans-serif` }}>{tx("סטודיו לדוגמה")}</div>
                    <div className="text-xs flex items-center gap-1" style={{ color: eff.text_muted }}><Star className="w-3.5 h-3.5" aria-hidden />{tx(" 4.9 · קעקועים · תל אביב")}</div>
                    <div className="rounded-xl p-3 text-sm" style={{ background: cardBg, border: `1px solid rgba(${channels(eff.text).join(",")},.14)` }}>
                        <div className="font-bold">{tx("קעקוע קטן")}</div>
                        <div className="text-xs mt-0.5" style={{ color: eff.text_muted }}>{tx("שעה · ₪350")}</div>
                    </div>
                    <div className="flex gap-2">
                        <span className="px-4 py-2 rounded-xl text-sm font-extrabold" style={{ background: eff.buttons, color: onButton }}>{tx("קביעת תור")}</span>
                        <span className="px-4 py-2 rounded-xl text-sm font-bold" style={{ background: cardBg, border: `1px solid rgba(${channels(eff.text).join(",")},.14)` }}>{tx("וואטסאפ")}</span>
                    </div>
                </div>
            </div>

            {warnings.length > 0 && (
                <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-900/20 px-4 py-3 text-sm text-amber-200">
                    <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
                    <div>{warnings.map(w => <div key={w}>{w}</div>)}</div>
                </div>
            )}

            <div className="flex gap-2">
                <button type="button" onClick={() => save(theme)} disabled={saving}
                    className="flex-1 py-3 rounded-xl font-bold text-sm bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-60">
                    {saving ? tx("שומר...") : tx("שמירת העיצוב של BizFind")}
                </button>
                <button type="button" onClick={() => save(EMPTY)} disabled={saving}
                    className="px-4 py-3 rounded-xl text-sm font-bold border border-white/15 text-slate-300 hover:bg-white/5 flex items-center gap-1.5">
                    <RotateCcw className="w-4 h-4" aria-hidden /> {tx("חזרה לשחור-לבן")}
                </button>
            </div>
        </div>
    );
}
