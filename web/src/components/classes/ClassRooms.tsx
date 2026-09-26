"use client";

import { useState } from "react";
import { Plus, Loader2, Check, X, PencilLine, KeyRound } from "lucide-react";
import BottomSheet from "@/components/ui/bottom-sheet";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import { type Room, shekels } from "@/lib/classes";

// Rooms: a name and the most people it holds, and — when rented out — the owner's rental rules. A room used by
// a recurring class cannot be taken out of use, or made smaller than that class, until the class moves (the
// server says which classes).

export default function ClassRooms({ rooms, canConfigure, onChange }: {
    rooms: Room[]; canConfigure: boolean; onChange: () => void;
}) {
    const [adding, setAdding] = useState(false);
    const [editing, setEditing] = useState<string | null>(null);
    const [renting, setRenting] = useState<Room | null>(null);

    return (
        <div className="space-y-3 max-w-2xl">
            <ul className="bg-white rounded-2xl border border-slate-200/70 divide-y divide-slate-100">
                {rooms.length === 0 && !adding && <li className="px-5 py-6 text-sm text-slate-500 text-center">עוד אין חדרים.</li>}
                {rooms.map(r => editing === r.id ? (
                    <li key={r.id} className="px-4 py-3">
                        <RoomForm room={r} onDone={() => { setEditing(null); onChange(); }} onCancel={() => setEditing(null)} />
                    </li>
                ) : (
                    <li key={r.id} className="px-5 py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <p className={`text-sm font-semibold ${r.is_active ? "text-slate-900" : "text-slate-400 line-through"}`}>{r.name}</p>
                            <p className="text-xs text-slate-500 tabular-nums">{r.capacity} מקומות{r.is_active ? "" : " · לא בשימוש"}</p>
                            {r.rental_enabled && (
                                <p className="text-xs text-violet-800 tabular-nums">מושכר · {r.rental_pricing === "per_booking" ? `${shekels(r.rental_booking_cents)} להזמנה` : `${shekels(r.rental_hour_cents)} לשעה`}</p>
                            )}
                        </div>
                        {canConfigure && (
                            <div className="flex items-center gap-1">
                                <button type="button" onClick={() => setRenting(r)} aria-label={`השכרה של ${r.name}`} title="השכרת החדר"
                                    className="inline-flex items-center gap-1 min-h-11 px-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-violet-700">
                                    <KeyRound className="w-4 h-4" aria-hidden /> השכרה
                                </button>
                                <button type="button" onClick={() => setEditing(r.id)} aria-label={`עריכת ${r.name}`}
                                    className="w-11 h-11 flex items-center justify-center rounded-xl text-slate-500 hover:text-indigo-700">
                                    <PencilLine className="w-4 h-4" aria-hidden />
                                </button>
                                <ActiveToggle room={r} onDone={onChange} />
                            </div>
                        )}
                    </li>
                ))}
                {adding && (
                    <li className="px-4 py-3">
                        <RoomForm onDone={() => { setAdding(false); onChange(); }} onCancel={() => setAdding(false)} />
                    </li>
                )}
            </ul>
            {renting && <RentalRules room={renting} onClose={() => setRenting(null)} onSaved={() => { setRenting(null); onChange(); }} />}
            {canConfigure && !adding && (
                <button type="button" onClick={() => setAdding(true)}
                    className="inline-flex items-center gap-2 min-h-11 px-4 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:border-indigo-400">
                    <Plus className="w-4 h-4" aria-hidden /> חדר חדש
                </button>
            )}
        </div>
    );
}

function RoomForm({ room, onDone, onCancel }: { room?: Room; onDone: () => void; onCancel: () => void }) {
    const [name, setName] = useState(room?.name ?? "");
    const [capacity, setCapacity] = useState<number | "">(room?.capacity ?? "");
    const [busy, setBusy] = useState(false);
    const save = async () => {
        setBusy(true);
        try {
            await apiFetch(room ? `/api/classes/rooms/${room.id}` : "/api/classes/rooms", {
                method: room ? "PATCH" : "POST", body: JSON.stringify({ name: name.trim(), capacity }),
            });
            toast.success(room ? "החדר עודכן" : "החדר נוסף");
            onDone();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "השמירה נכשלה");
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="flex flex-wrap items-end gap-2">
            <label className="flex-1 min-w-[10rem] text-xs font-semibold text-slate-600">שם החדר
                <input value={name} onChange={e => setName(e.target.value)} maxLength={120} autoFocus placeholder="סטודיו א"
                    className="mt-1 w-full min-h-11 rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </label>
            <label className="w-24 text-xs font-semibold text-slate-600">מקומות
                <input type="number" min={1} max={500} value={capacity} dir="ltr"
                    onChange={e => setCapacity(e.target.value === "" ? "" : Number(e.target.value))}
                    className="mt-1 w-full min-h-11 rounded-xl border border-slate-200 px-3 text-sm text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </label>
            <button type="button" onClick={save} disabled={busy || !name.trim() || capacity === "" || capacity < 1} aria-label="שמירה"
                className="w-11 h-11 flex items-center justify-center rounded-xl bg-indigo-600 text-white disabled:opacity-40">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Check className="w-4 h-4" aria-hidden />}
            </button>
            <button type="button" onClick={onCancel} aria-label="ביטול"
                className="w-11 h-11 flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-800">
                <X className="w-4 h-4" aria-hidden />
            </button>
        </div>
    );
}

function ActiveToggle({ room, onDone }: { room: Room; onDone: () => void }) {
    const [busy, setBusy] = useState(false);
    const flip = async () => {
        setBusy(true);
        try {
            await apiFetch(`/api/classes/rooms/${room.id}`, { method: "PATCH", body: JSON.stringify({ is_active: !room.is_active }) });
            onDone();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "הפעולה נכשלה");
        } finally {
            setBusy(false);
        }
    };
    return (
        <button type="button" role="switch" aria-checked={room.is_active} aria-label={`${room.name} בשימוש`} onClick={flip} disabled={busy}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-60 ${room.is_active ? "bg-indigo-600" : "bg-slate-300"}`}>
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${room.is_active ? "-translate-x-6" : "-translate-x-1"}`} />
        </button>
    );
}

const pick = (on: boolean) => `min-h-10 px-3 rounded-xl border text-sm ${on ? "border-indigo-500 bg-indigo-50 text-indigo-800 font-semibold" : "border-slate-200 text-slate-700"}`;
const num = "block mt-1 w-28 min-h-10 rounded-lg border border-slate-200 text-center tabular-nums";
const lbl = "block text-xs font-semibold text-slate-600";

/** The owner's rules for renting the room out: the price, the shortest rental, a regular renter's discount, a
 *  package of hours, and cancelling. */
function RentalRules({ room, onClose, onSaved }: { room: Room; onClose: () => void; onSaved: () => void }) {
    const [f, setF] = useState({
        rental_enabled: room.rental_enabled || !room.rental_hour_cents, rental_pricing: room.rental_pricing,
        hour: room.rental_hour_cents / 100 || "" as number | "", booking: room.rental_booking_cents / 100 || "" as number | "",
        rental_min_minutes: room.rental_min_minutes, rental_series_discount_percent: room.rental_series_discount_percent,
        package_hours: room.rental_package_hours ?? ("" as number | ""), package_price: room.rental_package_cents / 100 || "" as number | "",
        rental_free_cancel_hours: room.rental_free_cancel_hours, rental_late_fee: room.rental_late_fee,
    });
    const [busy, setBusy] = useState(false);
    const set = (p: Partial<typeof f>) => setF(v => ({ ...v, ...p }));
    const save = async () => {
        setBusy(true);
        try {
            await apiFetch(`/api/classes/rooms/${room.id}`, { method: "PATCH", body: JSON.stringify({
                rental_enabled: f.rental_enabled, rental_pricing: f.rental_pricing,
                rental_hour_cents: f.hour === "" ? 0 : Math.round(f.hour * 100), rental_booking_cents: f.booking === "" ? 0 : Math.round(f.booking * 100),
                rental_min_minutes: f.rental_min_minutes, rental_series_discount_percent: f.rental_series_discount_percent,
                rental_package_hours: f.package_hours === "" ? 0 : f.package_hours,
                rental_package_cents: f.package_price === "" ? 0 : Math.round(f.package_price * 100),
                rental_free_cancel_hours: f.rental_free_cancel_hours, rental_late_fee: f.rental_late_fee,
            }) });
            toast.success("כללי ההשכרה נשמרו");
            onSaved();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "השמירה נכשלה");
        } finally {
            setBusy(false);
        }
    };
    return (
        <BottomSheet open onClose={onClose} title={`השכרת ${room.name}`} className="sm:max-w-lg"
            footer={<button type="button" onClick={save} disabled={busy} className="w-full min-h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-bold">שמירה</button>}>
            <div className="px-5 py-4 space-y-4 overflow-y-auto min-h-0 text-sm">
                <label className="flex items-center gap-2 text-slate-800">
                    <input type="checkbox" checked={f.rental_enabled} onChange={e => set({ rental_enabled: e.target.checked })} /> החדר מושכר לחוץ
                </label>
                {f.rental_enabled && (
                    <>
                        <div>
                            <p className={lbl}>המחיר</p>
                            <div className="mt-1 flex flex-wrap gap-2">
                                {([["hourly", "לפי שעה"], ["per_booking", "מחיר קבוע להזמנה"]] as const).map(([v, t]) => (
                                    <button key={v} type="button" aria-pressed={f.rental_pricing === v} onClick={() => set({ rental_pricing: v })} className={pick(f.rental_pricing === v)}>{t}</button>
                                ))}
                            </div>
                            {f.rental_pricing === "hourly" ? (
                                <label className="block mt-2 text-xs text-slate-600">מחיר לשעה (₪)
                                    <input type="number" min={0} dir="ltr" value={f.hour} onChange={e => set({ hour: e.target.value === "" ? "" : Number(e.target.value) })} className={num} /></label>
                            ) : (
                                <label className="block mt-2 text-xs text-slate-600">מחיר להזמנה (₪)
                                    <input type="number" min={0} dir="ltr" value={f.booking} onChange={e => set({ booking: e.target.value === "" ? "" : Number(e.target.value) })} className={num} /></label>
                            )}
                        </div>
                        <div>
                            <p className={lbl}>השכרה לפחות</p>
                            <div className="mt-1 flex flex-wrap gap-2">
                                {[30, 60, 90, 120].map(m => <button key={m} type="button" aria-pressed={f.rental_min_minutes === m} onClick={() => set({ rental_min_minutes: m })} className={pick(f.rental_min_minutes === m)}>{m} דק׳</button>)}
                                <input type="number" min={15} max={720} dir="ltr" aria-label="דקות" value={f.rental_min_minutes} onChange={e => set({ rental_min_minutes: Number(e.target.value) || 60 })} className="w-20 min-h-10 rounded-lg border border-slate-200 text-center tabular-nums" />
                            </div>
                        </div>
                        <div>
                            <p className={lbl}>הנחה לשוכר/ת קבוע/ה (כל שבוע)</p>
                            <div className="mt-1 flex flex-wrap gap-2">
                                {[0, 10, 15, 20].map(p => <button key={p} type="button" aria-pressed={f.rental_series_discount_percent === p} onClick={() => set({ rental_series_discount_percent: p })} className={pick(f.rental_series_discount_percent === p)}>{p ? `${p}%` : "בלי"}</button>)}
                                <input type="number" min={0} max={100} dir="ltr" aria-label="אחוז" value={f.rental_series_discount_percent} onChange={e => set({ rental_series_discount_percent: Math.min(100, Number(e.target.value) || 0) })} className="w-20 min-h-10 rounded-lg border border-slate-200 text-center tabular-nums" />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <label className="text-xs text-slate-600">חבילת שעות — כמה שעות (ריק = אין)
                                <input type="number" min={0} dir="ltr" value={f.package_hours} placeholder="10" onChange={e => set({ package_hours: e.target.value === "" ? "" : Number(e.target.value) })} className={num} /></label>
                            <label className="text-xs text-slate-600">מחיר החבילה (₪)
                                <input type="number" min={0} dir="ltr" value={f.package_price} onChange={e => set({ package_price: e.target.value === "" ? "" : Number(e.target.value) })} className={num} /></label>
                        </div>
                        <div>
                            <p className={lbl}>ביטול בחינם עד</p>
                            <div className="mt-1 flex flex-wrap gap-2">
                                {[12, 24, 48, 72].map(hh => <button key={hh} type="button" aria-pressed={f.rental_free_cancel_hours === hh} onClick={() => set({ rental_free_cancel_hours: hh })} className={pick(f.rental_free_cancel_hours === hh)}>{hh} שעות לפני</button>)}
                            </div>
                            <p className={`${lbl} mt-3`}>ביטול מאוחר יותר</p>
                            <div className="mt-1 flex flex-wrap gap-2">
                                {([["full", "חיוב מלא"], ["half", "חצי"], ["none", "בלי חיוב"]] as const).map(([v, t]) => (
                                    <button key={v} type="button" aria-pressed={f.rental_late_fee === v} onClick={() => set({ rental_late_fee: v })} className={pick(f.rental_late_fee === v)}>{t}</button>
                                ))}
                            </div>
                            <p className="text-xs text-slate-500 mt-1">מחבילת שעות — השעות נשארות מנוצלות, חצי מהן או חוזרות, באותו כלל.</p>
                        </div>
                    </>
                )}
            </div>
        </BottomSheet>
    );
}
