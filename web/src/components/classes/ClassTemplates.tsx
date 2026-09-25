"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, PencilLine, CirclePause, Loader2, GraduationCap, Settings2, ChevronDown } from "lucide-react";
import BottomSheet from "@/components/ui/bottom-sheet";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import type { Terms } from "@/lib/useTerms";
import type { ClassPolicy } from "@/components/classes/ClassPolicies";
import { DryRunNotice } from "@/components/classes/ClassSchedule";
import {
    type ClassTemplate, type Room, type StaffMember, type DryRun,
    DAY_SHORT, daysText, endTime, ilDate, ilTime, staffName,
} from "@/lib/classes";

// Recurring classes: a class every week, or a short course (an end date or a number of sessions). Saving
// asks the server first (dry_run): a busy room stops the save, a busy instructor is confirmed, and when
// the change reaches classes people are already booked into, the owner chooses whether those change too
// (and their clients get a message) or keep their details.

type Service = { id: string; name: string; duration_minutes: number; color: string };

const COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#14b8a6"];

export default function ClassTemplates({ rooms, staff, services, policies, terms, canConfigure, modules }: {
    rooms: Room[]; staff: StaffMember[]; services: Service[]; policies: ClassPolicy[]; terms: Terms;
    canConfigure: boolean; modules: Record<string, boolean> | null;
}) {
    const [list, setList] = useState<ClassTemplate[] | null>(null);
    const [editing, setEditing] = useState<ClassTemplate | "new" | null>(null);
    const [stopping, setStopping] = useState<ClassTemplate | null>(null);

    const load = useCallback(() => apiFetch<ClassTemplate[]>("/api/classes/templates").then(setList)
        .catch(e => { setList([]); toast.error(e instanceof Error ? e.message : "טעינה נכשלה"); }), []);
    useEffect(() => { load(); }, [load]);

    return (
        <div className="space-y-4">
            {canConfigure && (
                <button type="button" onClick={() => setEditing("new")}
                    className="inline-flex items-center gap-2 min-h-11 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold">
                    <Plus className="w-4 h-4" aria-hidden /> שיעור קבוע חדש
                </button>
            )}
            {list === null ? (
                <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-indigo-500 animate-spin" aria-label="טוען" /></div>
            ) : list.length === 0 ? (
                <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-2xl px-5 py-8 text-center">
                    עוד אין שיעורים קבועים. שיעור קבוע חוזר כל שבוע באותם ימים ושעה — או קורס עם מספר מפגשים.
                </p>
            ) : (
                <div className="grid gap-3 md:grid-cols-2">
                    {list.map(t => (
                        <article key={t.id} className="rounded-2xl border border-slate-200/70 bg-white p-4 flex flex-col gap-2">
                            <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.color || "#6366f1" }} aria-hidden />
                                <span className="truncate">{t.name}</span>
                                {t.sessions_count === 1 && (
                                    <span className="text-[11px] font-semibold text-slate-700 bg-slate-100 rounded-full px-2 py-0.5 shrink-0">פעם אחת</span>
                                )}
                                {t.is_course && (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-800 bg-violet-100 rounded-full px-2 py-0.5 shrink-0">
                                        <GraduationCap className="w-3 h-3" aria-hidden />
                                        {t.sessions_count ? `קורס · ${t.sessions_count} מפגשים` : `קורס · עד ${ilDate(`${t.ends_on}T12:00:00Z`)}`}
                                    </span>
                                )}
                            </h3>
                            <p className="text-sm text-slate-700 tabular-nums">{daysText(t.weekdays)} · <span dir="ltr">{t.start_time}–{endTime(t.start_time, t.duration_minutes)}</span></p>
                            <p className="text-sm text-slate-500">
                                {[t.room_name && `חדר ${t.room_name}`, t.instructor_name, `${t.capacity} מקומות`].filter(Boolean).join(" · ")}
                            </p>
                            <p className="text-xs text-slate-500">
                                {t.next_session ? `הבא: ${ilDate(t.next_session)} ${ilTime(t.next_session)} · ${t.future_sessions} שיעורים בלוח` : "אין שיעורים עתידיים"}
                            </p>
                            {canConfigure && (
                                <div className="flex gap-2 pt-1 mt-auto">
                                    <button type="button" onClick={() => setEditing(t)}
                                        className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-xl border border-slate-200 text-sm text-slate-700 hover:border-indigo-400">
                                        <PencilLine className="w-4 h-4" aria-hidden /> עריכה
                                    </button>
                                    <button type="button" onClick={() => setStopping(t)}
                                        className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-xl text-sm text-slate-500 hover:text-rose-700">
                                        <CirclePause className="w-4 h-4" aria-hidden /> הפסקה
                                    </button>
                                </div>
                            )}
                        </article>
                    ))}
                </div>
            )}

            {editing && (
                <TemplateSheet tpl={editing === "new" ? null : editing} rooms={rooms} staff={staff} services={services}
                    policies={policies} terms={terms} modules={modules}
                    onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
            )}
            {stopping && <StopSheet t={stopping} terms={terms} onClose={() => setStopping(null)} onDone={() => { setStopping(null); load(); }} />}
        </div>
    );
}

const field = "w-full min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400";
const label = "block text-xs font-semibold text-slate-600";

type Form = {
    name: string; service_id: string; color: string; room_id: string; instructor_id: string;
    capacity: number | ""; weekdays: number[]; start_time: string; duration_minutes: number | "";
    starts_on: string; course: "" | "once" | "count" | "date"; sessions_count: number | ""; ends_on: string;
    rules: Record<string, number | boolean | string | null>;
};

/** Where a new class starts when opened from a slot in the calendar. */
export type TemplatePreset = { day: string; start_time: string; duration_minutes: number };

const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

function initial(t: ClassTemplate | null, preset?: TemplatePreset): Form {
    const today = new Date().toISOString().slice(0, 10);
    return {
        name: t?.name ?? "", service_id: t?.service_id ?? "", color: t?.color ?? COLORS[0],
        room_id: t?.room_id ?? "", instructor_id: t?.instructor_id ?? "", capacity: t?.capacity ?? "",
        weekdays: t?.weekdays ?? (preset ? [weekdayOf(preset.day)] : []),
        start_time: t?.start_time ?? preset?.start_time ?? "18:00",
        duration_minutes: t?.duration_minutes ?? preset?.duration_minutes ?? 60,
        starts_on: t?.starts_on ?? preset?.day ?? today,
        course: t?.sessions_count === 1 ? "once" : t?.sessions_count ? "count" : t?.ends_on ? "date" : "",
        sessions_count: t?.sessions_count ?? "", ends_on: t?.ends_on ?? "", rules: { ...(t?.rules ?? {}) },
    };
}

/** Create or edit a recurring class (or a one-time class, or a course). Also opened from the calendar. */
export function TemplateSheet({ tpl, preset, rooms, staff, services, policies, terms, modules, onClose, onSaved }: {
    tpl: ClassTemplate | null; preset?: TemplatePreset; rooms: Room[]; staff: StaffMember[]; services: Service[];
    policies: ClassPolicy[]; terms: Terms; modules: Record<string, boolean> | null; onClose: () => void; onSaved: () => void;
}) {
    const [f, setF] = useState<Form>(() => initial(tpl, preset));
    const [check, setCheck] = useState<DryRun | null>(null);
    const [busy, setBusy] = useState(false);
    const [rulesOpen, setRulesOpen] = useState(() => Object.keys(tpl?.rules ?? {}).length > 0);
    const set = (patch: Partial<Form>) => { setF(v => ({ ...v, ...patch })); setCheck(null); };
    const templateRules = useMemo(() => policies.filter(p => p.levels.includes("class_template")
        && (!modules || modules[p.module] !== false)), [policies, modules]);
    const room = rooms.find(r => r.id === f.room_id);

    const pickService = (id: string) => {
        const s = services.find(x => x.id === id);
        set(s ? { service_id: id, duration_minutes: s.duration_minutes, color: s.color, name: f.name || s.name } : { service_id: "" });
    };
    const pickRoom = (id: string) => {
        const r = rooms.find(x => x.id === id);
        set({ room_id: id, capacity: r && (f.capacity === "" || f.capacity > r.capacity) ? r.capacity : f.capacity });
    };

    const once = f.course === "once";
    const missing = !f.name.trim() ? "שם" : !once && !f.weekdays.length ? "ימים" : !f.start_time ? "שעה"
        : f.duration_minutes === "" ? "משך" : f.capacity === "" && !f.room_id ? "מקומות"
        : f.course === "count" && f.sessions_count === "" ? "מספר מפגשים" : f.course === "date" && !f.ends_on ? "תאריך סיום" : null;

    const payload = (extra: object) => JSON.stringify({
        name: f.name.trim(), service_id: f.service_id || null, color: f.color || null,
        room_id: f.room_id || null, instructor_id: f.instructor_id || null,
        capacity: f.capacity === "" ? null : f.capacity, weekdays: once ? [weekdayOf(f.starts_on)] : f.weekdays,
        start_time: f.start_time, duration_minutes: f.duration_minutes === "" ? null : f.duration_minutes, starts_on: f.starts_on,
        sessions_count: once ? 1 : f.course === "count" ? f.sessions_count : null, ends_on: f.course === "date" ? f.ends_on : null,
        rules: f.rules, ...extra,
    });

    const save = async (applyToBooked?: boolean) => {
        setBusy(true);
        const url = tpl ? `/api/classes/templates/${tpl.id}` : "/api/classes/templates";
        const method = tpl ? "PATCH" : "POST";
        try {
            if (!check) {
                const r = await apiFetch<DryRun>(url, { method, body: payload({ dry_run: true }) });
                if (r.clashes.room.length || r.clashes.instructor.length || r.booked.sessions) { setCheck(r); return; }
            }
            await apiFetch(url, { method, body: payload({ confirm_clashes: true, apply_to_booked: !!applyToBooked }) });
            toast.success(tpl ? "השיעור הקבוע עודכן" : "השיעור הקבוע נוצר — הלוח מתמלא");
            onSaved();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "השמירה נכשלה");
        } finally {
            setBusy(false);
        }
    };

    const blocked = !!check?.clashes.room.length;
    const asksBooked = !!check && !blocked && check.booked.sessions > 0;

    return (
        <BottomSheet open onClose={onClose} title={tpl ? `עריכה: ${tpl.name}` : "שיעור קבוע חדש"} className="sm:max-w-xl"
            footer={
                <div className="flex flex-wrap gap-2">
                    {asksBooked ? (
                        <>
                            <button type="button" onClick={() => save(true)} disabled={busy}
                                className="flex-1 min-h-11 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold disabled:opacity-40">
                                לעדכן גם אותם ולשלוח הודעה
                            </button>
                            <button type="button" onClick={() => save(false)} disabled={busy}
                                className="flex-1 min-h-11 px-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 disabled:opacity-40">
                                רק שיעורים בלי רשומים
                            </button>
                        </>
                    ) : (
                        <button type="button" onClick={() => save()} disabled={busy || !!missing || blocked}
                            className="flex-1 inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-bold">
                            {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                            {check?.clashes.instructor.length ? "לשמור בכל זאת" : missing ? `חסר: ${missing}` : "שמירה"}
                        </button>
                    )}
                </div>
            }>
            <div className="px-5 py-4 space-y-4 overflow-y-auto min-h-0">
                {services.length > 0 && (
                    <label className={label}>מבוסס על שירות (מחיר ומשך)
                        <select value={f.service_id} onChange={e => pickService(e.target.value)} className={`${field} mt-1`}>
                            <option value="">בלי שירות</option>
                            {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    </label>
                )}
                <label className={label}>שם השיעור
                    <input value={f.name} onChange={e => set({ name: e.target.value })} maxLength={160} className={`${field} mt-1`} placeholder="פילאטיס מכשירים" />
                </label>

                {!once && <fieldset>
                    <legend className={label}>ימים</legend>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                        {DAY_SHORT.map((d, i) => {
                            const on = f.weekdays.includes(i);
                            return (
                                <button key={i} type="button" role="checkbox" aria-checked={on} aria-label={d}
                                    onClick={() => set({ weekdays: on ? f.weekdays.filter(x => x !== i) : [...f.weekdays, i] })}
                                    className={`w-11 h-11 rounded-xl border text-sm font-bold ${on ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-700"}`}>
                                    {d}
                                </button>
                            );
                        })}
                    </div>
                </fieldset>}

                <div className="grid grid-cols-2 gap-3">
                    <label className={label}>שעת התחלה
                        <input type="time" value={f.start_time} onChange={e => set({ start_time: e.target.value })} className={`${field} mt-1`} dir="ltr" />
                    </label>
                    <label className={label}>משך (דקות)
                        <input type="number" min={5} max={600} value={f.duration_minutes} className={`${field} mt-1 tabular-nums`} dir="ltr"
                            onChange={e => set({ duration_minutes: e.target.value === "" ? "" : Number(e.target.value) })} />
                    </label>
                    {rooms.length > 0 && (
                        <label className={label}>חדר
                            <select value={f.room_id} onChange={e => pickRoom(e.target.value)} className={`${field} mt-1`}>
                                <option value="">בלי חדר</option>
                                {rooms.filter(r => r.is_active).map(r => <option key={r.id} value={r.id}>{r.name} ({r.capacity})</option>)}
                            </select>
                        </label>
                    )}
                    <label className={label}>מקומות
                        <input type="number" min={1} max={room?.capacity ?? 500} value={f.capacity} className={`${field} mt-1 tabular-nums`} dir="ltr"
                            placeholder={room ? String(room.capacity) : ""}
                            onChange={e => set({ capacity: e.target.value === "" ? "" : Number(e.target.value) })} />
                    </label>
                    <label className={`${label} col-span-2 sm:col-span-1`}>{terms.staff}
                        <select value={f.instructor_id} onChange={e => set({ instructor_id: e.target.value })} className={`${field} mt-1`}>
                            <option value="">בלי שיבוץ</option>
                            {staff.map(u => <option key={u.id} value={u.id}>{staffName(u)}</option>)}
                        </select>
                    </label>
                    <label className={`${label} col-span-2 sm:col-span-1`}>{once ? "תאריך" : "מתחיל מתאריך"}
                        <input type="date" value={f.starts_on} onChange={e => set({ starts_on: e.target.value })} className={`${field} mt-1`} dir="ltr" />
                    </label>
                </div>

                <fieldset>
                    <legend className={label}>חוזר</legend>
                    <div className="mt-1 grid gap-2 grid-cols-2">
                        {([["", "כל שבוע, בלי סוף"], ["once", "פעם אחת"], ["count", "קורס: מספר מפגשים"], ["date", "קורס: עד תאריך"]] as const).map(([v, text]) => (
                            <button key={v} type="button" role="radio" aria-checked={f.course === v} onClick={() => set({ course: v })}
                                className={`min-h-11 rounded-xl border px-3 text-sm text-right ${f.course === v ? "border-indigo-500 bg-indigo-50 text-indigo-800 font-semibold" : "border-slate-200 text-slate-700"}`}>
                                {text}
                            </button>
                        ))}
                    </div>
                    {f.course === "count" && (
                        <input type="number" min={1} max={200} value={f.sessions_count} aria-label="מספר מפגשים" dir="ltr"
                            onChange={e => set({ sessions_count: e.target.value === "" ? "" : Number(e.target.value) })}
                            className={`${field} mt-2 w-32 tabular-nums`} placeholder="5" />
                    )}
                    {f.course === "date" && (
                        <input type="date" value={f.ends_on} min={f.starts_on} aria-label="תאריך סיום" dir="ltr"
                            onChange={e => set({ ends_on: e.target.value })} className={`${field} mt-2 w-44`} />
                    )}
                </fieldset>

                <fieldset>
                    <legend className={label}>צבע ביומן</legend>
                    <div className="mt-1 flex flex-wrap gap-2">
                        {[...new Set([f.color, ...COLORS])].filter(Boolean).map(c => (
                            <button key={c} type="button" role="radio" aria-checked={f.color === c} aria-label={c} onClick={() => set({ color: c })}
                                className={`w-8 h-8 rounded-full border-2 ${f.color === c ? "border-slate-900" : "border-transparent"}`} style={{ background: c }} />
                        ))}
                    </div>
                </fieldset>

                {templateRules.length > 0 && (
                    <div className="rounded-xl border border-slate-200">
                        <button type="button" onClick={() => setRulesOpen(o => !o)} aria-expanded={rulesOpen}
                            className="w-full flex items-center justify-between gap-2 px-3 min-h-11 text-sm font-semibold text-slate-700">
                            <span className="flex items-center gap-2"><Settings2 className="w-4 h-4" aria-hidden />כללים מיוחדים לשיעור הזה</span>
                            <ChevronDown className={`w-4 h-4 transition-transform ${rulesOpen ? "rotate-180" : ""}`} aria-hidden />
                        </button>
                        {rulesOpen && (
                            <div className="border-t border-slate-100 divide-y divide-slate-100">
                                {templateRules.map(p => <RuleRow key={p.key} p={p} value={f.rules[p.key] ?? null}
                                    onChange={v => set({ rules: { ...f.rules, [p.key]: v } })} />)}
                            </div>
                        )}
                    </div>
                )}

                {check && (
                    <div className="space-y-2">
                        <DryRunNotice r={check} terms={terms} action="" />
                        {asksBooked && (
                            <p className="text-sm text-slate-700">
                                השינוי נוגע ל-{check.booked.sessions} שיעורים שיש בהם {check.booked.clients} {terms.client_plural} רשומים.
                                לעדכן גם אותם? אם לא — הם נשארים כמו שהם.
                            </p>
                        )}
                    </div>
                )}
            </div>
        </BottomSheet>
    );
}

function shownValue(p: ClassPolicy, v: ClassPolicy["value"]): string {
    if (p.kind === "bool") return v ? "פעיל" : "כבוי";
    if (p.kind === "choice") return (p.choices.find(c => c.value === v)?.label ?? String(v)).split(" — ")[0];
    return `${v} ${p.unit}`.trim();
}

function RuleRow({ p, value, onChange }: { p: ClassPolicy; value: number | boolean | string | null; onChange: (v: number | boolean | string | null) => void }) {
    const own = value !== null;
    return (
        <div className="px-3 py-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-slate-800">{p.label}</span>
                <select value={own ? "own" : "business"} aria-label={p.label}
                    onChange={e => onChange(e.target.value === "own" ? p.value : null)}
                    className="min-h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 max-w-[55%]">
                    <option value="business">כמו בעסק ({shownValue(p, p.value)})</option>
                    <option value="own">הגדרה מיוחדת</option>
                </select>
            </div>
            {own && p.kind === "int" && (
                <div className="flex items-center gap-2">
                    <input type="number" min={p.min ?? undefined} max={p.max ?? undefined} value={String(value)} dir="ltr"
                        onChange={e => onChange(e.target.value === "" ? p.value : Number(e.target.value))}
                        className="w-20 min-h-9 rounded-lg border border-slate-200 text-center text-sm tabular-nums" />
                    <span className="text-xs text-slate-500">{p.unit}</span>
                </div>
            )}
            {own && p.kind === "bool" && (
                <select value={value ? "1" : "0"} onChange={e => onChange(e.target.value === "1")} aria-label={p.label}
                    className="min-h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm">
                    <option value="1">פעיל</option>
                    <option value="0">כבוי</option>
                </select>
            )}
            {own && p.kind === "choice" && (
                <select value={String(value)} onChange={e => onChange(e.target.value)} aria-label={p.label}
                    className="min-h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm max-w-full">
                    {p.choices.map(c => <option key={c.value} value={c.value}>{c.label.split(" — ")[0]}</option>)}
                </select>
            )}
        </div>
    );
}

function StopSheet({ t, terms, onClose, onDone }: { t: ClassTemplate; terms: Terms; onClose: () => void; onDone: () => void }) {
    const [busy, setBusy] = useState(false);
    const stop = async (cancelBooked: boolean) => {
        setBusy(true);
        try {
            const r = await apiFetch<{ removed: number; canceled: number; kept: number; messages: number }>(
                `/api/classes/templates/${t.id}/stop`, { method: "POST", body: JSON.stringify({ cancel_booked: cancelBooked }) });
            toast.success(r.kept ? `השיעור הקבוע הופסק. ${r.kept} שיעורים עם רשומים נשארו בלוח.` : "השיעור הקבוע הופסק");
            onDone();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "הפעולה נכשלה");
        } finally {
            setBusy(false);
        }
    };
    const withBooked = t.future_booked_sessions;
    return (
        <BottomSheet open onClose={onClose} title={`הפסקה: ${t.name}`}
            footer={
                <div className="flex flex-wrap gap-2">
                    {withBooked > 0 ? (
                        <>
                            <button type="button" onClick={() => stop(true)} disabled={busy}
                                className="flex-1 min-h-11 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold disabled:opacity-40">
                                לבטל אותם ולשלוח הודעה
                            </button>
                            <button type="button" onClick={() => stop(false)} disabled={busy}
                                className="flex-1 min-h-11 px-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 disabled:opacity-40">
                                להשאיר אותם בלוח
                            </button>
                        </>
                    ) : (
                        <button type="button" onClick={() => stop(false)} disabled={busy}
                            className="flex-1 min-h-11 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold disabled:opacity-40">
                            להפסיק את השיעור הקבוע
                        </button>
                    )}
                </div>
            }>
            <div className="px-5 py-4 text-sm text-slate-700 space-y-2">
                <p>לא ייווצרו יותר שיעורים. השיעורים העתידיים בלי רשומים יוסרו מהלוח.</p>
                {withBooked > 0 && <p>ב-{withBooked} שיעורים עתידיים יש {terms.client_plural} רשומים. מה לעשות איתם?</p>}
            </div>
        </BottomSheet>
    );
}
