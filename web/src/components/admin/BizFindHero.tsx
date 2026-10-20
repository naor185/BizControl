"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, MapPin, Trash2 } from "lucide-react";
import { apiFetch, API_BASE, getToken } from "@/lib/api";
import { toast } from "@/lib/toast";

import { tx } from "@/lib/i18n";
// BizFind's home page HERO — its words (app/services/bizfind_theme.py; empty = the words it always had) and its
// pictures (hero_slides). In the superadmin's "הגדרות BizFind" (owner, 2026-10-13: "the HERO's settings too").

type Words = { hero_badge: string | null; hero_title_dim: string | null; hero_title: string | null; hero_subtitle: string | null };
type Slide = { id: string; url: string; label: string; sort_order: number; is_active: boolean };
const KEYS: { key: keyof Words; label: string }[] = [
    { key: "hero_badge", label: tx("התגית הקטנה למעלה") },
    { key: "hero_title_dim", label: tx("שורה ראשונה בכותרת (בהירה)") },
    { key: "hero_title", label: tx("שורה שנייה בכותרת") },
    { key: "hero_subtitle", label: tx("משפט מתחת לכותרת") },
];
const EMPTY: Words = { hero_badge: null, hero_title_dim: null, hero_title: null, hero_subtitle: null };
const src = (url: string) => (url.startsWith("/") ? `${API_BASE}${url}` : url);
const field = "w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-emerald-500";

export default function BizFindHero() {
    const [words, setWords] = useState<Words>(EMPTY);
    const [defaults, setDefaults] = useState<Words>(EMPTY);
    const [saving, setSaving] = useState(false);
    const [slides, setSlides] = useState<Slide[]>([]);
    const [label, setLabel] = useState("");
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const loadSlides = useCallback(() => {
        apiFetch<Slide[]>("/api/admin/hero-slides").then(s => setSlides([...s].sort((a, b) => a.sort_order - b.sort_order))).catch(() => {});
    }, []);

    useEffect(() => {
        apiFetch<{ bizfind_theme: Words; bizfind_hero_defaults: Words }>("/api/admin/platform-settings")
            .then(s => {
                setWords(Object.fromEntries(KEYS.map(k => [k.key, s.bizfind_theme?.[k.key] ?? null])) as Words);
                setDefaults({ ...EMPTY, ...(s.bizfind_hero_defaults || {}) });
            })
            .catch(() => {});
        loadSlides();
    }, [loadSlides]);

    const saveWords = async () => {
        setSaving(true);
        try {
            await apiFetch("/api/admin/platform-settings", { method: "PATCH", body: JSON.stringify({
                bizfind_theme: Object.fromEntries(KEYS.map(k => [k.key, words[k.key] ?? ""])) }) });
            toast.success(tx("הטקסטים של ה-HERO נשמרו"));
        } catch (e) {
            toast.error((e as Error)?.message || tx("שגיאה בשמירה"));
        } finally {
            setSaving(false);
        }
    };

    const upload = async () => {
        const file = fileRef.current?.files?.[0];
        if (!file) { toast.error(tx("בחרו תמונה")); return; }
        setUploading(true);
        try {
            const form = new FormData();
            form.append("file", file);
            form.append("label", label);
            form.append("sort_order", String(slides.length));
            const token = getToken();
            const res = await fetch(`${API_BASE}/api/admin/hero-slides`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || tx("שגיאה בהעלאה"));
            setLabel("");
            if (fileRef.current) fileRef.current.value = "";
            loadSlides();
            toast.success(tx("התמונה נוספה"));
        } catch (e) {
            toast.error((e as Error)?.message || tx("שגיאה בהעלאה"));
        } finally {
            setUploading(false);
        }
    };

    const patchSlide = async (s: Slide, body: Partial<Slide>) => {
        try {
            await apiFetch(`/api/admin/hero-slides/${s.id}`, { method: "PATCH", body: JSON.stringify(body) });
            loadSlides();
        } catch (e) {
            toast.error((e as Error)?.message || tx("שגיאה בעדכון"));
        }
    };

    const removeSlide = async (s: Slide) => {
        if (!confirm(tx("למחוק את התמונה?"))) return;
        try {
            await apiFetch(`/api/admin/hero-slides/${s.id}`, { method: "DELETE" });
            loadSlides();
        } catch (e) {
            toast.error((e as Error)?.message || tx("שגיאה במחיקה"));
        }
    };

    const shown = (k: keyof Words) => words[k] || defaults[k] || "";
    const first = slides.find(s => s.is_active);
    return (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-5">
            <div>
                <h2 className="text-lg font-bold">{tx("דף הבית — HERO")}</h2>
                <p className="text-slate-400 text-sm mt-0.5">{tx("החלק העליון של דף הבית ב-BizFind: התמונות שמתחלפות והטקסטים שעליהן. שדה ריק = הטקסט הקבוע.")}</p>
            </div>

            {/* the words */}
            <div className="grid sm:grid-cols-2 gap-3">
                {KEYS.map(k => (
                    <label key={k.key} className={`block text-xs font-semibold text-slate-400 ${k.key === "hero_subtitle" ? "sm:col-span-2" : ""}`}>
                        {k.label}
                        <input value={words[k.key] ?? ""} onChange={e => setWords(w => ({ ...w, [k.key]: e.target.value }))}
                            placeholder={defaults[k.key] ?? ""} maxLength={160} className={`${field} mt-1.5`} />
                    </label>
                ))}
            </div>

            {/* a preview, on the first picture */}
            <div className="relative rounded-2xl overflow-hidden h-56 flex flex-col items-center justify-center text-center px-4 bg-slate-900">
                {first && <img src={src(first.url)} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,.45), rgba(0,0,0,.6))" }} />
                <div className="relative space-y-2">
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-white rounded-full px-3 py-1 border border-white/30 bg-white/10"><MapPin className="w-3 h-3" aria-hidden /> {shown("hero_badge")}</span>
                    <div className="text-2xl font-black text-white leading-tight"><span className="text-white/70">{shown("hero_title_dim")}</span><br />{shown("hero_title")}</div>
                    <div className="text-xs text-white/85">{shown("hero_subtitle")}</div>
                </div>
            </div>
            <button type="button" onClick={saveWords} disabled={saving}
                className="w-full py-2.5 rounded-xl font-bold text-sm bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-60">
                {saving ? tx("שומר...") : tx("שמירת הטקסטים")}
            </button>

            {/* the pictures */}
            <div className="space-y-3 pt-2 border-t border-white/10">
                <div className="text-sm font-bold text-slate-200 pt-3">{tx("התמונות (")}{slides.filter(s => s.is_active).length}{tx(" פעילות)")}</div>
                <div className="flex flex-wrap gap-2 items-end">
                    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label={tx("תמונה חדשה")}
                        className="flex-1 min-w-48 text-xs text-slate-300 file:ms-0 file:me-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-slate-200" />
                    <input value={label} onChange={e => setLabel(e.target.value)} placeholder={tx("כיתוב (למשל: ספא וטיפולים)")} aria-label={tx("כיתוב לתמונה")}
                        className={`${field} flex-1 min-w-40`} />
                    <button type="button" onClick={upload} disabled={uploading}
                        className="px-4 py-2 rounded-xl text-sm font-bold bg-white/10 hover:bg-white/15 text-white flex items-center gap-1.5 disabled:opacity-60">
                        <ImagePlus className="w-4 h-4" aria-hidden /> {uploading ? tx("מעלה...") : tx("הוספה")}
                    </button>
                </div>
                {slides.length === 0 && <p className="text-sm text-slate-400">{tx("אין תמונות משלך — דף הבית מציג תמונות ברירת מחדל.")}</p>}
                <ul className="space-y-2">
                    {slides.map((s, i) => (
                        <li key={s.id} className={`flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-2 ${s.is_active ? "" : "opacity-50"}`}>
                            <img src={src(s.url)} alt={s.label} className="w-24 h-14 object-cover rounded-lg shrink-0" />
                            <input defaultValue={s.label} onBlur={e => e.target.value !== s.label && patchSlide(s, { label: e.target.value })}
                                aria-label={tx("כיתוב")} className={`${field} flex-1 min-w-0`} />
                            <div className="flex flex-col gap-1 shrink-0">
                                <button type="button" aria-label={tx("למעלה")} disabled={i === 0} onClick={() => patchSlide(s, { sort_order: slides[i - 1].sort_order - 1 })}
                                    className="p-1 rounded-md bg-white/10 disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
                                <button type="button" aria-label={tx("למטה")} disabled={i === slides.length - 1} onClick={() => patchSlide(s, { sort_order: slides[i + 1].sort_order + 1 })}
                                    className="p-1 rounded-md bg-white/10 disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
                            </div>
                            <button type="button" onClick={() => patchSlide(s, { is_active: !s.is_active })}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 ${s.is_active ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-slate-400"}`}>
                                {s.is_active ? tx("פעילה") : tx("מושבתת")}
                            </button>
                            <button type="button" aria-label={tx("מחיקה")} onClick={() => removeSlide(s)} className="p-2 rounded-lg text-rose-300 hover:bg-rose-500/10 shrink-0">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
