"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, RotateCcw, Trash2, XCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import MappingStep from "./MappingStep";
import PreviewStep from "./PreviewStep";
import { StatusBadge } from "./MigrationHome";
import { type MigrationDetail, type MigrationRowOut, type RollbackStats, fmtDateTime } from "./types";

const STEPS = [
    { key: "draft", label: "מיפוי שדות" },
    { key: "preview", label: "תצוגה מקדימה" },
    { key: "importing", label: "ייבוא" },
    { key: "done", label: "סיכום" },
];

function stepOf(status: string, remapping: boolean): number {
    if (remapping || status === "draft") return 0;
    if (status === "scanning" || status === "preview") return 1;
    if (status === "importing") return 2;
    return 3;
}

function Progress({ label, done, total }: { label: string; done: number; total: number }) {
    const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
    return (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Loader2 className="h-4 w-4 animate-spin" /> {label}
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: "var(--primary, #0f172a)" }} />
            </div>
            <div className="text-xs text-slate-500 tabular-nums">{done.toLocaleString("he-IL")} מתוך {total.toLocaleString("he-IL")} · אפשר לסגור את המסך, התהליך ממשיך ברקע</div>
        </div>
    );
}

function Report({ m, onUpdated }: { m: MigrationDetail; onUpdated: (m: MigrationDetail) => void }) {
    const [failed, setFailed] = useState<MigrationRowOut[]>([]);
    const [kept, setKept] = useState<MigrationRowOut[]>([]);
    const [busy, setBusy] = useState(false);
    const [confirming, setConfirming] = useState(false);
    // After a rollback the rows say "rolled back"; the tiles keep showing what the import itself did.
    const r = m.status === "rolled_back" && m.summary?.result ? m.summary.result : m.counts.result;
    const noun = m.entity_type === "services" ? "שירותים" : "לקוחות";
    const rollback = m.summary?.rollback as RollbackStats | undefined;

    useEffect(() => {
        let alive = true;
        const get = (status: string) => apiFetch<{ rows: MigrationRowOut[] }>(`/api/migrations/${m.id}/rows?status=${status}&page_size=200`).then(x => x.rows);
        Promise.all([r.failed ? get("failed") : Promise.resolve([]), m.status === "rolled_back" ? get("kept") : Promise.resolve([])])
            .then(([f, k]) => { if (alive) { setFailed(f); setKept(k); } })
            .catch(() => {});
        return () => { alive = false; };
    }, [m.id, m.status, r.failed]);

    async function doRollback() {
        setBusy(true);
        try {
            const res = await apiFetch<{ migration: MigrationDetail }>(`/api/migrations/${m.id}/rollback`, { method: "POST" });
            onUpdated(res.migration);
            toast.success("הייבוא בוטל");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "הביטול נכשל");
        } finally {
            setBusy(false);
            setConfirming(false);
        }
    }

    async function resume() {
        setBusy(true);
        try {
            onUpdated(await apiFetch<MigrationDetail>(`/api/migrations/${m.id}/resume`, { method: "POST" }));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "ההמשך נכשל");
        } finally {
            setBusy(false);
        }
    }

    const tiles = [
        { label: `${noun} חדשים נוצרו`, value: r.created || 0, cls: "text-emerald-700" },
        { label: "קיימים הושלמו", value: r.updated || 0, cls: "text-sky-700" },
        { label: "קיימים בלי שינוי", value: r.unchanged || 0, cls: "text-slate-600" },
        { label: "דולגו", value: r.skipped || 0, cls: "text-slate-500" },
        { label: "נכשלו", value: r.failed || 0, cls: "text-rose-700" },
    ];

    return (
        <div className="space-y-5">
            {m.status === "rolled_back" ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 flex gap-3">
                    <RotateCcw className="h-5 w-5 shrink-0" />
                    <div>
                        <div className="font-semibold">הייבוא בוטל ב-{fmtDateTime(m.rolled_back_at)}</div>
                        {rollback && (
                            <div className="mt-1">
                                {rollback.deleted} {noun} שנוצרו בייבוא נמחקו · {rollback.restored_fields} פרטים שהושלמו הוחזרו למה שהיה
                                {rollback.kept_used + rollback.kept_edited > 0 && <> · {rollback.kept_used + rollback.kept_edited} נשארו (רשימה למטה)</>}
                            </div>
                        )}
                    </div>
                </div>
            ) : m.status === "failed" ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 flex gap-3">
                    <XCircle className="h-5 w-5 shrink-0" />
                    <div>
                        <div className="font-semibold">הייבוא נעצר</div>
                        {m.error && <div className="mt-0.5">{m.error}</div>}
                        <button onClick={resume} disabled={busy} className="mt-2 px-4 py-1.5 rounded-lg bg-white border border-rose-200 font-semibold">
                            המשך מאיפה שנעצר
                        </button>
                    </div>
                </div>
            ) : (
                <div className={`rounded-xl border p-4 text-sm flex gap-3 ${m.status === "partial" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
                    {m.status === "partial" ? <AlertTriangle className="h-5 w-5 shrink-0" /> : <CheckCircle2 className="h-5 w-5 shrink-0" />}
                    <div>
                        <div className="font-semibold">{m.status === "partial" ? "הייבוא הסתיים, חלק מהשורות נכשלו" : "הייבוא הסתיים"} ב-{fmtDateTime(m.completed_at)}</div>
                        {m.entity_type === "clients" && <div className="mt-0.5">ללקוחות לא נשלחו הודעות.</div>}
                    </div>
                </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {tiles.map(t => (
                    <div key={t.label} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                        <div className={`text-2xl font-extrabold tabular-nums ${t.cls}`}>{t.value.toLocaleString("he-IL")}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{t.label}</div>
                    </div>
                ))}
            </div>

            {failed.length > 0 && (
                <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <h2 className="px-5 py-3 border-b border-slate-100 font-bold text-slate-800 text-sm">שורות שנכשלו</h2>
                    <ul className="divide-y divide-slate-100 text-sm">
                        {failed.map(x => (
                            <li key={x.id} className="px-5 py-2.5">
                                <span className="text-slate-400 tabular-nums ml-2">שורה {x.row_number}</span>
                                <span className="font-semibold text-slate-800">{String(x.data?.full_name ?? x.data?.name ?? "")}</span>
                                <span className="text-rose-700 mr-2">{x.error}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {kept.length > 0 && (
                <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <h2 className="px-5 py-3 border-b border-slate-100 font-bold text-slate-800 text-sm">נשארו במערכת אחרי הביטול</h2>
                    <ul className="divide-y divide-slate-100 text-sm">
                        {kept.map(x => (
                            <li key={x.id} className="px-5 py-2.5">
                                <span className="font-semibold text-slate-800">{String(x.data?.full_name ?? x.data?.name ?? "")}</span>
                                <span className="text-slate-500 mr-2">{x.error}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {(m.status === "completed" || m.status === "partial" || m.status === "failed") && (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 text-sm space-y-3">
                    <div className="font-bold text-slate-800">ביטול הייבוא</div>
                    <p className="text-slate-600">
                        מוחק את ה{noun} שהייבוא יצר ומחזיר פרטים שהוא השלים. {noun} שנעשה בהם שימוש מאז (תור, תשלום, הודעה) או שנערכו — נשארים, ויופיעו ברשימה. שום דבר שהיה אצלך לפני הייבוא לא נמחק.
                    </p>
                    {confirming ? (
                        <div className="flex flex-wrap gap-2">
                            <button onClick={doRollback} disabled={busy} className="px-4 py-2 rounded-xl bg-rose-600 text-white font-bold flex items-center gap-2">
                                {busy && <Loader2 className="h-4 w-4 animate-spin" />} כן, לבטל את הייבוא
                            </button>
                            <button onClick={() => setConfirming(false)} disabled={busy} className="px-4 py-2 rounded-xl border border-slate-200">לא</button>
                        </div>
                    ) : (
                        <button onClick={() => setConfirming(true)} className="px-4 py-2 rounded-xl border border-rose-200 text-rose-700 font-semibold flex items-center gap-2">
                            <RotateCcw className="h-4 w-4" /> בטל את הייבוא
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

// One import, from mapping to report. Polls while the server is scanning or importing.
export default function MigrationRun({ id }: { id: string }) {
    const router = useRouter();
    const [m, setM] = useState<MigrationDetail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [remapping, setRemapping] = useState(false);

    const refresh = useCallback(async () => {
        try {
            setM(await apiFetch<MigrationDetail>(`/api/migrations/${id}`));
        } catch (e) {
            setError(e instanceof Error ? e.message : "הייבוא לא נמצא");
        }
    }, [id]);

    useEffect(() => {
        let alive = true;
        apiFetch<MigrationDetail>(`/api/migrations/${id}`)
            .then(x => { if (alive) setM(x); })
            .catch(e => { if (alive) setError(e instanceof Error ? e.message : "הייבוא לא נמצא"); });
        return () => { alive = false; };
    }, [id]);

    const running = m?.status === "scanning" || m?.status === "importing";
    useEffect(() => {
        if (!running) return;
        const t = setInterval(refresh, 1500);
        return () => clearInterval(t);
    }, [running, refresh]);

    async function discard() {
        try {
            await apiFetch(`/api/migrations/${id}`, { method: "DELETE" });
            router.push("/migration");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "המחיקה נכשלה");
        }
    }

    if (error) return <div className="max-w-4xl mx-auto text-sm text-rose-700">{error}</div>;
    if (!m) return <div className="max-w-4xl mx-auto h-40 bg-slate-100 rounded-2xl animate-pulse" />;

    const step = stepOf(m.status, remapping);
    const toImport = (m.counts.decision.create || 0) + (m.counts.decision.merge || 0);
    const doneImport = (m.counts.result.created || 0) + (m.counts.result.updated || 0) + (m.counts.result.unchanged || 0) + (m.counts.result.failed || 0);

    return (
        <div className="max-w-5xl mx-auto space-y-5" dir="rtl">
            <div className="flex flex-wrap items-center gap-3">
                <Link href="/migration" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
                    <ArrowRight className="h-4 w-4" /> כל הייבואים
                </Link>
                <span className="text-slate-300">|</span>
                <span className="font-bold text-slate-800">{m.entity_label}</span>
                <span className="text-sm text-slate-500 truncate max-w-[16rem]">{m.file_name}</span>
                <StatusBadge status={m.status} />
                <span className="text-xs text-slate-400 font-mono" dir="ltr">{m.code}</span>
                {!m.started_at && m.status !== "scanning" && (
                    <button onClick={discard} className="mr-auto inline-flex items-center gap-1 text-sm text-slate-500 hover:text-rose-700">
                        <Trash2 className="h-4 w-4" /> מחק ייבוא זה
                    </button>
                )}
            </div>

            <ol className="flex gap-2 text-xs">
                {STEPS.map((s, i) => (
                    <li key={s.key} className={`flex-1 rounded-full px-3 py-1.5 text-center font-semibold ${i === step ? "bg-slate-900 text-white" : i < step ? "bg-slate-200 text-slate-600" : "bg-slate-100 text-slate-400"}`}>
                        {s.label}
                    </li>
                ))}
            </ol>

            {(m.status === "draft" || remapping) && m.status !== "scanning" && (
                <MappingStep m={m} onSaved={x => { setRemapping(false); setM(x); }} />
            )}
            {m.status === "scanning" && <Progress label="סורק ובודק כפילויות…" done={m.counts.scanned} total={m.counts.total} />}
            {m.status === "preview" && !remapping && (
                <PreviewStep m={m} onChanged={refresh} onConfirmed={setM} onRemap={() => setRemapping(true)} />
            )}
            {m.status === "importing" && <Progress label="מייבא…" done={doneImport} total={toImport} />}
            {["completed", "partial", "failed", "rolled_back"].includes(m.status) && !remapping && (
                m.status === "failed" && !m.started_at
                    ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{m.error || "הסריקה נעצרה"} <button onClick={() => setRemapping(true)} className="underline mr-2">חזרה למיפוי</button></div>
                    : <Report m={m} onUpdated={setM} />
            )}
        </div>
    );
}
