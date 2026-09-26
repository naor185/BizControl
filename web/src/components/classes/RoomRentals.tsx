"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Repeat, Package, X, Loader2 } from "lucide-react";
import BottomSheet from "@/components/ui/bottom-sheet";
import ClientSearch, { type FoundClient } from "@/components/classes/ClientSearch";
import PayForm from "@/components/classes/PayForm";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import type { Terms } from "@/lib/useTerms";
import {
    type Rental, type RentalMonth, type RentalSeries, type Room, DAY_LONG, ilDate, ilDay, ilTime, shekels,
} from "@/lib/classes";

// Renting a room out (app/services/room_rentals.py): the coming rentals (pay, cancel — a late cancel charged by the
// room's rule, waived by the owner or a manager), a new rental, a regular renter's weekly series (the taken dates
// shown first), a package of hours, and the month renter by renter. The server decides every price and rule.

const field = "w-full min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400";
const label = "block text-xs font-semibold text-slate-600";
const DURATIONS = [60, 90, 120, 180];

export default function RoomRentals({ rooms, terms, canOverride }: { rooms: Room[]; terms: Terms; canOverride: boolean }) {
    const renting = rooms.filter(r => r.is_active && r.rental_enabled);
    const [list, setList] = useState<Rental[] | null>(null);
    const [series, setSeries] = useState<RentalSeries[]>([]);
    const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
    const [summary, setSummary] = useState<RentalMonth[] | null>(null);
    const [sheet, setSheet] = useState<"rent" | "series" | "package" | null>(null);
    const [paying, setPaying] = useState<Rental | null>(null);
    const [cancelling, setCancelling] = useState<Rental | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => {
        apiFetch<Rental[]>("/api/classes/rentals").then(setList).catch(() => setList([]));
        apiFetch<RentalSeries[]>("/api/classes/rental-series").then(setSeries).catch(() => setSeries([]));
    }, []);
    const loadMonth = useCallback(() => {
        apiFetch<RentalMonth[]>(`/api/classes/rentals/summary?month=${month}-01`).then(setSummary).catch(() => setSummary([]));
    }, [month]);
    useEffect(() => { load(); }, [load]);
    useEffect(() => { loadMonth(); }, [loadMonth]);
    const refresh = () => { load(); loadMonth(); };

    const post = async (path: string, body: object, ok: string) => {
        setBusy(true);
        try {
            await apiFetch(path, { method: "POST", body: JSON.stringify(body) });
            toast.success(ok);
            refresh();
            return true;
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "הפעולה נכשלה");
            return false;
        } finally {
            setBusy(false);
        }
    };

    if (renting.length === 0) {
        return <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-2xl px-5 py-8 text-center max-w-2xl">
            אף חדר עוד לא מושכר. בלשונית &quot;חדרים&quot; — &quot;השכרה&quot; ליד החדר: מחיר, מינימום שעות, הנחה לשוכר קבוע, חבילת שעות ומדיניות ביטול.
        </p>;
    }
    const days = [...new Set((list ?? []).map(r => ilDay(r.starts_at)))];

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setSheet("rent")} className="inline-flex items-center gap-2 min-h-11 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold">
                    <Plus className="w-4 h-4" aria-hidden /> השכרה חדשה
                </button>
                <button type="button" onClick={() => setSheet("series")} className="inline-flex items-center gap-2 min-h-11 px-4 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:border-indigo-400">
                    <Repeat className="w-4 h-4" aria-hidden /> שוכר/ת קבוע/ה
                </button>
                {renting.some(r => r.rental_package_hours) && (
                    <button type="button" onClick={() => setSheet("package")} className="inline-flex items-center gap-2 min-h-11 px-4 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:border-indigo-400">
                        <Package className="w-4 h-4" aria-hidden /> חבילת שעות
                    </button>
                )}
            </div>

            <section className="space-y-2">
                <h3 className="text-sm font-bold text-slate-800">השבועיים הקרובים</h3>
                {list === null ? <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" aria-label="טוען" /> : list.length === 0 ? (
                    <p className="text-sm text-slate-500">אין השכרות.</p>
                ) : days.map(day => (
                    <div key={day} className="space-y-1">
                        <p className="text-xs font-semibold text-slate-500">יום {DAY_LONG[new Date(`${day}T12:00:00Z`).getUTCDay()]} {ilDate(`${day}T12:00:00Z`)}</p>
                        <ul className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
                            {list.filter(r => ilDay(r.starts_at) === day).map(r => (
                                <li key={r.id} className="px-3 py-2 flex items-center gap-2 min-h-12">
                                    <span dir="ltr" className="text-sm font-bold tabular-nums text-slate-900 w-24 shrink-0 text-right">{ilTime(r.starts_at)}–{ilTime(r.ends_at)}</span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm text-slate-900 truncate">{r.renter} · {r.room_name}</p>
                                        <p className="text-[11px] text-slate-500">
                                            {r.status === "late_canceled" ? `ביטול מאוחר · חיוב ${shekels(r.fee_cents)}` : r.from_package ? "מחבילת השעות" : shekels(r.price_cents)}
                                            {r.series_id ? " · קבוע" : ""}
                                            {r.paid_cents > 0 && <span className="text-emerald-700"> · שולם {shekels(r.paid_cents)}</span>}
                                        </p>
                                    </div>
                                    {r.charge_cents > r.paid_cents && (
                                        <button type="button" onClick={() => { setCancelling(null); setPaying(r); }}
                                            className="min-h-9 px-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shrink-0">תשלום</button>
                                    )}
                                    {r.status === "booked" && (
                                        <button type="button" onClick={() => { setPaying(null); setCancelling(r); }} aria-label={`ביטול ההשכרה של ${r.renter}`}
                                            className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-700 shrink-0">
                                            <X className="w-4 h-4" aria-hidden />
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
                {paying && (
                    <div className="space-y-1 max-w-md">
                        <p className="text-xs font-semibold text-slate-600">תשלום על ההשכרה: {paying.renter}</p>
                        <PayForm defaultAmountCents={paying.charge_cents - paying.paid_cents} busy={busy} onCancel={() => setPaying(null)}
                            onPay={async p => { if (await post(`/api/classes/rentals/${paying.id}/payments`, p, "התשלום נרשם")) setPaying(null); }} />
                    </div>
                )}
                {cancelling && (
                    <CancelRental r={cancelling} canWaive={canOverride} busy={busy} onBack={() => setCancelling(null)}
                        onConfirm={async waive => { if (await post(`/api/classes/rentals/${cancelling.id}/cancel`, { waive }, "ההשכרה בוטלה")) setCancelling(null); }} />
                )}
            </section>

            {series.length > 0 && (
                <section className="space-y-2">
                    <h3 className="text-sm font-bold text-slate-800">שוכרים קבועים</h3>
                    <ul className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 max-w-2xl">
                        {series.map(s => <SeriesRow key={s.id} s={s} room={rooms.find(r => r.id === s.room_id)} busy={busy}
                            onStop={cancelComing => post(`/api/classes/rental-series/${s.id}/stop`, { cancel_coming: cancelComing }, "ההשכרה הקבועה הופסקה")} />)}
                    </ul>
                </section>
            )}

            <section className="space-y-2">
                <div className="flex items-center gap-3">
                    <h3 className="text-sm font-bold text-slate-800">החודש לפי שוכר</h3>
                    <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="min-h-10 rounded-lg border border-slate-200 px-2 text-sm" dir="ltr" />
                </div>
                {summary === null ? null : summary.length === 0 ? <p className="text-sm text-slate-500">אין השכרות בחודש הזה.</p> : (
                    <div className="overflow-x-auto bg-white rounded-xl border border-slate-200">
                        <table className="w-full text-sm text-right">
                            <thead className="bg-slate-50 text-xs text-slate-500">
                                <tr>{["שוכר/ת", "השכרות", "שעות", "חויב", "שולם", "נותר לשלם", "שעות בחבילה"].map(h => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 tabular-nums">
                                {summary.map(x => (
                                    <tr key={x.client_id}>
                                        <td className="px-3 py-2 font-semibold text-slate-900">{x.full_name}</td>
                                        <td className="px-3 py-2">{x.rentals}</td>
                                        <td className="px-3 py-2">{(x.minutes / 60).toLocaleString("he-IL", { maximumFractionDigits: 1 })}</td>
                                        <td className="px-3 py-2">{shekels(x.charged)}</td>
                                        <td className="px-3 py-2 text-emerald-700">{shekels(x.paid)}</td>
                                        <td className={`px-3 py-2 ${x.due > 0 ? "text-rose-700 font-semibold" : "text-slate-400"}`}>{shekels(x.due)}</td>
                                        <td className="px-3 py-2">{x.package_minutes_left ? (x.package_minutes_left / 60).toLocaleString("he-IL", { maximumFractionDigits: 1 }) : "—"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {sheet === "rent" && <RentSheet rooms={renting} terms={terms} onClose={() => setSheet(null)} onDone={() => { setSheet(null); refresh(); }} />}
            {sheet === "series" && <SeriesSheet rooms={renting} terms={terms} onClose={() => setSheet(null)} onDone={() => { setSheet(null); refresh(); }} />}
            {sheet === "package" && <PackageSheet rooms={renting.filter(r => r.rental_package_hours)} terms={terms} onClose={() => setSheet(null)} onDone={() => { setSheet(null); refresh(); }} />}
        </div>
    );
}

function CancelRental({ r, canWaive, busy, onBack, onConfirm }: { r: Rental; canWaive: boolean; busy: boolean; onBack: () => void; onConfirm: (waive: boolean) => void }) {
    const [waive, setWaive] = useState(false);
    return (
        <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3 space-y-2 max-w-md">
            <p className="text-sm text-slate-800">לבטל את ההשכרה של {r.renter} ({r.room_name}, <span dir="ltr">{ilTime(r.starts_at)}</span>)? תישלח הודעה. ביטול מאוחר מחויב לפי כללי החדר.</p>
            {canWaive && (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={waive} onChange={e => setWaive(e.target.checked)} /> בלי חיוב, גם אם מאוחר
                </label>
            )}
            <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => onConfirm(waive)} className="min-h-11 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold disabled:opacity-40">לבטל את ההשכרה</button>
                <button type="button" onClick={onBack} className="min-h-11 px-3 text-sm text-slate-600">חזרה</button>
            </div>
        </div>
    );
}

function SeriesRow({ s, room, busy, onStop }: { s: RentalSeries; room?: Room; busy: boolean; onStop: (cancelComing: boolean) => Promise<boolean> }) {
    const [stopping, setStopping] = useState(false);
    const [cancelComing, setCancelComing] = useState(false);
    return (
        <li className="px-3 py-2 space-y-2">
            <div className="flex items-center gap-2 min-h-10">
                <p className="flex-1 text-sm text-slate-900">
                    {s.renter} · {room?.name ?? ""} · יום {DAY_LONG[s.weekday]} <span dir="ltr">{s.start_time}</span> · {s.duration_minutes / 60} שעות
                    {s.ends_on ? ` · עד ${ilDate(`${s.ends_on}T12:00:00Z`)}` : ""}
                </p>
                {!stopping && <button type="button" onClick={() => setStopping(true)} className="min-h-9 px-2 text-xs font-semibold text-rose-700">הפסקה</button>}
            </div>
            {stopping && (
                <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-xs text-slate-700">
                        <input type="checkbox" checked={cancelComing} onChange={e => setCancelComing(e.target.checked)} /> לבטל גם את ההשכרות הקרובות (בלי חיוב)
                    </label>
                    <button type="button" disabled={busy} onClick={async () => { if (await onStop(cancelComing)) setStopping(false); }}
                        className="min-h-9 px-3 rounded-lg bg-rose-600 text-white text-xs font-bold">להפסיק</button>
                    <button type="button" onClick={() => setStopping(false)} className="min-h-9 px-2 text-xs text-slate-600">חזרה</button>
                </div>
            )}
        </li>
    );
}

function RenterPick({ terms, who, setWho }: { terms: Terms; who: FoundClient | null; setWho: (c: FoundClient | null) => void }) {
    return who ? (
        <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 min-h-11">
            <span className="text-sm font-semibold text-slate-900">{who.full_name}</span>
            <button type="button" onClick={() => setWho(null)} aria-label="החלפת השוכר/ת" className="w-9 h-9 flex items-center justify-center text-slate-400"><X className="w-4 h-4" aria-hidden /></button>
        </div>
    ) : (
        <div>
            <p className={label}>השוכר/ת (מתוך {terms.client_plural} — אפשר להוסיף חדש/ה במסך {terms.client_plural})</p>
            <div className="mt-1"><ClientSearch terms={terms} onPick={setWho} /></div>
        </div>
    );
}

function RoomPick({ rooms, roomId, setRoomId }: { rooms: Room[]; roomId: string; setRoomId: (id: string) => void }) {
    return (
        <label className={label}>חדר
            <select value={roomId} onChange={e => setRoomId(e.target.value)} className={`${field} mt-1`}>
                {rooms.map(r => <option key={r.id} value={r.id}>{r.name} — {r.rental_pricing === "per_booking" ? `${shekels(r.rental_booking_cents)} להזמנה` : `${shekels(r.rental_hour_cents)} לשעה`}</option>)}
            </select>
        </label>
    );
}

function Duration({ minutes, setMinutes }: { minutes: number; setMinutes: (m: number) => void }) {
    return (
        <div>
            <p className={label}>משך</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
                {DURATIONS.map(m => (
                    <button key={m} type="button" aria-pressed={minutes === m} onClick={() => setMinutes(m)}
                        className={`min-h-10 px-3 rounded-xl border text-sm ${minutes === m ? "border-indigo-500 bg-indigo-50 text-indigo-800 font-semibold" : "border-slate-200 text-slate-700"}`}>
                        {m === 60 ? "שעה" : `${m / 60} שעות`}
                    </button>
                ))}
                <input type="number" min={15} step={15} value={minutes} dir="ltr" aria-label="דקות" onChange={e => setMinutes(Number(e.target.value) || 60)}
                    className="w-20 min-h-10 rounded-lg border border-slate-200 text-center tabular-nums" />
                <span className="text-xs text-slate-500">דקות</span>
            </div>
        </div>
    );
}

function RentSheet({ rooms, terms, onClose, onDone }: { rooms: Room[]; terms: Terms; onClose: () => void; onDone: () => void }) {
    const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
    const [who, setWho] = useState<FoundClient | null>(null);
    const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
    const [start, setStart] = useState("10:00");
    const [minutes, setMinutes] = useState(60);
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);
    const save = async () => {
        if (!who) return;
        setBusy(true);
        try {
            await apiFetch("/api/classes/rentals", { method: "POST", body: JSON.stringify({ room_id: roomId, client_id: who.id, day, start_time: start, duration_minutes: minutes, note: note.trim() || null }) });
            toast.success("החדר הושכר — נשלח אישור לשוכר/ת");
            onDone();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "ההשכרה נכשלה");
        } finally {
            setBusy(false);
        }
    };
    return (
        <BottomSheet open onClose={onClose} title="השכרה חדשה" className="sm:max-w-lg"
            footer={<button type="button" onClick={save} disabled={busy || !who} className="w-full min-h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-bold">השכרה</button>}>
            <div className="px-5 py-4 space-y-4 overflow-y-auto min-h-0">
                <RenterPick terms={terms} who={who} setWho={setWho} />
                <RoomPick rooms={rooms} roomId={roomId} setRoomId={setRoomId} />
                <div className="grid grid-cols-2 gap-3">
                    <label className={label}>תאריך<input type="date" value={day} onChange={e => setDay(e.target.value)} className={`${field} mt-1`} dir="ltr" /></label>
                    <label className={label}>משעה<input type="time" value={start} onChange={e => setStart(e.target.value)} className={`${field} mt-1`} dir="ltr" /></label>
                </div>
                <Duration minutes={minutes} setMinutes={setMinutes} />
                <label className={label}>הערה<input value={note} onChange={e => setNote(e.target.value)} maxLength={300} className={`${field} mt-1`} /></label>
                <p className="text-xs text-slate-500">המחיר לפי כללי החדר (ומחבילת השעות של השוכר/ת, אם יש). חדר תפוס — המערכת תגיד עם מה.</p>
            </div>
        </BottomSheet>
    );
}

function SeriesSheet({ rooms, terms, onClose, onDone }: { rooms: Room[]; terms: Terms; onClose: () => void; onDone: () => void }) {
    const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
    const [who, setWho] = useState<FoundClient | null>(null);
    const [weekday, setWeekday] = useState(2);
    const [start, setStart] = useState("10:00");
    const [minutes, setMinutes] = useState(120);
    const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
    const [until, setUntil] = useState("");
    const [taken, setTaken] = useState<string[] | null>(null);
    const [busy, setBusy] = useState(false);
    const body = (dry: boolean) => JSON.stringify({ room_id: roomId, client_id: who?.id, weekday, start_time: start, duration_minutes: minutes,
        starts_on: from, ends_on: until || null, dry_run: dry });
    const run = async () => {
        if (!who) return;
        setBusy(true);
        try {
            if (taken === null) {
                setTaken((await apiFetch<{ taken: string[] }>("/api/classes/rental-series", { method: "POST", body: body(true) })).taken);
            } else {
                const r = await apiFetch<{ made: number; skipped: string[] }>("/api/classes/rental-series", { method: "POST", body: body(false) });
                toast.success(`נקבעו ${r.made} השכרות${r.skipped.length ? ` — ${r.skipped.length} תאריכים דולגו (החדר תפוס)` : ""}`);
                onDone();
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "הפעולה נכשלה");
        } finally {
            setBusy(false);
        }
    };
    const reset = () => setTaken(null);
    return (
        <BottomSheet open onClose={onClose} title="שוכר/ת קבוע/ה — כל שבוע" className="sm:max-w-lg"
            footer={<button type="button" onClick={run} disabled={busy || !who} className="w-full min-h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-bold">
                {taken === null ? "בדיקת תאריכים" : "לקבוע את ההשכרות"}</button>}>
            <div className="px-5 py-4 space-y-4 overflow-y-auto min-h-0">
                <RenterPick terms={terms} who={who} setWho={c => { setWho(c); reset(); }} />
                <RoomPick rooms={rooms} roomId={roomId} setRoomId={id => { setRoomId(id); reset(); }} />
                <div>
                    <p className={label}>יום בשבוע</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                        {DAY_LONG.map((d, i) => (
                            <button key={d} type="button" aria-pressed={weekday === i} onClick={() => { setWeekday(i); reset(); }}
                                className={`min-h-10 px-3 rounded-xl border text-sm ${weekday === i ? "border-indigo-500 bg-indigo-50 text-indigo-800 font-semibold" : "border-slate-200 text-slate-700"}`}>{d}</button>
                        ))}
                    </div>
                </div>
                <label className={label}>משעה<input type="time" value={start} onChange={e => { setStart(e.target.value); reset(); }} className={`${field} mt-1 w-40`} dir="ltr" /></label>
                <Duration minutes={minutes} setMinutes={m => { setMinutes(m); reset(); }} />
                <div className="grid grid-cols-2 gap-3">
                    <label className={label}>מתאריך<input type="date" value={from} onChange={e => { setFrom(e.target.value); reset(); }} className={`${field} mt-1`} dir="ltr" /></label>
                    <label className={label}>עד תאריך (לא חובה)<input type="date" value={until} onChange={e => { setUntil(e.target.value); reset(); }} className={`${field} mt-1`} dir="ltr" /></label>
                </div>
                {taken !== null && (
                    <p className={`text-sm rounded-xl px-3 py-2 ${taken.length ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}>
                        {taken.length ? `החדר תפוס בתאריכים: ${taken.map(d => ilDate(`${d}T12:00:00Z`)).join(", ")} — הם ידולגו.` : "החדר פנוי בכל השבועות הקרובים."}
                    </p>
                )}
                <p className="text-xs text-slate-500">ההשכרות נקבעות מראש לשבועות הקרובים ומתחדשות לבד, במחיר עם ההנחה לשוכר קבוע שבכללי החדר.</p>
            </div>
        </BottomSheet>
    );
}

function PackageSheet({ rooms, terms, onClose, onDone }: { rooms: Room[]; terms: Terms; onClose: () => void; onDone: () => void }) {
    const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
    const [who, setWho] = useState<FoundClient | null>(null);
    const [sold, setSold] = useState<{ id: string; price_cents: number } | null>(null);
    const [busy, setBusy] = useState(false);
    const room = rooms.find(r => r.id === roomId);
    const sell = async () => {
        if (!who) return;
        setBusy(true);
        try {
            setSold(await apiFetch<{ id: string; price_cents: number }>("/api/classes/rental-packages", { method: "POST", body: JSON.stringify({ room_id: roomId, client_id: who.id }) }));
            toast.success("החבילה נמכרה");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "המכירה נכשלה");
        } finally {
            setBusy(false);
        }
    };
    const pay = async (p: { amount_cents: number; method: string; send_receipt: boolean }) => {
        if (!sold) return;
        setBusy(true);
        try {
            await apiFetch(`/api/classes/rental-packages/${sold.id}/payments`, { method: "POST", body: JSON.stringify(p) });
            toast.success("התשלום נרשם");
            onDone();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "הפעולה נכשלה");
        } finally {
            setBusy(false);
        }
    };
    return (
        <BottomSheet open onClose={sold ? onDone : onClose} title="חבילת שעות" className="sm:max-w-lg"
            footer={sold ? undefined : <button type="button" onClick={sell} disabled={busy || !who} className="w-full min-h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-bold">
                {room ? `מכירה: ${room.rental_package_hours} שעות ב-${shekels(room.rental_package_cents)}` : "מכירה"}</button>}>
            <div className="px-5 py-4 space-y-4 overflow-y-auto min-h-0">
                {sold ? (
                    <>
                        <p className="text-sm text-slate-700">החבילה של {who?.full_name} נמכרה. ההשכרות שלו/ה בחדר הזה יורדות ממנה לפני כל מחיר.</p>
                        <PayForm defaultAmountCents={sold.price_cents} busy={busy} onCancel={onDone} onPay={pay} />
                    </>
                ) : (
                    <>
                        <RenterPick terms={terms} who={who} setWho={setWho} />
                        <label className={label}>חדר
                            <select value={roomId} onChange={e => setRoomId(e.target.value)} className={`${field} mt-1`}>
                                {rooms.map(r => <option key={r.id} value={r.id}>{r.name} — {r.rental_package_hours} שעות ב-{shekels(r.rental_package_cents)}</option>)}
                            </select>
                        </label>
                    </>
                )}
            </div>
        </BottomSheet>
    );
}
