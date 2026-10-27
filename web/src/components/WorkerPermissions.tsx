"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";

import { tx } from "@/lib/i18n";
// What a regular worker may do beyond their own calendar — the owner's switches, per worker (core/permissions.
// WORKER_PERMISSIONS; the owner, 2026-10-27: "and what about a regular worker?"). In the worker's window on the team
// screen, the owner's only: an existing worker's switch is saved at once; a new worker's are kept here and saved with
// the worker (team/page). The server checks every request.

type Perm = { key: string; label: string; on: boolean };

// as the server has them — for a worker not saved yet
const LABELS: Perm[] = [
    { key: "all_calendars", label: "יומן של כל הצוות — לראות ולקבוע תורים גם אצל אחרים", on: false },
    { key: "payments", label: "גבייה ומקדמות — לרשום תשלום ולאשר מקדמה", on: false },
    { key: "pos", label: "קופה — מכירות בקופה", on: false },
    { key: "clients", label: "לקוחות ולידים — לראות ולטפל", on: false },
];

export default function WorkerPermissions({ userId, name, pending, onPending }: {
    userId: string | null;                                  // a saved worker — switches save at once
    name: string;
    pending: Record<string, boolean>;                       // a new worker's — saved with the worker
    onPending: (next: Record<string, boolean>) => void;
}) {
    const [perms, setPerms] = useState<Perm[] | null>(userId ? null : LABELS.map(p => ({ ...p, on: !!pending[p.key] })));
    const [busy, setBusy] = useState<string | null>(null);

    useEffect(() => {
        if (!userId) return;
        apiFetch<Perm[]>(`/api/users/artists/${userId}/worker-permissions`).then(setPerms).catch(() => setPerms(null));
    }, [userId]);

    const flip = async (p: Perm, on: boolean) => {
        const [what] = tx(p.label).split(" — ");
        if (!userId) {
            onPending({ ...pending, [p.key]: on });
            setPerms(ps => (ps || []).map(x => (x.key === p.key ? { ...x, on } : x)));
            return;
        }
        setBusy(p.key);
        try {
            const next = await apiFetch<Perm[]>(`/api/users/artists/${userId}/worker-permissions`,
                { method: "PUT", body: JSON.stringify({ permissions: { [p.key]: on } }) });
            setPerms(next);
            const who = name || tx("העובד/ת");
            toast.success(on ? tx("{0} יכול/ה עכשיו: {1}", { 0: who, 1: what }) : tx("{0} כבר לא יכול/ה: {1}", { 0: who, 1: what }));
        } catch (e) {
            toast.error((e as Error)?.message || tx("שגיאה"));
        } finally {
            setBusy(null);
        }
    };

    if (!perms) return null;
    return (
        <section className="rounded-2xl border border-slate-200 p-4" aria-labelledby="worker-perms-title">
            <h4 id="worker-perms-title" className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <ShieldCheck className="w-4 h-4 text-sky-600" aria-hidden />
                {name ? tx("מה מותר ל{0}", { 0: name }) : tx("מה מותר לעובד/ת")}
            </h4>
            <p className="text-xs text-slate-500 mt-1">
                {tx("בלי כלום דלוק — רק היומן שלו/ה, הצהרות בריאות, שעון הנוכחות והמשמרות. רק אתה מחליט.")}
            </p>
            <ul className="mt-2 divide-y divide-slate-100">
                {perms.map(p => {
                    const [what, more] = tx(p.label).split(" — ");
                    return (
                        <li key={p.key} className="flex items-center justify-between gap-3 py-2.5">
                            <span id={`wperm-${p.key}`} className="min-w-0">
                                <span className="block text-sm font-semibold text-slate-800">{what}</span>
                                {more && <span className="block text-xs text-slate-500">{more}</span>}
                            </span>
                            <Switch checked={p.on} disabled={busy === p.key} labelledBy={`wperm-${p.key}`} onChange={v => flip(p, v)} />
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
