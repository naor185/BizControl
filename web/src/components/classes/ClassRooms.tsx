"use client";

import { useState } from "react";
import { Plus, Loader2, Check, X, PencilLine } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import type { Room } from "@/lib/classes";

// Rooms: a name and the most people it holds. A room used by a recurring class cannot be taken out of
// use, or made smaller than that class, until the class moves (the server says which classes).

export default function ClassRooms({ rooms, canConfigure, onChange }: {
    rooms: Room[]; canConfigure: boolean; onChange: () => void;
}) {
    const [adding, setAdding] = useState(false);
    const [editing, setEditing] = useState<string | null>(null);

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
                        </div>
                        {canConfigure && (
                            <div className="flex items-center gap-1">
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
