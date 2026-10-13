"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { apiFetch, getCurrentUserRole } from "@/lib/api";
import { toast } from "@/lib/toast";

// The owner's switches for what a manager (סגן מנהל) may do — the server enforces them (core/permissions.
// MANAGER_PERMISSIONS; the owner, 2026-10-13: "only the owner issues receipts and changes settings"). Owner only.

type Perm = { key: string; label: string; on: boolean };

export default function ManagerPermissions() {
    const [perms, setPerms] = useState<Perm[] | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    useEffect(() => {
        if (getCurrentUserRole() !== "owner") return;
        apiFetch<Perm[]>("/api/users/artists/manager-permissions").then(setPerms).catch(() => setPerms(null));
    }, []);

    const flip = async (p: Perm, on: boolean) => {
        setBusy(p.key);
        try {
            const next = await apiFetch<Perm[]>("/api/users/artists/manager-permissions", { method: "PUT", body: JSON.stringify({ permissions: { [p.key]: on } }) });
            setPerms(next);
            toast.success(on ? `סגן המנהל יכול עכשיו: ${p.label}` : `סגן המנהל כבר לא יכול: ${p.label}`);
        } catch (e) {
            toast.error((e as Error)?.message || "שגיאה");
        } finally {
            setBusy(null);
        }
    };

    if (!perms) return null;
    return (
        <section className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5" aria-labelledby="mgr-perms-title">
            <h2 id="mgr-perms-title" className="flex items-center gap-2 font-bold text-slate-900">
                <ShieldCheck className="w-5 h-5 text-sky-600" aria-hidden /> מה מותר לסגן מנהל
            </h2>
            <p className="text-sm text-slate-500 mt-1">רק אתה מחליט. מה שכבוי — סגן המנהל לא רואה ולא יכול לעשות, גם לא בעקיפין.</p>
            <ul className="mt-3 divide-y divide-slate-100">
                {perms.map(p => (
                    <li key={p.key} className="flex items-center justify-between gap-3 py-2.5">
                        <span id={`perm-${p.key}`} className="text-sm font-semibold text-slate-800">{p.label}</span>
                        <Switch checked={p.on} disabled={busy === p.key} labelledBy={`perm-${p.key}`} onChange={v => flip(p, v)} />
                    </li>
                ))}
            </ul>
        </section>
    );
}
