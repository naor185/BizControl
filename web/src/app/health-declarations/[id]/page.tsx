"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, FileText, Printer } from "lucide-react";
import RequireAuth from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";
import { Answers, useFormFile, type Declaration } from "@/components/health/HealthDeclarations";

// A signed health declaration as a document — to read, and to print or save as PDF. Without the app's frame,
// so it prints clean. The staff who give the service open it too (RequireAuth's artist pages).

const at = (iso: string | null) => (iso ? new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "—");

export default function HealthDeclarationPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const [d, setD] = useState<Declaration | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const fileSrc = useFormFile(d?.file?.id);

    useEffect(() => {
        apiFetch<Declaration>(`/api/health-declarations/${id}`).then(setD)
            .catch(e => setErr(e instanceof Error ? e.message : "הטעינה נכשלה"));
    }, [id]);

    return (
        <RequireAuth>
            <div className="min-h-screen bg-slate-100 print:bg-white" dir="rtl">
                <div className="max-w-3xl mx-auto px-4 py-6 print:p-0 space-y-4">
                    <div className="flex items-center justify-between print:hidden">
                        <button onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
                            <ArrowRight className="h-4 w-4" aria-hidden /> חזרה
                        </button>
                        {d && (
                            <button onClick={() => window.print()} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold">
                                <Printer className="h-4 w-4" aria-hidden /> הדפסה / שמירה כ-PDF
                            </button>
                        )}
                    </div>

                    {!d ? (
                        <p className="text-center text-slate-400 py-16">{err ?? "טוען..."}</p>
                    ) : (
                        <article className="bg-white rounded-2xl border border-slate-200 print:border-0 print:rounded-none p-6 sm:p-8 space-y-6">
                            <header className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
                                <div>
                                    <p className="text-sm font-semibold text-slate-500">{d.business_name}</p>
                                    <h1 className="text-2xl font-black text-slate-900">{d.title}</h1>
                                </div>
                                {d.status !== "signed" && (
                                    <span className="text-xs font-bold px-2 py-1 rounded-full bg-amber-50 text-amber-800">
                                        {d.status === "waiting_client" ? "עוד לא מולא" : "ממתין לחתימת המבצע"}
                                    </span>
                                )}
                            </header>

                            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
                                <div><dt className="text-slate-500">שם הלקוח</dt><dd className="font-bold text-slate-900">{d.client_name}</dd></div>
                                {d.id_number && <div><dt className="text-slate-500">תעודת זהות</dt><dd className="font-bold text-slate-900 tabular-nums">{d.id_number}</dd></div>}
                                {d.client_phone && <div><dt className="text-slate-500">טלפון</dt><dd className="font-bold text-slate-900 tabular-nums" dir="ltr">{d.client_phone}</dd></div>}
                                {d.appointment_at && (
                                    <div><dt className="text-slate-500">תור</dt><dd className="font-bold text-slate-900">{d.appointment_title} · {at(d.appointment_at)}</dd></div>
                                )}
                            </dl>

                            {d.intro && <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">{d.intro}</p>}

                            {d.file && (
                                <p className="text-sm text-slate-700 inline-flex items-center gap-1.5">
                                    <FileText className="h-4 w-4" aria-hidden /> צורף הקובץ:
                                    {fileSrc ? <a href={fileSrc} target="_blank" rel="noopener" className="font-semibold underline">{d.file.filename}</a> : <b>{d.file.filename}</b>}
                                </p>
                            )}

                            {d.questions.length > 0 && d.answers && <Answers d={d} />}

                            {d.closing && <p className="text-sm leading-relaxed text-slate-800 whitespace-pre-wrap border-r-4 border-slate-300 pr-3">{d.closing}</p>}

                            <div className="grid sm:grid-cols-2 gap-6 pt-2">
                                {[
                                    { who: "חתימת הלקוח", name: d.client_name, sig: d.client_signature, time: d.client_signed_at,
                                      note: d.client_signed_via === "link" ? "נחתם מהטלפון של הלקוח (קישור)" : d.client_signed_via === "studio" ? "נחתם בעסק" : "" },
                                    { who: "חתימת המבצע", name: d.performer_name, sig: d.performer_signature, time: d.performer_signed_at, note: "" },
                                ].map(s => (
                                    <div key={s.who} className="space-y-1.5">
                                        <p className="text-xs font-semibold text-slate-500">{s.who}</p>
                                        <div className="h-28 rounded-xl border border-slate-200 flex items-center justify-center bg-white">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            {s.sig ? <img src={s.sig} alt={s.who} className="max-h-24 max-w-full" /> : <span className="text-xs text-slate-400">טרם נחתם</span>}
                                        </div>
                                        <p className="text-xs text-slate-600">{s.name ?? ""}{s.time ? ` · ${at(s.time)}` : ""}</p>
                                        {s.note && <p className="text-[11px] text-slate-400">{s.note}</p>}
                                    </div>
                                ))}
                            </div>
                        </article>
                    )}
                </div>
            </div>
        </RequireAuth>
    );
}
