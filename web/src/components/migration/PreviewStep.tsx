"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Search } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import { MATCH_LABELS, type MigrationDetail, type MigrationRowOut } from "./types";

import { tx, intl } from "@/lib/i18n";
const TABS = ["possible_duplicate", "conflict", "new", "existing", "invalid"] as const;
const DECISION_LABELS = { create: tx("ליצור חדש"), merge: tx("להשלים את הקיים"), skip: tx("לדלג") } as const;
const TILE_STYLE: Record<string, string> = {
    new: "text-emerald-700",
    existing: "text-sky-700",
    possible_duplicate: "text-amber-700",
    conflict: "text-rose-700",
    invalid: "text-slate-500",
};

function money(cents: unknown) {
    return typeof cents === "number" ? `₪${(cents / 100).toLocaleString(intl())}` : "—";
}

function RecordCell({ entity, d }: { entity: string; d: Record<string, unknown> | null }) {
    if (!d) return <span className="text-slate-400">{tx("הנתונים נמחקו אחרי 30 יום")}</span>;
    if (entity === "services") {
        return (
            <div>
                <div className="font-semibold text-slate-800">{String(d.name ?? "—")}</div>
                <div className="text-xs text-slate-500">{String(d.duration_minutes ?? "")}{tx(" דק׳ · ")}{money(d.price_cents)}{d.category ? ` · ${d.category}` : ""}</div>
            </div>
        );
    }
    return (
        <div>
            <div className="font-semibold text-slate-800">{String(d.full_name ?? "—")}</div>
            <div className="text-xs text-slate-500" dir="ltr" style={{ textAlign: "right" }}>
                {[d.phone, d.email].filter(Boolean).join(" · ") || "—"}
            </div>
        </div>
    );
}

// Everything the import would do, before it does it. Rows that need a decision come first.
export default function PreviewStep({ m, onChanged, onConfirmed, onRemap }: {
    m: MigrationDetail;
    onChanged: () => void;
    onConfirmed: (m: MigrationDetail) => void;
    onRemap: () => void;
}) {
    const firstTab = TABS.find(t => (m.counts.match[t] || 0) > 0) || "new";
    const [tab, setTab] = useState<string>(firstTab);
    const [rows, setRows] = useState<MigrationRowOut[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [q, setQ] = useState("");
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const pageSize = 50;

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ match_status: tab, page: String(page), page_size: String(pageSize) });
            if (q.trim()) params.set("q", q.trim());
            const res = await apiFetch<{ rows: MigrationRowOut[]; total: number }>(`/api/migrations/${m.id}/rows?${params}`);
            setRows(res.rows);
            setTotal(res.total);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : tx("טעינת השורות נכשלה"));
        } finally {
            setLoading(false);
        }
    }, [m.id, tab, page, q]);

    useEffect(() => { load(); }, [load]);

    async function decide(decision: string, body: { row_ids?: string[]; match_status?: string }) {
        setBusy(true);
        try {
            await apiFetch(`/api/migrations/${m.id}/decisions`, { method: "POST", body: JSON.stringify({ decision, ...body }) });
            await load();
            onChanged();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : tx("השמירה נכשלה"));
        } finally {
            setBusy(false);
        }
    }

    async function confirm() {
        setBusy(true);
        try {
            onConfirmed(await apiFetch<MigrationDetail>(`/api/migrations/${m.id}/confirm`, { method: "POST" }));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : tx("האישור נכשל"));
            setBusy(false);
        }
    }

    const toImport = (m.counts.decision.create || 0) + (m.counts.decision.merge || 0);
    const waiting = (m.counts.match.possible_duplicate || 0) + (m.counts.match.conflict || 0);
    const noun = m.entity_type === "services" ? tx("שירותים") : tx("לקוחות");

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                    <div className="text-2xl font-extrabold text-slate-900 tabular-nums">{m.counts.total.toLocaleString(intl())}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{tx("נמצאו בקובץ")}</div>
                </div>
                {(["new", "existing", "possible_duplicate", "conflict", "invalid"] as const).map(k => (
                    <button
                        key={k}
                        onClick={() => { setTab(k); setPage(1); }}
                        className={`text-start bg-white rounded-2xl border shadow-sm p-4 ${tab === k ? "border-slate-900" : "border-slate-100 hover:border-slate-300"}`}
                    >
                        <div className={`text-2xl font-extrabold tabular-nums ${TILE_STYLE[k]}`}>{(m.counts.match[k] || 0).toLocaleString(intl())}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{MATCH_LABELS[k]}</div>
                    </button>
                ))}
            </div>

            {waiting > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 flex gap-3">
                    <AlertTriangle className="h-5 w-5 shrink-0" />
                    <div>
                        {waiting}{tx(" שורות דומות ל")}{noun}{tx(" שכבר קיימים אצלך או לשורה אחרת בקובץ. כברירת מחדל הן ")}<b>{tx("לא ייובאו")}</b> {tx("— עבור עליהן ובחר לכל אחת מה לעשות, או השאר כך.")}
                    </div>
                </div>
            )}

            <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
                    <h2 className="font-bold text-slate-800 text-sm">{MATCH_LABELS[tab]} ({total.toLocaleString(intl())})</h2>
                    <div className="relative ms-auto">
                        <Search className="h-4 w-4 text-slate-400 absolute start-2.5 top-2" />
                        <input
                            value={q}
                            onChange={e => { setQ(e.target.value); setPage(1); }}
                            placeholder={tx("חיפוש שם, טלפון או מייל")}
                            className="rounded-lg border border-slate-200 ps-8 pe-3 py-1.5 text-sm w-56"
                        />
                    </div>
                    {tab !== "invalid" && total > 0 && (
                        <div className="flex flex-wrap gap-1.5 text-xs">
                            <span className="text-slate-500 self-center">{tx("לכל השורות בלשונית:")}</span>
                            {(tab === "existing" || tab === "possible_duplicate" || tab === "conflict") && (
                                <button disabled={busy} onClick={() => decide("merge", { match_status: tab })} className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50">{tx("להשלים את הקיים")}</button>
                            )}
                            {tab !== "existing" && (
                                <button disabled={busy} onClick={() => decide("create", { match_status: tab })} className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50">{tx("ליצור חדשים")}</button>
                            )}
                            <button disabled={busy} onClick={() => decide("skip", { match_status: tab })} className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50">{tx("לדלג")}</button>
                        </div>
                    )}
                </div>

                {tab === "existing" && (
                    <p className="px-5 pt-3 text-xs text-slate-500">
                        {m.options.existing_action === "fill_empty"
                            ? tx("כברירת מחדל ישלימו רק פרטים שחסרים אצלך (טלפון, מייל, תאריך לידה, הערות) — שום פרט קיים לא נדרס.")
                            : tx("בחרת לא לגעת ב") + noun + tx(" שכבר קיימים.")}
                    </p>
                )}

                {loading ? (
                    <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
                ) : rows.length === 0 ? (
                    <p className="p-6 text-sm text-slate-500">{tx("אין שורות כאן.")}</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[640px] text-sm">
                            <thead className="bg-slate-50 text-slate-500 text-xs">
                                <tr>
                                    <th className="text-start font-semibold px-4 py-2">{tx("שורה")}</th>
                                    <th className="text-start font-semibold px-4 py-2">{tx("מהקובץ")}</th>
                                    {(tab === "existing" || tab === "possible_duplicate" || tab === "conflict") && (
                                        <th className="text-start font-semibold px-4 py-2">{tx("קיים אצלך")}</th>
                                    )}
                                    <th className="text-start font-semibold px-4 py-2">{tx("פרטים")}</th>
                                    <th className="text-start font-semibold px-4 py-2">{tx("מה לעשות")}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {rows.map(r => (
                                    <tr key={r.id} className="align-top">
                                        <td className="px-4 py-2.5 text-slate-400 tabular-nums">{r.row_number}</td>
                                        <td className="px-4 py-2.5"><RecordCell entity={m.entity_type} d={r.data} /></td>
                                        {(tab === "existing" || tab === "possible_duplicate" || tab === "conflict") && (
                                            <td className="px-4 py-2.5">
                                                {r.target ? (
                                                    m.entity_type === "services"
                                                        ? <RecordCell entity="services" d={r.target} />
                                                        : <RecordCell entity="clients" d={{ full_name: r.target.name, phone: r.target.phone, email: r.target.email }} />
                                                ) : <span className="text-slate-400 text-xs">—</span>}
                                            </td>
                                        )}
                                        <td className="px-4 py-2.5 max-w-xs">
                                            {r.match_reason && tab !== "new" && <div className="text-xs text-slate-600">{r.match_reason}</div>}
                                            {r.issues.map((i, k) => (
                                                <div key={k} className={`text-xs ${i.level === "error" ? "text-rose-700" : i.level === "warning" ? "text-amber-700" : "text-slate-500"}`}>{i.message}</div>
                                            ))}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            {r.match_status === "invalid" ? (
                                                <span className="text-xs text-slate-500">{tx("לא ייובא")}</span>
                                            ) : (
                                                <select
                                                    value={r.decision || "skip"}
                                                    disabled={busy}
                                                    onChange={e => decide(e.target.value, { row_ids: [r.id] })}
                                                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm"
                                                >
                                                    {(r.target ? ["merge", "create", "skip"] : ["create", "skip"]).map(k => (
                                                        <option key={k} value={k}>{DECISION_LABELS[k as keyof typeof DECISION_LABELS]}</option>
                                                    ))}
                                                </select>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                {total > pageSize && (
                    <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-3 text-sm">
                        <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 rounded-lg border border-slate-200 disabled:opacity-40">{tx("הקודם")}</button>
                        <span className="text-slate-500 tabular-nums">{tx("עמוד ")}{page}{tx(" מתוך ")}{Math.ceil(total / pageSize)}</span>
                        <button disabled={page * pageSize >= total} onClick={() => setPage(p => p + 1)} className="px-3 py-1 rounded-lg border border-slate-200 disabled:opacity-40">{tx("הבא")}</button>
                    </div>
                )}
            </section>

            <div className="flex flex-wrap items-center gap-3">
                <button
                    onClick={confirm}
                    disabled={busy || toImport === 0}
                    className="px-6 py-2.5 rounded-xl text-white font-bold text-sm disabled:opacity-40 flex items-center gap-2"
                    style={{ background: "var(--primary, #0f172a)" }}
                >
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    {tx("אשר וייבא")} {toImport.toLocaleString(intl())} {noun}
                </button>
                <button onClick={onRemap} disabled={busy} className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50">
                    {tx("חזרה למיפוי השדות")}
                </button>
                <span className="text-xs text-slate-500">
                    {(m.counts.decision.create || 0).toLocaleString(intl())}{tx(" ייווצרו · ")}{(m.counts.decision.merge || 0).toLocaleString(intl())}{tx(" יושלמו · ")}{(m.counts.decision.skip || 0).toLocaleString(intl())} {tx("ידולגו")}
                </span>
            </div>
        </div>
    );
}
