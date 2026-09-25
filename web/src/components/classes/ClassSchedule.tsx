"use client";

import { useCallback, useEffect, useState } from "react";
import {
    ChevronRight, ChevronLeft, Users, DoorOpen, UserRound, Ban, PencilLine, Loader2, TriangleAlert, GraduationCap,
} from "lucide-react";
import BottomSheet from "@/components/ui/bottom-sheet";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import type { Terms } from "@/lib/useTerms";
import {
    type ClassSession, type Room, type StaffMember, type DryRun,
    DAY_LONG, ilTime, ilDate, ilDay, weekStart, shiftDay, dayLabel, clashLine, staffName,
} from "@/lib/classes";

// The week's classes, day by day (Sunday first). A class opens in a sheet: its details, who is booked,
// and — for owner/admin — changing or cancelling this one class. Both ask the server first (dry_run)
// and show clashes and how many booked clients will get a message before anything is saved.

const todayIso = () => new Date().toISOString();

export default function ClassSchedule({ rooms, staff, terms, canChange, openSessionId }: {
    rooms: Room[]; staff: StaffMember[]; terms: Terms; canChange: boolean; openSessionId?: string | null;
}) {
    const [week, setWeek] = useState(() => weekStart(todayIso()));
    const [room, setRoom] = useState("");
    const [sessions, setSessions] = useState<ClassSession[] | null>(null);
    const [openId, setOpenId] = useState<string | null>(null);

    const load = useCallback(() => {
        const q = `start=${week}T00:00:00&end=${shiftDay(week, 7)}T00:00:00${room ? `&room_id=${room}` : ""}`;
        apiFetch<ClassSession[]>(`/api/classes/sessions?${q}`)
            .then(setSessions)
            .catch(e => { setSessions([]); toast.error(e instanceof Error ? e.message : "טעינה נכשלה"); });
    }, [week, room]);

    useEffect(() => { load(); }, [load]);

    // Arriving from the calendar with ?session=…: jump to its week and open it.
    useEffect(() => {
        if (!openSessionId) return;
        apiFetch<ClassSession>(`/api/classes/sessions/${openSessionId}`)
            .then(s => { setWeek(weekStart(s.starts_at)); setOpenId(s.id); })
            .catch(() => toast.error("השיעור לא נמצא"));
    }, [openSessionId]);

    const today = ilDay(todayIso());
    const days = Array.from({ length: 7 }, (_, i) => shiftDay(week, i));
    const thisWeek = weekStart(todayIso());

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white">
                    <button type="button" onClick={() => setWeek(w => shiftDay(w, -7))} aria-label="השבוע הקודם"
                        className="w-11 h-11 flex items-center justify-center text-slate-600 hover:text-indigo-700">
                        <ChevronRight className="w-5 h-5" aria-hidden />
                    </button>
                    <span dir="ltr" className="px-2 text-sm font-semibold text-slate-800 tabular-nums min-w-[7.5rem] text-center">
                        {dayLabel(week)} – {dayLabel(shiftDay(week, 6))}
                    </span>
                    <button type="button" onClick={() => setWeek(w => shiftDay(w, 7))} aria-label="השבוע הבא"
                        className="w-11 h-11 flex items-center justify-center text-slate-600 hover:text-indigo-700">
                        <ChevronLeft className="w-5 h-5" aria-hidden />
                    </button>
                </div>
                {week !== thisWeek && (
                    <button type="button" onClick={() => setWeek(thisWeek)}
                        className="min-h-11 px-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 hover:border-indigo-400">
                        השבוע
                    </button>
                )}
                {rooms.length > 1 && (
                    <select value={room} onChange={e => setRoom(e.target.value)} aria-label="חדר"
                        className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 ms-auto">
                        <option value="">כל החדרים</option>
                        {rooms.filter(r => r.is_active).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                )}
            </div>

            {sessions === null ? (
                <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-indigo-500 animate-spin" aria-label="טוען" /></div>
            ) : (
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                    {days.map((day, i) => {
                        const items = sessions.filter(s => ilDay(s.starts_at) === day);
                        return (
                            <section key={day} aria-label={`יום ${DAY_LONG[i]}`}
                                className={`rounded-2xl border p-2.5 ${day === today ? "border-indigo-300 bg-indigo-50/40" : "border-slate-200/70 bg-white"}`}>
                                <h3 className="flex items-baseline justify-between px-1 pb-2">
                                    <span className={`text-sm font-bold ${day === today ? "text-indigo-700" : "text-slate-800"}`}>{DAY_LONG[i]}</span>
                                    <span className="text-xs text-slate-500 tabular-nums">{dayLabel(day)}</span>
                                </h3>
                                {items.length === 0 ? (
                                    <p className="text-xs text-slate-400 px-1 pb-1">אין שיעורים</p>
                                ) : (
                                    <ul className="space-y-2">
                                        {items.map(s => (
                                            <li key={s.id}><SessionRow s={s} onOpen={() => setOpenId(s.id)} /></li>
                                        ))}
                                    </ul>
                                )}
                            </section>
                        );
                    })}
                </div>
            )}

            {openId && (
                <SessionSheet id={openId} rooms={rooms} staff={staff} terms={terms} canChange={canChange}
                    onClose={() => setOpenId(null)} onChanged={load} />
            )}
        </div>
    );
}

function SessionRow({ s, onOpen }: { s: ClassSession; onOpen: () => void }) {
    const canceled = s.status !== "scheduled" && s.status !== "done";
    const full = s.booked >= s.capacity;
    return (
        <button type="button" onClick={onOpen}
            className={`w-full text-right rounded-xl border px-2.5 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${canceled ? "border-slate-200 bg-slate-50 opacity-70" : "border-slate-200 bg-white hover:border-indigo-300"}`}>
            <span className="flex items-center justify-between gap-2">
                <span dir="ltr" className="text-xs font-semibold text-slate-600 tabular-nums whitespace-nowrap">{ilTime(s.starts_at)}–{ilTime(s.ends_at)}</span>
                {canceled ? (
                    <span className="text-[11px] font-semibold text-rose-700 bg-rose-50 rounded-full px-1.5">בוטל</span>
                ) : (
                    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums rounded-full px-1.5 ${full ? "text-amber-800 bg-amber-100" : "text-slate-600 bg-slate-100"}`}>
                        <Users className="w-3 h-3" aria-hidden />{s.booked}/{s.capacity}
                    </span>
                )}
            </span>
            <span className={`mt-1 flex items-start gap-1.5 text-sm font-semibold text-slate-900 ${canceled ? "line-through decoration-slate-400" : ""}`}>
                <span className="w-2 h-2 mt-1.5 rounded-full shrink-0" style={{ background: s.color }} aria-hidden />
                <span className="line-clamp-2 leading-snug">{s.name}</span>
            </span>
            {(s.room_name || s.instructor_name) && (
                <span className="mt-0.5 block text-xs text-slate-500 truncate">
                    {[s.room_name, s.instructor_name].filter(Boolean).join(" · ")}
                </span>
            )}
        </button>
    );
}

type Mode = "view" | "change" | "cancel";

function SessionSheet({ id, rooms, staff, terms, canChange, onClose, onChanged }: {
    id: string; rooms: Room[]; staff: StaffMember[]; terms: Terms; canChange: boolean; onClose: () => void; onChanged: () => void;
}) {
    const [s, setS] = useState<ClassSession | null>(null);
    const [mode, setMode] = useState<Mode>("view");

    const reload = useCallback(() => {
        apiFetch<ClassSession>(`/api/classes/sessions/${id}`).then(setS).catch(e => {
            toast.error(e instanceof Error ? e.message : "השיעור לא נמצא");
            onClose();
        });
    }, [id, onClose]);
    useEffect(() => { reload(); }, [reload]);

    const done = (msg: string) => { toast.success(msg); setMode("view"); reload(); onChanged(); };
    const open = s && s.status === "scheduled" && new Date(s.starts_at) > new Date();

    return (
        <BottomSheet open onClose={onClose} title={s ? s.name : "שיעור"} className="sm:max-w-lg">
            {!s ? (
                <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 text-indigo-500 animate-spin" aria-label="טוען" /></div>
            ) : (
                <div className="px-5 py-4 space-y-4 overflow-y-auto min-h-0">
                    <div className="space-y-1.5 text-sm">
                        <p className="font-semibold text-slate-900 tabular-nums">
                            יום {DAY_LONG[new Date(`${ilDay(s.starts_at)}T12:00:00Z`).getUTCDay()]} {ilDate(s.starts_at)}, <span dir="ltr">{ilTime(s.starts_at)}–{ilTime(s.ends_at)}</span>
                        </p>
                        {s.room_name && <p className="flex items-center gap-2 text-slate-600"><DoorOpen className="w-4 h-4" aria-hidden />חדר: {s.room_name}</p>}
                        {s.instructor_name && <p className="flex items-center gap-2 text-slate-600"><UserRound className="w-4 h-4" aria-hidden />{terms.staff}: {s.instructor_name}</p>}
                        <p className="flex items-center gap-2 text-slate-600 tabular-nums"><Users className="w-4 h-4" aria-hidden />רשומים: {s.booked} מתוך {s.capacity}</p>
                        {s.is_course && <p className="flex items-center gap-2 text-slate-600"><GraduationCap className="w-4 h-4" aria-hidden />חלק מקורס</p>}
                        {s.detached && s.status === "scheduled" && <p className="text-xs text-slate-500">השיעור הזה שונה בנפרד — שינויים בשיעור הקבוע לא חלים עליו.</p>}
                        {s.status !== "scheduled" && s.status !== "done" && (
                            <p className="text-sm text-rose-700 bg-rose-50 rounded-xl px-3 py-2">
                                השיעור בוטל{s.cancel_reason ? `: ${s.cancel_reason}` : "."}
                            </p>
                        )}
                    </div>

                    {mode === "view" && (
                        <>
                            <div>
                                <p className="text-xs font-semibold text-slate-500 mb-1.5">{terms.client_plural} רשומים</p>
                                {s.clients && s.clients.length > 0 ? (
                                    <ul className="text-sm text-slate-800 space-y-1">
                                        {s.clients.map(c => <li key={c.id}>{c.full_name}</li>)}
                                    </ul>
                                ) : <p className="text-sm text-slate-400">אין רשומים</p>}
                            </div>
                            {canChange && open && (
                                <div className="flex flex-wrap gap-2 pt-1">
                                    <button type="button" onClick={() => setMode("change")}
                                        className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:border-indigo-400">
                                        <PencilLine className="w-4 h-4" aria-hidden /> שינוי השיעור
                                    </button>
                                    <button type="button" onClick={() => setMode("cancel")}
                                        className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-xl border border-rose-200 text-sm font-semibold text-rose-700 hover:bg-rose-50">
                                        <Ban className="w-4 h-4" aria-hidden /> ביטול השיעור
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                    {mode === "change" && <ChangeForm s={s} rooms={rooms} staff={staff} terms={terms} onBack={() => setMode("view")} onDone={() => done("השיעור עודכן")} />}
                    {mode === "cancel" && <CancelForm s={s} terms={terms} onBack={() => setMode("view")} onDone={() => done("השיעור בוטל")} />}
                </div>
            )}
        </BottomSheet>
    );
}

const field = "w-full min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400";

/** What the server's dry run found — shown before saving. `action` = what happens to the booked clients (empty: the caller asks). */
export function DryRunNotice({ r, terms, action }: { r: DryRun; terms: Terms; action: string }) {
    if (r.clashes.room.length) {
        return (
            <div role="alert" className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-800">
                <p className="font-semibold">החדר תפוס באותה שעה:</p>
                <ul className="mt-1 space-y-0.5">{r.clashes.room.slice(0, 4).map(c => <li key={c.starts_at}>{clashLine(c)}</li>)}</ul>
                {r.clashes.room.length > 4 && <p className="mt-1">ועוד {r.clashes.room.length - 4}</p>}
            </div>
        );
    }
    return (
        <>
            {r.clashes.instructor.length > 0 && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">
                    <p className="flex items-center gap-1.5 font-semibold"><TriangleAlert className="w-4 h-4" aria-hidden />חפיפה ל{terms.staff}:</p>
                    <ul className="mt-1 space-y-0.5">{r.clashes.instructor.slice(0, 4).map(c => <li key={c.kind + c.starts_at}>{clashLine(c)}</li>)}</ul>
                    {r.clashes.instructor.length > 4 && <p className="mt-1">ועוד {r.clashes.instructor.length - 4}</p>}
                </div>
            )}
            {r.booked.clients > 0 && action && (
                <p className="rounded-xl bg-indigo-50 border border-indigo-200 px-3 py-2 text-sm text-indigo-900">
                    {r.booked.clients === 1 ? `${terms.client} אחד/ת רשום/ה` : `${r.booked.clients} ${terms.client_plural} רשומים`} — {action}
                </p>
            )}
        </>
    );
}

function ChangeForm({ s, rooms, staff, terms, onBack, onDone }: {
    s: ClassSession; rooms: Room[]; staff: StaffMember[]; terms: Terms; onBack: () => void; onDone: () => void;
}) {
    const [f, setF] = useState({
        day: ilDay(s.starts_at), start_time: ilTime(s.starts_at),
        duration_minutes: Math.round((new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60000),
        room_id: s.room_id ?? "", instructor_id: s.instructor_id ?? "", capacity: s.capacity,
    });
    const [check, setCheck] = useState<DryRun | null>(null);
    const [busy, setBusy] = useState(false);
    const set = (patch: Partial<typeof f>) => { setF(v => ({ ...v, ...patch })); setCheck(null); };

    const body = (extra: object) => JSON.stringify({
        day: f.day, start_time: f.start_time, duration_minutes: f.duration_minutes, capacity: f.capacity,
        room_id: f.room_id || null, instructor_id: f.instructor_id || null, ...extra,
    });
    const submit = async () => {
        setBusy(true);
        try {
            if (!check) {
                const r = await apiFetch<DryRun>(`/api/classes/sessions/${s.id}`, { method: "PATCH", body: body({ dry_run: true }) });
                if (r.clashes.room.length || r.clashes.instructor.length || r.booked.clients) { setCheck(r); return; }
            }
            await apiFetch(`/api/classes/sessions/${s.id}`, { method: "PATCH", body: body({ confirm_clashes: true }) });
            onDone();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "השמירה נכשלה");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-semibold text-slate-600">תאריך
                    <input type="date" value={f.day} onChange={e => set({ day: e.target.value })} className={`${field} mt-1`} dir="ltr" />
                </label>
                <label className="text-xs font-semibold text-slate-600">שעה
                    <input type="time" value={f.start_time} onChange={e => set({ start_time: e.target.value })} className={`${field} mt-1`} dir="ltr" />
                </label>
                <label className="text-xs font-semibold text-slate-600">משך (דקות)
                    <input type="number" min={5} max={600} value={f.duration_minutes} onChange={e => set({ duration_minutes: Number(e.target.value) })} className={`${field} mt-1 tabular-nums`} dir="ltr" />
                </label>
                <label className="text-xs font-semibold text-slate-600">מקומות
                    <input type="number" min={Math.max(1, s.booked)} max={500} value={f.capacity} onChange={e => set({ capacity: Number(e.target.value) })} className={`${field} mt-1 tabular-nums`} dir="ltr" />
                </label>
                {rooms.length > 0 && (
                    <label className="text-xs font-semibold text-slate-600">חדר
                        <select value={f.room_id} onChange={e => set({ room_id: e.target.value })} className={`${field} mt-1`}>
                            <option value="">בלי חדר</option>
                            {rooms.filter(r => r.is_active || r.id === s.room_id).map(r => <option key={r.id} value={r.id}>{r.name} ({r.capacity})</option>)}
                        </select>
                    </label>
                )}
                <label className="text-xs font-semibold text-slate-600">{terms.staff}
                    <select value={f.instructor_id} onChange={e => set({ instructor_id: e.target.value })} className={`${field} mt-1`}>
                        <option value="">בלי שיבוץ</option>
                        {staff.map(u => <option key={u.id} value={u.id}>{staffName(u)}</option>)}
                    </select>
                </label>
            </div>
            {check && <DryRunNotice r={check} terms={terms} action="יקבלו הודעה על השינוי." />}
            <div className="flex flex-wrap gap-2">
                <button type="button" onClick={submit} disabled={busy || !!check?.clashes.room.length}
                    className="inline-flex items-center gap-2 min-h-11 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-bold">
                    {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                    {check ? (check.booked.clients ? "לשמור ולשלוח הודעה" : "לשמור בכל זאת") : "שמירה"}
                </button>
                <button type="button" onClick={onBack} className="min-h-11 px-4 rounded-xl text-sm text-slate-600 hover:text-slate-900">חזרה</button>
            </div>
        </div>
    );
}

function CancelForm({ s, terms, onBack, onDone }: { s: ClassSession; terms: Terms; onBack: () => void; onDone: () => void }) {
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);
    const cancel = async () => {
        setBusy(true);
        try {
            await apiFetch(`/api/classes/sessions/${s.id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
            onDone();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "הביטול נכשל");
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="space-y-3">
            <p className="text-sm text-slate-700">
                {s.booked > 0
                    ? `${s.booked === 1 ? `${terms.client} אחד/ת רשום/ה` : `${s.booked} ${terms.client_plural} רשומים`} — כולם יקבלו הודעה שהשיעור בוטל.`
                    : "אין רשומים לשיעור הזה."}
            </p>
            <label className="block text-xs font-semibold text-slate-600">סיבה (לא חובה — מצורפת להודעה)
                <textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={300} rows={2}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </label>
            <div className="flex flex-wrap gap-2">
                <button type="button" onClick={cancel} disabled={busy}
                    className="inline-flex items-center gap-2 min-h-11 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white text-sm font-bold">
                    {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                    לבטל את השיעור
                </button>
                <button type="button" onClick={onBack} className="min-h-11 px-4 rounded-xl text-sm text-slate-600 hover:text-slate-900">חזרה</button>
            </div>
        </div>
    );
}
