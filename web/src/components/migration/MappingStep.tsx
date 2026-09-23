"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleHelp, Loader2, ShieldAlert } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import type { ColumnSuggestion, MigrationDetail, MigrationOptions } from "./types";

const DATE_ORDER_LABELS: Record<string, string> = { DMY: "יום/חודש/שנה (12/03/1990)", MDY: "חודש/יום/שנה (03/12/1990)", YMD: "שנה-חודש-יום (1990-03-12)" };

function ConfidenceBadge({ c, target }: { c: ColumnSuggestion; target: string }) {
    if (!target) return <span className="text-xs text-slate-400">לא ייובא</span>;
    if (target !== c.target) return <span className="text-xs text-slate-500">נבחר ידנית</span>;
    if (c.status === "auto") return <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />זוהה</span>;
    return <span className="inline-flex items-center gap-1 text-xs text-amber-700"><CircleHelp className="h-3.5 w-3.5" />לבדיקה</span>;
}

// Which column of the file goes to which field. Suggestions come from the server; every one can be changed.
export default function MappingStep({ m, onSaved }: { m: MigrationDetail; onSaved: (m: MigrationDetail) => void }) {
    const [mapping, setMapping] = useState<Record<number, string>>(() => {
        const out: Record<number, string> = {};
        for (const [k, v] of Object.entries(m.mapping)) out[Number(k)] = v;
        return out;
    });
    const [options, setOptions] = useState<MigrationOptions>(m.options);
    const [saving, setSaving] = useState(false);

    const fieldByKey = useMemo(() => Object.fromEntries(m.fields.map(f => [f.key, f])), [m.fields]);
    const used = Object.values(mapping).filter(Boolean);
    const duplicate = m.fields.filter(f => !f.multi && used.filter(t => t === f.key).length > 1);
    const hasName = m.entity_type === "clients"
        ? used.some(t => ["full_name", "first_name", "last_name"].includes(t))
        : used.includes("name");
    const hasDate = used.some(t => ["date", "datetime"].includes(fieldByKey[t]?.kind));
    const review = m.suggestions.filter(c => mapping[c.index] && mapping[c.index] === c.target && c.status === "review");
    const dateAmbiguous = m.suggestions.some(c => mapping[c.index] && fieldByKey[mapping[c.index]]?.kind?.startsWith("date") && c.date_order === null);

    async function save() {
        setSaving(true);
        try {
            const body = { mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)), options };
            onSaved(await apiFetch<MigrationDetail>(`/api/migrations/${m.id}/mapping`, { method: "PUT", body: JSON.stringify(body) }));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "השמירה נכשלה");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="space-y-5">
            {m.dropped.length > 0 && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 flex gap-3 text-sm text-rose-800">
                    <ShieldAlert className="h-5 w-5 shrink-0" />
                    <div>
                        <div className="font-semibold">עמודות שלא נשמרו ולא ייובאו</div>
                        <ul className="mt-1 space-y-0.5">
                            {m.dropped.map(d => <li key={d.column}>&quot;{d.column}&quot; — {d.reason}</li>)}
                        </ul>
                        <div className="mt-1 text-rose-700">פרטי אמצעי תשלום לא מועברים בייבוא. לקוחות שמשלמים בכרטיס יצטרכו להזין אותו מחדש.</div>
                    </div>
                </div>
            )}

            <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100">
                    <h2 className="font-bold text-slate-800 text-sm">איזו עמודה בקובץ הולכת לאיזה שדה</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                        {m.headers.length} עמודות · {m.row_count} שורות. מה ש&quot;זוהה&quot; מולא אוטומטית; מה ש&quot;לבדיקה&quot; מולא אבל כדאי לוודא. עמודה שלא תמפה לא תיובא.
                    </p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                        <thead className="bg-slate-50 text-slate-500 text-xs">
                            <tr>
                                <th className="text-right font-semibold px-4 py-2">עמודה בקובץ</th>
                                <th className="text-right font-semibold px-4 py-2">דוגמאות</th>
                                <th className="text-right font-semibold px-4 py-2">שדה ב-BizControl</th>
                                <th className="text-right font-semibold px-4 py-2 whitespace-nowrap">זיהוי</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {m.suggestions.map(c => {
                                const target = mapping[c.index] || "";
                                const f = fieldByKey[target];
                                return (
                                    <tr key={c.index} className={c.status === "empty" ? "opacity-50" : ""}>
                                        <td className="px-4 py-2.5 font-semibold text-slate-800 whitespace-nowrap">{c.column}</td>
                                        <td className="px-4 py-2.5 text-slate-500 max-w-[16rem]">
                                            <div className="truncate" title={c.samples.filter(Boolean).join(" · ")}>{c.samples.filter(Boolean).join(" · ") || "ריקה"}</div>
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <select
                                                value={target}
                                                disabled={c.status === "empty"}
                                                onChange={e => setMapping(prev => ({ ...prev, [c.index]: e.target.value }))}
                                                className="w-full min-w-[10rem] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                                            >
                                                <option value="">לא לייבא</option>
                                                {m.fields.map(fd => <option key={fd.key} value={fd.key}>{fd.label}{fd.required ? " *" : ""}</option>)}
                                            </select>
                                            {f?.help && <div className="text-xs text-slate-400 mt-1">{f.help}</div>}
                                            {c.reason && target === c.target && c.status !== "auto" && <div className="text-xs text-amber-700 mt-1">{c.reason}</div>}
                                        </td>
                                        <td className="px-4 py-2.5"><ConfidenceBadge c={c} target={target} /></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4 text-sm">
                <h2 className="font-bold text-slate-800">הגדרות הייבוא</h2>
                <label className="block">
                    <span className="font-semibold text-slate-700">{m.entity_type === "clients" ? "לקוח שכבר קיים אצלך" : "שירות שכבר קיים אצלך"}</span>
                    <select
                        value={options.existing_action}
                        onChange={e => setOptions(o => ({ ...o, existing_action: e.target.value as MigrationOptions["existing_action"] }))}
                        className="mt-1 block w-full sm:w-96 rounded-lg border border-slate-200 bg-white px-2 py-1.5"
                    >
                        <option value="fill_empty">להשלים רק פרטים שחסרים אצלך (לא לדרוס)</option>
                        <option value="skip">לא לגעת בו</option>
                    </select>
                </label>
                {hasDate && (
                    <label className="block">
                        <span className="font-semibold text-slate-700">איך כתובים התאריכים בקובץ</span>
                        <select
                            value={options.date_order || "DMY"}
                            onChange={e => setOptions(o => ({ ...o, date_order: e.target.value as MigrationOptions["date_order"] }))}
                            className="mt-1 block w-full sm:w-96 rounded-lg border border-slate-200 bg-white px-2 py-1.5"
                        >
                            {Object.entries(DATE_ORDER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                        {dateAmbiguous && !m.options.date_order && (
                            <span className="block text-xs text-amber-700 mt-1">מהקובץ אי אפשר לדעת אם 05/06 זה 5 ביוני או 6 במאי — בחר את הצורה הנכונה.</span>
                        )}
                    </label>
                )}
            </section>

            {(duplicate.length > 0 || !hasName || review.length > 0) && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 flex gap-3">
                    <AlertTriangle className="h-5 w-5 shrink-0" />
                    <ul className="space-y-0.5">
                        {!hasName && <li>צריך למפות לפחות עמודה אחת של שם.</li>}
                        {duplicate.map(f => <li key={f.key}>השדה &quot;{f.label}&quot; נבחר ליותר מעמודה אחת.</li>)}
                        {review.length > 0 && <li>{review.length} עמודות מסומנות &quot;לבדיקה&quot; — ודא שהשדה שנבחר נכון.</li>}
                    </ul>
                </div>
            )}

            <button
                onClick={save}
                disabled={saving || !hasName || duplicate.length > 0}
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl text-white font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
                style={{ background: "var(--primary, #0f172a)" }}
            >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                סרוק ובדוק כפילויות
            </button>
        </div>
    );
}
