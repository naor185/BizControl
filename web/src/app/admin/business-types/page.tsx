"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Plus, RefreshCw } from "lucide-react";
import { iconNames } from "lucide-react/dynamic";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import BusinessTypeIcon from "@/components/BusinessTypeIcon";

type BusinessType = {
    business_type: string;
    display_name: string;
    icon: string | null;
    color: string | null;
    sort_order: number | null;
    is_directory_only: boolean;
    is_active: boolean;
    aliases: string[];
    osm_tag: string | null;
    terms: Record<string, string>;
    message_defaults: Record<string, string>;
};
type OtherNote = { studio_id: string; name: string; note: string; created_at: string | null };
type WordChange = {
    business_type: string; type_label: string; term: string; term_label: string;
    field_word: string; owner_word: string; count: number; studios: string[];
};
// What the words and texts mean and their generic values — all from the server
type Meta = {
    changes: WordChange[];
    term_labels: Record<string, string>;
    generic_terms: Record<string, string>;
    message_keys: Record<string, string>;
    generic_messages: Record<string, string>;
};
type Draft = {
    display_name: string; icon: string; color: string; sort_order: string;
    is_directory_only: boolean; is_active: boolean; aliases: string; osm_tag: string;
    terms: Record<string, string>; aftercare: string;
};

const ICONS = new Set<string>(iconNames);
const inputCls = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-400";
const labelCls = "block text-xs font-semibold text-slate-600 mb-1";

function toDraft(t: BusinessType, meta: Meta): Draft {
    return {
        display_name: t.display_name, icon: t.icon || "store", color: t.color || "#475569",
        sort_order: t.sort_order == null ? "" : String(t.sort_order),
        is_directory_only: t.is_directory_only, is_active: t.is_active,
        aliases: (t.aliases || []).join(", "), osm_tag: t.osm_tag || "",
        terms: Object.fromEntries(Object.keys(meta.term_labels).map(k => [k, t.terms?.[k] || ""])),
        aftercare: t.message_defaults?.aftercare || "",
    };
}

function blankDraft(meta: Meta, name = ""): Draft {
    return {
        display_name: name, icon: "store", color: "#475569", sort_order: "", is_directory_only: false,
        is_active: true, aliases: name, osm_tag: "",
        terms: Object.fromEntries(Object.keys(meta.term_labels).map(k => [k, ""])), aftercare: "",
    };
}

function fromDraft(d: Draft) {
    return {
        display_name: d.display_name.trim(), icon: d.icon.trim(), color: d.color,
        sort_order: d.sort_order.trim() === "" ? null : Number(d.sort_order),
        is_directory_only: d.is_directory_only, is_active: d.is_active,
        aliases: d.aliases.split(",").map(a => a.trim()).filter(Boolean),
        osm_tag: d.osm_tag.trim() || null,
        terms: d.terms,                                   // an empty word goes back to the generic one
        message_defaults: { aftercare: d.aftercare },     // an empty text goes back to the generic one
    };
}

function Fields({ d, set, meta }: { d: Draft; set: (patch: Partial<Draft>) => void; meta: Meta }) {
    const iconOk = ICONS.has(d.icon.trim());
    return (
        <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
                <h3 className="text-sm font-bold text-slate-800">המילים של התחום</h3>
                <p className="text-xs text-slate-500">שדה ריק = המילה הכללית (מוצגת באפור). בעלי עסקים יכולים לשנות לעצמם.</p>
            </div>
            {Object.keys(meta.term_labels).map(k => (
                <div key={k}>
                    <label className={labelCls}>{meta.term_labels[k]}</label>
                    <input className={inputCls} value={d.terms[k] ?? ""} placeholder={meta.generic_terms[k]} maxLength={30}
                        onChange={e => set({ terms: { ...d.terms, [k]: e.target.value } })} />
                </div>
            ))}
            <div className="sm:col-span-2">
                <label className={labelCls}>נוסח ברירת מחדל: {meta.message_keys.aftercare} (ריק = הנוסח הכללי, בלי הוראות טיפול)</label>
                <textarea className={inputCls + " min-h-28"} value={d.aftercare} placeholder={meta.generic_messages.aftercare}
                    maxLength={2000} onChange={e => set({ aftercare: e.target.value })} />
            </div>
            <div className="sm:col-span-2 border-t border-slate-100 pt-3">
                <h3 className="text-sm font-bold text-slate-800">הצגה וזיהוי</h3>
            </div>
            <div>
                <label className={labelCls}>שם התחום</label>
                <input className={inputCls} value={d.display_name} onChange={e => set({ display_name: e.target.value })} maxLength={128} />
            </div>
            <div>
                <label className={labelCls}>אייקון (שם ב-Lucide, למשל scissors)</label>
                <div className="flex items-center gap-2">
                    <span className="grid place-items-center h-9 w-9 shrink-0 rounded-lg border border-slate-200 bg-slate-50">
                        <BusinessTypeIcon name={d.icon.trim()} size={18} color={d.color} />
                    </span>
                    <input className={inputCls} dir="ltr" value={d.icon} onChange={e => set({ icon: e.target.value })} />
                </div>
                {!iconOk && <p className="text-xs text-rose-600 mt-1">אין אייקון בשם הזה ב-Lucide</p>}
            </div>
            <div>
                <label className={labelCls}>צבע</label>
                <div className="flex items-center gap-2">
                    <input type="color" className="h-9 w-12 rounded border border-slate-300" value={d.color} onChange={e => set({ color: e.target.value })} />
                    <input className={inputCls} dir="ltr" value={d.color} onChange={e => set({ color: e.target.value })} />
                </div>
            </div>
            <div>
                <label className={labelCls}>תגית OpenStreetMap לייבוא ל-BizFind</label>
                <input className={inputCls} dir="ltr" placeholder="shop=hairdresser" value={d.osm_tag} onChange={e => set({ osm_tag: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
                <label className={labelCls}>שמות נוספים שהמערכת מזהה כתחום הזה (מופרדים בפסיק)</label>
                <input className={inputCls} value={d.aliases} onChange={e => set({ aliases: e.target.value })} />
            </div>
            <div>
                <label className={labelCls}>מיקום ברשימה (מספר קטן = למעלה)</label>
                <input className={inputCls} dir="ltr" inputMode="numeric" value={d.sort_order} onChange={e => set({ sort_order: e.target.value.replace(/[^\d]/g, "") })} />
            </div>
            <div className="flex flex-col justify-end gap-2 text-sm text-slate-700">
                <label className="inline-flex items-center gap-2">
                    <input type="checkbox" checked={d.is_directory_only} onChange={e => set({ is_directory_only: e.target.checked })} />
                    רק אינדקס ב-BizFind (עסק בלי תורים)
                </label>
                <label className="inline-flex items-center gap-2">
                    <input type="checkbox" checked={d.is_active} onChange={e => set({ is_active: e.target.checked })} />
                    פעיל — מופיע בהרשמה ובחיפוש
                </label>
            </div>
        </div>
    );
}

// Super Admin: the one list of business types (תחומי עסק). Every signup, BizFind screen and import
// reads it, so a type added or changed here needs no code.
export default function AdminBusinessTypesPage() {
    const [types, setTypes] = useState<BusinessType[] | null>(null);
    const [notes, setNotes] = useState<OtherNote[]>([]);
    const [meta, setMeta] = useState<Meta | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<string | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [newKey, setNewKey] = useState("");
    const [newDraft, setNewDraft] = useState<Draft | null>(null);
    const [saving, setSaving] = useState(false);

    const load = useCallback(() => {
        Promise.all([
            apiFetch<BusinessType[]>("/api/admin/business-types"),
            apiFetch<OtherNote[]>("/api/admin/business-types/other-notes"),
            apiFetch<Meta>("/api/admin/business-types/word-changes"),
        ])
            .then(([t, n, m]) => { setTypes(t); setNotes(n); setMeta(m); setError(null); })
            .catch(e => setError(e instanceof Error ? e.message : "הטעינה נכשלה"));
    }, []);

    useEffect(() => { load(); }, [load]);

    async function save(key: string) {
        if (!draft) return;
        setSaving(true);
        try {
            await apiFetch(`/api/admin/business-types/${key}`, { method: "PATCH", body: JSON.stringify(fromDraft(draft)) });
            toast.success("נשמר");
            setEditing(null);
            load();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "השמירה נכשלה");
        } finally {
            setSaving(false);
        }
    }

    async function promote(c: WordChange) {
        if (!window.confirm(`להפוך את "${c.owner_word}" למילה של כל עסקי ${c.type_label}?`)) return;
        setSaving(true);
        try {
            await apiFetch(`/api/admin/business-types/${c.business_type}`, {
                method: "PATCH", body: JSON.stringify({ terms: { [c.term]: c.owner_word } }),
            });
            toast.success("עודכן לכל התחום");
            load();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "העדכון נכשל");
        } finally {
            setSaving(false);
        }
    }

    async function create() {
        if (!newDraft) return;
        setSaving(true);
        try {
            await apiFetch("/api/admin/business-types", {
                method: "POST",
                body: JSON.stringify({ business_type: newKey.trim(), ...fromDraft(newDraft) }),
            });
            toast.success("התחום נוסף");
            setNewDraft(null);
            setNewKey("");
            load();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "ההוספה נכשלה");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="max-w-5xl mx-auto py-8 px-4 space-y-8" dir="rtl">
            <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
                <ArrowRight className="h-4 w-4" /> חזרה לאדמין
            </Link>

            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-black text-slate-900">תחומי עסק</h1>
                    <p className="text-slate-500 text-sm mt-1">הרשימה היחידה של התחומים. ההרשמה ל-BizControl ול-BizFind, החיפוש, המפה והייבוא קוראים ממנה.</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={load} className="px-4 py-2 text-sm font-bold bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center gap-2 text-slate-700">
                        <RefreshCw className="h-4 w-4" /> רענן
                    </button>
                    <button
                        onClick={() => meta && setNewDraft(blankDraft(meta))}
                        className="px-4 py-2 text-sm font-bold bg-violet-600 hover:bg-violet-700 text-white rounded-xl flex items-center gap-2"
                    >
                        <Plus className="h-4 w-4" /> תחום חדש
                    </button>
                </div>
            </div>

            {error && <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3">{error}</div>}

            {newDraft && (
                <section className="bg-white rounded-2xl border border-violet-200 p-5 space-y-4">
                    <h2 className="font-bold text-slate-900">תחום חדש</h2>
                    <div className="sm:w-1/2">
                        <label className={labelCls}>מזהה באנגלית (אותיות קטנות, ספרות וקו תחתון — לא ניתן לשנות אחר כך)</label>
                        <input className={inputCls} dir="ltr" placeholder="yoga_studio" value={newKey} onChange={e => setNewKey(e.target.value.toLowerCase())} />
                    </div>
                    {meta && <Fields d={newDraft} set={p => setNewDraft({ ...newDraft, ...p })} meta={meta} />}
                    <div className="flex gap-2">
                        <button disabled={saving} onClick={create} className="px-4 py-2 text-sm font-bold bg-violet-600 hover:bg-violet-700 text-white rounded-xl disabled:opacity-50">הוסף</button>
                        <button onClick={() => setNewDraft(null)} className="px-4 py-2 text-sm font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl">ביטול</button>
                    </div>
                </section>
            )}

            {types && (
                <section className="space-y-2">
                    {types.map(t => (
                        <div key={t.business_type} className={`bg-white rounded-2xl border p-4 ${t.is_active ? "border-slate-200" : "border-dashed border-slate-300 opacity-70"}`}>
                            <div className="flex items-center gap-3">
                                <span className="grid place-items-center h-10 w-10 shrink-0 rounded-xl" style={{ background: `${t.color || "#475569"}1a` }}>
                                    <BusinessTypeIcon name={t.icon} size={20} color={t.color || "#475569"} />
                                </span>
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-slate-900">
                                        {t.display_name}
                                        {t.is_directory_only && <span className="mr-2 text-[11px] font-semibold text-sky-700 bg-sky-50 border border-sky-200 rounded-md px-1.5 py-0.5">אינדקס בלבד</span>}
                                        {!t.is_active && <span className="mr-2 text-[11px] font-semibold text-slate-600 bg-slate-100 rounded-md px-1.5 py-0.5">כבוי</span>}
                                    </div>
                                    <div className="text-xs text-slate-500 truncate">
                                        <span className="font-mono" dir="ltr">{t.business_type}</span>
                                        {t.osm_tag && <> · OSM <span className="font-mono" dir="ltr">{t.osm_tag}</span></>}
                                        {t.aliases?.length > 0 && <> · מזהה גם: {t.aliases.join(", ")}</>}
                                    </div>
                                </div>
                                {editing !== t.business_type && (
                                    <button
                                        onClick={() => { if (meta) { setEditing(t.business_type); setDraft(toDraft(t, meta)); } }}
                                        className="px-3 py-1.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg"
                                    >
                                        עריכה
                                    </button>
                                )}
                            </div>
                            {editing === t.business_type && draft && (
                                <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                                    {meta && <Fields d={draft} set={p => setDraft({ ...draft, ...p })} meta={meta} />}
                                    <div className="flex gap-2">
                                        <button disabled={saving} onClick={() => save(t.business_type)} className="px-4 py-2 text-sm font-bold bg-violet-600 hover:bg-violet-700 text-white rounded-xl disabled:opacity-50">שמירה</button>
                                        <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl">ביטול</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </section>
            )}

            <section className="space-y-3">
                <h2 className="font-bold text-slate-800">מילים ששינו בעלי עסקים</h2>
                <p className="text-slate-500 text-sm">כשכמה עסקים מאותו תחום משנים מילה באותה צורה — כנראה שזו המילה הנכונה לתחום.</p>
                {!meta || meta.changes.length === 0 ? (
                    <div className="text-sm text-slate-400">אין עדיין.</div>
                ) : (
                    <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
                        {meta.changes.map(c => (
                            <div key={`${c.business_type}-${c.term}-${c.owner_word}`} className="px-4 py-3 flex items-center justify-between gap-3 text-sm flex-wrap">
                                <div className="min-w-0">
                                    <div className="font-semibold text-slate-900">
                                        {c.type_label} · {c.term_label}: <span className="text-slate-400 line-through">{c.field_word}</span> ← {c.owner_word}
                                    </div>
                                    <div className="text-xs text-slate-500 truncate">{c.count} עסקים: {c.studios.join(", ")}</div>
                                </div>
                                <button
                                    onClick={() => promote(c)}
                                    disabled={saving}
                                    className="shrink-0 px-3 py-1.5 text-xs font-bold bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50"
                                >
                                    להפוך לברירת המחדל של התחום
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <section className="space-y-3">
                <h2 className="font-bold text-slate-800">עסקים שבחרו &quot;אחר&quot; — מה כתבו</h2>
                <p className="text-slate-500 text-sm">מה שבעלי עסקים כתבו כשאף תחום לא התאים. כך רואים איזה תחום כדאי להוסיף.</p>
                {notes.length === 0 ? (
                    <div className="text-sm text-slate-400">אין עדיין.</div>
                ) : (
                    <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
                        {notes.map(n => (
                            <div key={n.studio_id} className="px-4 py-3 flex items-center justify-between gap-3 text-sm">
                                <span className="font-semibold text-slate-900">{n.note}</span>
                                <span className="flex items-center gap-3 min-w-0">
                                    <span className="text-slate-500 truncate">{n.name}{n.created_at ? ` · ${new Date(n.created_at).toLocaleDateString("he-IL")}` : ""}</span>
                                    <button
                                        onClick={() => { if (meta) { setNewKey(""); setNewDraft(blankDraft(meta, n.note)); window.scrollTo({ top: 0, behavior: "smooth" }); } }}
                                        className="shrink-0 px-3 py-1.5 text-xs font-bold bg-violet-50 hover:bg-violet-100 text-violet-700 rounded-lg"
                                    >
                                        צור תחום מזה
                                    </button>
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
