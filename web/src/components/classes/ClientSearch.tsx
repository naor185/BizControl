"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { Terms } from "@/lib/useTerms";

// Find a client by name or phone (GET /api/clients?q=). Shared by booking a client into a class and by
// selling a membership. `note(id)` may disable a client with a reason (e.g. "ברשימה").

export type FoundClient = { id: string; full_name: string; phone: string | null };

export default function ClientSearch({ terms, onPick, note, busy }: {
    terms: Terms; onPick: (c: FoundClient) => void; note?: (id: string) => string | null; busy?: boolean;
}) {
    const [q, setQ] = useState("");
    const [found, setFound] = useState<FoundClient[]>([]);

    useEffect(() => {
        const term = q.trim();
        const t = setTimeout(() => {
            if (term.length < 2) { setFound([]); return; }
            apiFetch<FoundClient[]>(`/api/clients?q=${encodeURIComponent(term)}&limit=8`).then(setFound).catch(() => setFound([]));
        }, 250);
        return () => clearTimeout(t);
    }, [q]);

    return (
        <div className="space-y-2">
            <label className="relative block">
                <span className="sr-only">חיפוש {terms.client}</span>
                <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 right-3" aria-hidden />
                <input value={q} onChange={e => setQ(e.target.value)} autoFocus placeholder={`${terms.client}: שם או טלפון`}
                    className="w-full min-h-11 rounded-xl border border-slate-200 pr-9 pl-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </label>
            <ul className="max-h-56 overflow-y-auto">
                {found.map(c => {
                    const why = note?.(c.id) ?? null;
                    return (
                        <li key={c.id}>
                            <button type="button" disabled={busy || !!why} onClick={() => { onPick(c); setQ(""); setFound([]); }}
                                className="w-full flex items-center justify-between gap-2 px-2 min-h-11 rounded-lg text-right hover:bg-slate-50 disabled:opacity-50">
                                <span className="text-sm text-slate-900 truncate">{c.full_name}</span>
                                <span className="text-xs text-slate-500 tabular-nums" dir="ltr">{why ?? c.phone}</span>
                            </button>
                        </li>
                    );
                })}
                {q.trim().length >= 2 && found.length === 0 && <li className="px-2 py-2 text-sm text-slate-400">לא נמצאו</li>}
            </ul>
        </div>
    );
}
