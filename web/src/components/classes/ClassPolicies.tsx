"use client";

import { useMemo, useState } from "react";
import {
    CalendarClock, CalendarX2, ListOrdered, UsersRound, BellRing, Gift, PauseCircle, GraduationCap, QrCode, SlidersHorizontal, RotateCcw, Loader2,
    type LucideIcon,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";

// The business owner's class rules (GET/PATCH /api/classes/settings). The server holds every rule — its
// label, limits, default and help; this screen only groups them. A rule not in a group still shows,
// under "עוד", so a new rule on the server never needs a change here to appear.

export type ClassPolicy = {
    key: string; label: string; kind: "int" | "bool" | "choice"; unit: string; help: string;
    min: number | null; max: number | null; choices: { value: string; label: string }[];
    presets?: { value: number; label: string }[];      // ready-made values for a number; the owner may type another
    course_only?: boolean;                               // a course's rule (shown on a class template only for a course)
    default: number | boolean | string; module: string; levels: string[];
    value: number | boolean | string; is_default: boolean;
};

const GROUPS: { title: string; icon: LucideIcon; keys: string[] }[] = [
    { title: "הרשמה", icon: CalendarClock, keys: ["client_booking", "booking_opens_days", "booking_closes_minutes", "weeks_ahead"] },
    { title: "ביטולים והחלפות", icon: CalendarX2, keys: ["free_cancel_hours", "class_swap"] },
    { title: "רשימת המתנה", icon: ListOrdered, keys: ["waitlist_max", "waitlist_mode", "waitlist_confirm_minutes"] },
    { title: "מינימום משתתפים", icon: UsersRound, keys: ["min_participants", "min_check_hours", "auto_cancel_below_min"] },
    { title: "תזכורות", icon: BellRing, keys: ["reminder_hours"] },
    { title: "הקפאות", icon: PauseCircle, keys: ["freeze_requests"] },
    { title: "צ׳ק-אין בכניסה", icon: QrCode, keys: ["checkin_opens_minutes", "checkin_closes_minutes", "checkin_walk_in"] },
    { title: "קורסים", icon: GraduationCap, keys: ["course_self_enroll", "course_late_join", "course_refund", "course_refund_days",
        "course_drop_in", "course_covered_by_membership"] },
    { title: "מועדון לקוחות", icon: Gift, keys: ["club_points_membership_percent", "club_points_entry_percent", "club_points_course_percent"] },
];

type Draft = Record<string, number | boolean | string>;

function shown(p: ClassPolicy, v: ClassPolicy["value"]): string {
    if (p.kind === "bool") return v ? "פעיל" : "כבוי";
    if (p.kind === "choice") return (p.choices.find(c => c.value === v)?.label ?? String(v)).split(" — ")[0];
    const preset = p.presets?.find(x => x.value === v);
    return preset && !preset.label.includes("%") ? preset.label : `${v} ${p.unit}`.trim();
}

function problem(p: ClassPolicy, v: unknown): string | null {
    if (p.kind !== "int") return null;
    if (v === "" || typeof v !== "number" || !Number.isInteger(v)) return "מספר שלם";
    if ((p.min !== null && v < p.min) || (p.max !== null && v > p.max)) return `בין ${p.min} ל-${p.max}`;
    return null;
}

export default function ClassPolicies({ policies, canEdit, onSaved }: {
    policies: ClassPolicy[]; canEdit: boolean; onSaved: (p: ClassPolicy[]) => void;
}) {
    const [draft, setDraft] = useState<Draft>(() => Object.fromEntries(policies.map(p => [p.key, p.value])));
    const [saving, setSaving] = useState(false);

    const groups = useMemo(() => {
        const byKey = new Map(policies.map(p => [p.key, p]));
        const placed = new Set(GROUPS.flatMap(g => g.keys));
        const out = GROUPS
            .map(g => ({ ...g, items: g.keys.map(k => byKey.get(k)).filter((p): p is ClassPolicy => !!p) }))
            .filter(g => g.items.length);
        const rest = policies.filter(p => !placed.has(p.key));
        if (rest.length) out.push({ title: "עוד", icon: SlidersHorizontal, keys: [], items: rest });
        return out;
    }, [policies]);

    const changed = policies.filter(p => draft[p.key] !== p.value);
    const invalid = policies.some(p => problem(p, draft[p.key]));

    const save = async () => {
        setSaving(true);
        try {
            const values = Object.fromEntries(changed.map(p => [p.key, draft[p.key]]));
            const next = await apiFetch<ClassPolicy[]>("/api/classes/settings", { method: "PATCH", body: JSON.stringify({ values }) });
            onSaved(next);
            setDraft(Object.fromEntries(next.map(p => [p.key, p.value])));
            toast.success("ההגדרות נשמרו");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "השמירה נכשלה");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            {!canEdit && (
                <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                    אפשר לראות את הכללים. שינוי — רק לבעלים או למנהל.
                </p>
            )}

            {groups.map(g => (
                <section key={g.title} className="bg-white rounded-2xl border border-slate-200/70 shadow-sm">
                    <h3 className="flex items-center gap-2 px-5 pt-4 pb-2 text-base font-bold text-slate-800">
                        <g.icon className="w-4.5 h-4.5 text-indigo-600" aria-hidden />
                        {g.title}
                    </h3>
                    <div className="divide-y divide-slate-100">
                        {g.items.map(p => (
                            <PolicyRow key={p.key} policy={p} value={draft[p.key]} disabled={!canEdit || saving}
                                onChange={v => setDraft(d => ({ ...d, [p.key]: v }))} />
                        ))}
                    </div>
                </section>
            ))}

            {canEdit && changed.length > 0 && (
                <div className="fixed inset-x-3 z-40 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:bottom-4 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[min(560px,calc(100%-2rem))]">
                    <div className="flex items-center gap-3 bg-slate-900 text-white rounded-2xl px-4 py-3 shadow-xl">
                        <span className="text-sm flex-1">
                            {changed.length === 1 ? "שינוי אחד לא נשמר" : `${changed.length} שינויים לא נשמרו`}
                        </span>
                        <button type="button" onClick={() => setDraft(Object.fromEntries(policies.map(p => [p.key, p.value])))}
                            disabled={saving} className="text-sm text-slate-300 hover:text-white px-3 min-h-11">
                            ביטול
                        </button>
                        <button type="button" onClick={save} disabled={saving || invalid}
                            className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-sm font-bold px-4 rounded-xl min-h-11">
                            {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                            שמור
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function PolicyRow({ policy: p, value, disabled, onChange }: {
    policy: ClassPolicy; value: ClassPolicy["value"]; disabled: boolean; onChange: (v: ClassPolicy["value"]) => void;
}) {
    const err = problem(p, value);
    const atDefault = value === p.default;
    const id = `policy-${p.key}`;

    return (
        <div className="px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 sm:max-w-[60%]">
                <label id={`${id}-label`} htmlFor={p.kind === "int" ? id : undefined} className="block text-sm font-semibold text-slate-800">{p.label}</label>
                {p.help && <p className="text-xs text-slate-500 mt-1 leading-relaxed">{p.help}</p>}
                <p className="text-xs text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
                    {atDefault ? <span>ברירת המחדל</span> : <span>ברירת המחדל: {shown(p, p.default)}</span>}
                    {!atDefault && !disabled && (
                        <button type="button" onClick={() => onChange(p.default)}
                            className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium">
                            <RotateCcw className="w-3 h-3" aria-hidden /> חזרה אליה
                        </button>
                    )}
                </p>
            </div>

            <div className="shrink-0">
                {p.kind === "int" && (
                    <div>
                        {!!p.presets?.length && (
                            <div className="flex flex-wrap gap-1.5 mb-2 sm:max-w-80" aria-label={`ערכים מוכנים: ${p.label}`}>
                                {p.presets.map(x => {
                                    const on = value === x.value;
                                    return (
                                        <button key={x.value} type="button" aria-pressed={on} disabled={disabled} onClick={() => onChange(x.value)}
                                            className={`min-h-9 px-3 rounded-full border text-xs font-semibold transition-colors disabled:opacity-60 ${on ? "border-indigo-500 bg-indigo-50 text-indigo-800" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                                            {x.label}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        <div className="flex items-center gap-2">
                            <input id={id} type="number" inputMode="numeric" dir="ltr" disabled={disabled}
                                min={p.min ?? undefined} max={p.max ?? undefined}
                                value={value === "" ? "" : String(value)}
                                onChange={e => onChange(e.target.value === "" ? "" : Number(e.target.value))}
                                aria-invalid={!!err}
                                className={`w-20 text-center tabular-nums rounded-xl border px-2 min-h-11 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-slate-50 disabled:text-slate-500 ${err ? "border-red-400" : "border-slate-200"}`} />
                            <span className="text-sm text-slate-500">{p.unit}</span>
                        </div>
                        {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
                    </div>
                )}

                {p.kind === "bool" && (
                    <button id={id} type="button" role="switch" aria-checked={!!value} aria-labelledby={`${id}-label`} disabled={disabled}
                        onClick={() => onChange(!value)}
                        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${value ? "bg-indigo-600" : "bg-slate-300"}`}>
                        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${value ? "-translate-x-6" : "-translate-x-1"}`} />
                    </button>
                )}

                {p.kind === "choice" && (
                    <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex flex-col gap-2 sm:w-72">
                        {p.choices.map(c => {
                            const [title, detail] = c.label.split(" — ");
                            const on = value === c.value;
                            return (
                                <button key={c.value} type="button" role="radio" aria-checked={on} disabled={disabled}
                                    onClick={() => onChange(c.value)}
                                    className={`text-right rounded-xl border px-3 py-2 transition-colors disabled:opacity-60 ${on ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:border-slate-300"}`}>
                                    <span className={`block text-sm font-semibold ${on ? "text-indigo-800" : "text-slate-700"}`}>{title}</span>
                                    {detail && <span className="block text-xs text-slate-500 mt-0.5">{detail}</span>}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
