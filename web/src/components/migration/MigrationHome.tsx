"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Upload, Loader2, ShieldCheck, History, ChevronLeft } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import { type Connector, type MigrationDetail, type MigrationStatus, type MigrationSummary, STATUS_LABELS, fmtDateTime } from "./types";

const STATUS_STYLE: Record<MigrationStatus, string> = {
    draft: "bg-slate-100 text-slate-600",
    scanning: "bg-sky-50 text-sky-700",
    preview: "bg-amber-50 text-amber-700",
    importing: "bg-sky-50 text-sky-700",
    completed: "bg-emerald-50 text-emerald-700",
    partial: "bg-amber-50 text-amber-700",
    failed: "bg-rose-50 text-rose-700",
    rolled_back: "bg-slate-100 text-slate-500",
};

export function StatusBadge({ status }: { status: MigrationStatus }) {
    return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_STYLE[status]}`}>{STATUS_LABELS[status]}</span>;
}

// Start screen: pick a source, upload the file, and the list of earlier imports.
export default function MigrationHome() {
    const router = useRouter();
    const [connectors, setConnectors] = useState<Connector[] | null>(null);
    const [history, setHistory] = useState<MigrationSummary[]>([]);
    const [source, setSource] = useState<Connector | null>(null);
    const [entity, setEntity] = useState<string>("");
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        apiFetch<Connector[]>("/api/migrations/connectors")
            .then(list => {
                setConnectors(list);
                if (list.length === 1) {
                    setSource(list[0]);
                    setEntity(list[0].entities.find(e => e.importable)?.key || "");
                }
            })
            .catch(e => { setConnectors([]); toast.error(e.message); });
        apiFetch<MigrationSummary[]>("/api/migrations").then(setHistory).catch(() => setHistory([]));
    }, []);

    async function upload() {
        if (!source || !entity || !file) return;
        setUploading(true);
        const fd = new FormData();
        fd.append("source", source.slug);
        fd.append("entity", entity);
        fd.append("file", file);
        try {
            const m = await apiFetch<MigrationDetail>("/api/migrations", { method: "POST", body: fd });
            router.push(`/migration?id=${m.id}`);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "ההעלאה נכשלה");
            setUploading(false);
        }
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6" dir="rtl">
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex gap-4">
                <ShieldCheck className="h-6 w-6 text-emerald-600 shrink-0 mt-0.5" />
                <div className="text-sm text-slate-600 leading-relaxed space-y-1">
                    <p className="font-semibold text-slate-800">העברת לקוחות ושירותים ממערכת אחרת</p>
                    <p>שום דבר לא נכתב למערכת לפני שתראה תצוגה מקדימה ותאשר. כפילויות מזוהות ומוצגות לך להחלטה, לקוחות לא מקבלים הודעות, ואפשר לבטל ייבוא גם אחרי שרץ.</p>
                    <p className="text-slate-500">מ-Arbox, קלמארק או כל מערכת אחרת: ייצא מתוכה את רשימת הלקוחות (או השירותים) לקובץ Excel או CSV והעלה אותו כאן. חיבור ישיר למערכות האלה יתווסף בהמשך.</p>
                </div>
            </div>

            <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-5">
                <h2 className="font-bold text-slate-800">ייבוא חדש</h2>
                {connectors === null ? (
                    <div className="h-24 bg-slate-50 rounded-xl animate-pulse" />
                ) : connectors.length === 0 ? (
                    <p className="text-sm text-slate-500">אין כרגע מקורות ייבוא זמינים.</p>
                ) : (
                    <>
                        <div className="grid sm:grid-cols-2 gap-3">
                            {connectors.map(c => (
                                <button
                                    key={c.slug}
                                    onClick={() => { setSource(c); setEntity(c.entities.find(e => e.importable)?.key || ""); }}
                                    className={`text-right rounded-xl border p-4 flex gap-3 transition-colors ${source?.slug === c.slug ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300"}`}
                                >
                                    <FileSpreadsheet className="h-6 w-6 text-emerald-600 shrink-0" />
                                    <div>
                                        <div className="font-semibold text-slate-800 text-sm">{c.name}</div>
                                        <div className="text-xs text-slate-500 mt-0.5">{c.description}</div>
                                    </div>
                                </button>
                            ))}
                        </div>

                        {source && (
                            <div className="space-y-4">
                                <div>
                                    <div className="text-sm font-semibold text-slate-700 mb-2">מה מייבאים?</div>
                                    <div className="flex flex-wrap gap-2">
                                        {source.entities.filter(e => e.importable).map(e => (
                                            <button
                                                key={e.key}
                                                onClick={() => setEntity(e.key)}
                                                className={`px-4 py-2 rounded-xl text-sm font-semibold border ${entity === e.key ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"}`}
                                            >
                                                {e.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div
                                    onClick={() => inputRef.current?.click()}
                                    onDragOver={e => e.preventDefault()}
                                    onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}
                                    className="cursor-pointer rounded-xl border-2 border-dashed border-slate-200 hover:border-slate-300 p-6 text-center"
                                >
                                    <Upload className="h-6 w-6 text-slate-400 mx-auto mb-2" />
                                    {file ? (
                                        <div className="text-sm font-semibold text-slate-800">{file.name} <span className="text-slate-400 font-normal">({Math.ceil(file.size / 1024)} KB)</span></div>
                                    ) : (
                                        <div className="text-sm text-slate-500">גרור לכאן קובץ Excel (xlsx) או CSV, או לחץ לבחירה · עד 10MB</div>
                                    )}
                                    <input
                                        ref={inputRef}
                                        type="file"
                                        accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                        className="hidden"
                                        onChange={e => setFile(e.target.files?.[0] || null)}
                                    />
                                </div>

                                <button
                                    onClick={upload}
                                    disabled={!entity || !file || uploading}
                                    className="w-full sm:w-auto px-6 py-2.5 rounded-xl text-white font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
                                    style={{ background: "var(--primary, #0f172a)" }}
                                >
                                    {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
                                    {uploading ? "קורא את הקובץ…" : "העלה והמשך למיפוי שדות"}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </section>

            {history.length > 0 && (
                <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                        <History className="h-4 w-4 text-slate-500" />
                        <h2 className="font-bold text-slate-800 text-sm">ייבואים קודמים</h2>
                    </div>
                    <ul className="divide-y divide-slate-100">
                        {history.map(m => {
                            const r = m.summary?.result || {};
                            return (
                                <li key={m.id}>
                                    <button onClick={() => router.push(`/migration?id=${m.id}`)} className="w-full text-right px-5 py-3 flex items-center gap-3 hover:bg-slate-50">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-semibold text-sm text-slate-800">{m.entity_label}</span>
                                                <StatusBadge status={m.status} />
                                                <span className="text-xs text-slate-400 font-mono" dir="ltr">{m.code}</span>
                                            </div>
                                            <div className="text-xs text-slate-500 mt-0.5 truncate">
                                                {m.file_name || m.source_name} · {m.row_count} שורות · {fmtDateTime(m.created_at)}
                                                {m.summary && ` · נוצרו ${r.created || 0}, עודכנו ${r.updated || 0}${r.failed ? `, נכשלו ${r.failed}` : ""}`}
                                            </div>
                                        </div>
                                        <ChevronLeft className="h-4 w-4 text-slate-400 shrink-0" />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}
        </div>
    );
}
