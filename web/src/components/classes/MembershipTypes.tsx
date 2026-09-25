"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, PencilLine, Loader2, Settings2, ChevronDown } from "lucide-react";
import BottomSheet from "@/components/ui/bottom-sheet";
import PenaltyRules from "@/components/classes/PenaltyRules";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import { type ClassTemplate, type MembershipKind, type MembershipType, shekels } from "@/lib/classes";

// What the business sells: unlimited for a period, a weekly limit for a period, or a punch card. Editing
// a type does not change memberships already sold (each keeps the rules it was sold with).

const KINDS: { value: MembershipKind; label: string; hint: string }[] = [
    { value: "unlimited", label: "ללא הגבלה", hint: "כניסות בלי הגבלה לתקופה" },
    { value: "weekly", label: "מגבלה שבועית", hint: "מספר כניסות קבוע בכל שבוע, לתקופה" },
    { value: "punch", label: "כרטיסייה", hint: "מספר כניסות, בתוקף עד מספר ימים" },
];

export function describeType(t: Pick<MembershipType, "kind" | "entries" | "duration_days" | "price_cents">): string {
    const parts = [
        t.kind === "punch" ? `${t.entries} כניסות` : t.kind === "weekly" ? `${t.entries} בשבוע` : "ללא הגבלה",
        t.duration_days ? `${t.duration_days} ימים` : "ללא תאריך סיום",
        t.price_cents ? shekels(t.price_cents) : null,
    ];
    return parts.filter(Boolean).join(" · ");
}

export default function MembershipTypes({ canConfigure }: { canConfigure: boolean }) {
    const [types, setTypes] = useState<MembershipType[] | null>(null);
    const [templates, setTemplates] = useState<ClassTemplate[]>([]);
    const [editing, setEditing] = useState<MembershipType | "new" | null>(null);

    const load = useCallback(() => apiFetch<MembershipType[]>("/api/classes/membership-types").then(setTypes).catch(() => setTypes([])), []);
    useEffect(() => {
        load();
        apiFetch<ClassTemplate[]>("/api/classes/templates").then(setTemplates).catch(() => setTemplates([]));
    }, [load]);

    return (
        <div className="space-y-3">
            {canConfigure && (
                <button type="button" onClick={() => setEditing("new")}
                    className="inline-flex items-center gap-2 min-h-11 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold">
                    <Plus className="w-4 h-4" aria-hidden /> סוג מנוי חדש
                </button>
            )}
            {types === null ? <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" aria-label="טוען" /> : types.length === 0 ? (
                <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-2xl px-5 py-8 text-center">
                    עוד אין סוגי מנוי. למשל: חודשי ללא הגבלה, פעמיים בשבוע, כרטיסייה של 10 כניסות.
                </p>
            ) : (
                <ul className="grid gap-3 md:grid-cols-2">
                    {types.map(t => (
                        <li key={t.id} className={`rounded-2xl border bg-white p-4 flex items-start justify-between gap-3 ${t.is_active ? "border-slate-200/70" : "border-slate-200 opacity-60"}`}>
                            <div className="min-w-0">
                                <p className="text-base font-bold text-slate-900 truncate">{t.name}</p>
                                <p className="text-xs text-indigo-800 mt-0.5">{t.kind_label}</p>
                                <p className="text-sm text-slate-600 mt-1 tabular-nums">{describeType(t)}</p>
                                {!t.covers_all && <p className="text-xs text-slate-500 mt-0.5">רק שיעורים נבחרים ({t.covered_templates.length})</p>}
                                {!t.is_active && <p className="text-xs text-slate-500 mt-0.5">לא נמכר כרגע</p>}
                            </div>
                            {canConfigure && (
                                <button type="button" onClick={() => setEditing(t)} aria-label={`עריכת ${t.name}`}
                                    className="w-11 h-11 flex items-center justify-center rounded-xl text-slate-500 hover:text-indigo-700 shrink-0">
                                    <PencilLine className="w-4 h-4" aria-hidden />
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            {editing && <TypeSheet t={editing === "new" ? null : editing} templates={templates}
                onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
        </div>
    );
}

const field = "w-full min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400";
const label = "block text-xs font-semibold text-slate-600";

function TypeSheet({ t, templates, onClose, onSaved }: { t: MembershipType | null; templates: ClassTemplate[]; onClose: () => void; onSaved: () => void }) {
    const [f, setF] = useState({
        name: t?.name ?? "", kind: t?.kind ?? ("punch" as MembershipKind), price: t ? t.price_cents / 100 : ("" as number | ""),
        duration_days: t?.duration_days ?? ("" as number | ""), entries: t?.entries ?? ("" as number | ""),
        covers_all: t?.covers_all ?? true, covered_templates: t?.covered_templates ?? [], is_active: t?.is_active ?? true,
    });
    const [busy, setBusy] = useState(false);
    const [rulesOpen, setRulesOpen] = useState(false);
    const set = (patch: Partial<typeof f>) => setF(v => ({ ...v, ...patch }));

    const save = async () => {
        setBusy(true);
        try {
            await apiFetch(t ? `/api/classes/membership-types/${t.id}` : "/api/classes/membership-types", {
                method: t ? "PATCH" : "POST",
                body: JSON.stringify({
                    name: f.name.trim(), kind: f.kind, price_cents: f.price === "" ? 0 : Math.round(f.price * 100),
                    duration_days: f.duration_days === "" ? null : f.duration_days,
                    entries: f.kind === "unlimited" || f.entries === "" ? null : f.entries,
                    covers_all: f.covers_all, covered_templates: f.covers_all ? [] : f.covered_templates, is_active: f.is_active,
                }),
            });
            toast.success(t ? "סוג המנוי עודכן — מנויים שכבר נמכרו לא משתנים" : "סוג המנוי נוסף");
            onSaved();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "השמירה נכשלה");
        } finally {
            setBusy(false);
        }
    };

    return (
        <BottomSheet open onClose={onClose} title={t ? `עריכה: ${t.name}` : "סוג מנוי חדש"} className="sm:max-w-lg"
            footer={
                <button type="button" onClick={save} disabled={busy || !f.name.trim()}
                    className="w-full inline-flex items-center justify-center gap-2 min-h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-bold">
                    {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />} שמירה
                </button>
            }>
            <div className="px-5 py-4 space-y-4 overflow-y-auto min-h-0">
                <label className={label}>שם
                    <input value={f.name} onChange={e => set({ name: e.target.value })} maxLength={120} placeholder="כרטיסייה 10" className={`${field} mt-1`} />
                </label>
                <fieldset>
                    <legend className={label}>סוג</legend>
                    <div className="mt-1 grid gap-2">
                        {KINDS.map(k => (
                            <button key={k.value} type="button" role="radio" aria-checked={f.kind === k.value} onClick={() => set({ kind: k.value })}
                                className={`text-right rounded-xl border px-3 py-2 ${f.kind === k.value ? "border-indigo-500 bg-indigo-50" : "border-slate-200"}`}>
                                <span className={`block text-sm font-semibold ${f.kind === k.value ? "text-indigo-800" : "text-slate-800"}`}>{k.label}</span>
                                <span className="block text-xs text-slate-500">{k.hint}</span>
                            </button>
                        ))}
                    </div>
                </fieldset>
                <div className="grid grid-cols-3 gap-3">
                    {f.kind !== "unlimited" && (
                        <label className={label}>{f.kind === "punch" ? "כניסות" : "כניסות בשבוע"}
                            <input type="number" min={1} max={f.kind === "weekly" ? 14 : 500} value={f.entries} dir="ltr"
                                onChange={e => set({ entries: e.target.value === "" ? "" : Number(e.target.value) })} className={`${field} mt-1 tabular-nums`} />
                        </label>
                    )}
                    <label className={label}>תוקף (ימים){f.kind === "punch" ? " — לא חובה" : ""}
                        <input type="number" min={1} max={3650} value={f.duration_days} dir="ltr"
                            onChange={e => set({ duration_days: e.target.value === "" ? "" : Number(e.target.value) })} className={`${field} mt-1 tabular-nums`} />
                    </label>
                    <label className={label}>מחיר (₪)
                        <input type="number" min={0} value={f.price} dir="ltr"
                            onChange={e => set({ price: e.target.value === "" ? "" : Number(e.target.value) })} className={`${field} mt-1 tabular-nums`} />
                    </label>
                </div>
                <fieldset>
                    <legend className={label}>אילו שיעורים</legend>
                    <div className="mt-1 flex gap-2">
                        {[true, false].map(all => (
                            <button key={String(all)} type="button" role="radio" aria-checked={f.covers_all === all} onClick={() => set({ covers_all: all })}
                                className={`flex-1 min-h-11 rounded-xl border px-3 text-sm ${f.covers_all === all ? "border-indigo-500 bg-indigo-50 text-indigo-800 font-semibold" : "border-slate-200 text-slate-700"}`}>
                                {all ? "כל השיעורים" : "רק שיעורים נבחרים"}
                            </button>
                        ))}
                    </div>
                    {!f.covers_all && (
                        <div className="mt-2 grid gap-1">
                            {templates.map(tp => (
                                <label key={tp.id} className="flex items-center gap-2 min-h-10 text-sm text-slate-800">
                                    <input type="checkbox" checked={f.covered_templates.includes(tp.id)}
                                        onChange={e => set({ covered_templates: e.target.checked ? [...f.covered_templates, tp.id] : f.covered_templates.filter(x => x !== tp.id) })} />
                                    {tp.name}
                                </label>
                            ))}
                            {templates.length === 0 && <p className="text-xs text-slate-500">עוד אין שיעורים קבועים.</p>}
                        </div>
                    )}
                </fieldset>
                <label className="flex items-center gap-2 text-sm text-slate-800">
                    <input type="checkbox" checked={f.is_active} onChange={e => set({ is_active: e.target.checked })} />
                    נמכר עכשיו
                </label>
                {t && (
                    <div className="rounded-xl border border-slate-200">
                        <button type="button" onClick={() => setRulesOpen(o => !o)} aria-expanded={rulesOpen}
                            className="w-full flex items-center justify-between gap-2 px-3 min-h-11 text-sm font-semibold text-slate-700">
                            <span className="flex items-center gap-2"><Settings2 className="w-4 h-4" aria-hidden />ביטול מאוחר ואי-הגעה למנוי הזה</span>
                            <ChevronDown className={`w-4 h-4 transition-transform ${rulesOpen ? "rotate-180" : ""}`} aria-hidden />
                        </button>
                        {rulesOpen && (
                            <div className="border-t border-slate-100 p-3">
                                <PenaltyRules scopeType="membership_type" scopeId={t.id} canEdit
                                    emptyNote="אין כללים למנוי הזה — חלים הכללים של העסק (או של השיעור, אם יש לו)." />
                            </div>
                        )}
                    </div>
                )}
            </div>
        </BottomSheet>
    );
}
