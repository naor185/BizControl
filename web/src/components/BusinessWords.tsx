"use client";

import { useEffect, useState } from "react";
import { Type } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { refreshTerms } from "@/lib/useTerms";
import { toast } from "@/lib/toast";

type TermsResponse = {
    terms: Record<string, string>;    // what the business uses now
    field: Record<string, string>;    // its field's words
    own: Record<string, string>;      // what the owner changed
    labels: Record<string, string>;   // the question next to each word, in order
};

// "המילים של העסק": the owner sees their field's words and can change any of them for their own
// business. An empty field goes back to the field's word. Everything here comes from the server.
export default function BusinessWords({ reloadKey }: { reloadKey?: string }) {
    const [data, setData] = useState<TermsResponse | null>(null);
    const [own, setOwn] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        apiFetch<TermsResponse>("/api/studio/upload/terms")
            .then(d => { setData(d); setOwn(d.own); })
            .catch(() => setData(null));
    }, [reloadKey]);

    if (!data) return null;
    const keys = Object.keys(data.labels);

    const save = async () => {
        setSaving(true);
        try {
            const d = await apiFetch<TermsResponse>("/api/studio/upload/terms", {
                method: "PATCH",
                body: JSON.stringify({ own: Object.fromEntries(keys.map(k => [k, own[k] ?? ""])) }),
            });
            setData(d);
            setOwn(d.own);
            refreshTerms();
            toast.success("המילים נשמרו");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "השמירה נכשלה");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <h3 className="text-lg font-bold text-slate-800 mb-1 flex items-center gap-2">
                <Type className="h-5 w-5 text-violet-600" /> המילים של העסק
            </h3>
            <p className="text-sm text-slate-500 mb-4">
                המערכת משתמשת במילים של התחום שלך במסכים ובהודעות. אפשר לשנות כל מילה לעסק שלך — שדה ריק חוזר למילה של התחום.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
                {keys.map(k => (
                    <div key={k}>
                        <label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor={`term-${k}`}>{data.labels[k]}</label>
                        <input
                            id={`term-${k}`}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-400"
                            value={own[k] ?? ""}
                            placeholder={data.field[k]}
                            maxLength={30}
                            onChange={e => setOwn({ ...own, [k]: e.target.value })}
                        />
                    </div>
                ))}
            </div>
            <button
                type="button"
                onClick={save}
                disabled={saving}
                className="mt-4 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold disabled:opacity-50"
            >
                {saving ? "שומר..." : "שמירת המילים"}
            </button>
        </div>
    );
}
