"use client";

import { useState } from "react";
import { ExternalLink, FileText } from "lucide-react";
import SignaturePad from "./SignaturePad";

// The health declaration as a client fills it — on the studio's iPad/iPhone, or from the link on their own phone.
// The form is the business's (app/services/health_forms.py): its text, its yes/no and open questions, its file.

export type HealthQuestion = { id: string; text: string; kind: "yes_no" | "text" };
export type HealthAnswer = { answer?: "yes" | "no"; details?: string; text?: string };
export type HealthFile = { id: string; filename: string; content_type: string };
export type HealthFormView = {
    title: string; intro: string; questions: HealthQuestion[]; closing: string; ask_id_number: boolean;
    file: HealthFile | null; client_name: string; business_name: string;
};
export type ClientPart = { answers: Record<string, HealthAnswer>; id_number: string; signature: string };

export default function HealthFormFill({ form, fileSrc, onSubmit }: {
    form: HealthFormView; fileSrc: string | null; onSubmit: (part: ClientPart) => Promise<void>;
}) {
    const [answers, setAnswers] = useState<Record<string, HealthAnswer>>({});
    const [idNumber, setIdNumber] = useState("");
    const [agreed, setAgreed] = useState(false);
    const [signature, setSignature] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const set = (id: string, patch: HealthAnswer) => setAnswers(a => ({ ...a, [id]: { ...a[id], ...patch } }));
    const unanswered = form.questions.filter(q => q.kind === "yes_no" && !answers[q.id]?.answer).length;
    const idOk = !form.ask_id_number || /^\d{5,9}$/.test(idNumber.replace(/\D/g, ""));
    const missing = [
        unanswered > 0 && (unanswered === 1 ? "שאלה אחת לא נענתה" : `${unanswered} שאלות לא נענו`),
        !idOk && "מספר תעודת זהות",
        !agreed && "אישור ההצהרה",
        !signature && "חתימה",
    ].filter(Boolean) as string[];

    const submit = async () => {
        if (missing.length || !signature) return;
        setSending(true); setErr(null);
        try {
            await onSubmit({ answers, id_number: idNumber, signature });
        } catch (e) {
            setErr(e instanceof Error ? e.message : "השליחה נכשלה, נסו שוב");
        } finally {
            setSending(false);
        }
    };
    const isImage = form.file?.content_type.startsWith("image/");

    return (
        <div className="space-y-6" dir="rtl">
            <header className="space-y-1">
                <p className="text-sm font-semibold text-slate-500">{form.business_name}</p>
                <h1 className="text-2xl font-black text-slate-900">{form.title}</h1>
                <p className="text-sm text-slate-600">שם: <b className="text-slate-900">{form.client_name}</b></p>
            </header>

            {form.intro && <p className="text-[15px] leading-relaxed text-slate-700 whitespace-pre-wrap">{form.intro}</p>}

            {form.file && fileSrc && (
                <section className="space-y-2">
                    {isImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={fileSrc} alt={form.file.filename} className="w-full rounded-xl border border-slate-200" />
                    ) : (
                        <iframe src={fileSrc} title={form.file.filename} className="w-full h-[60vh] rounded-xl border border-slate-200 bg-white" />
                    )}
                    <a href={fileSrc} target="_blank" rel="noopener"
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700 hover:text-slate-900">
                        <FileText className="h-4 w-4" aria-hidden /> {form.file.filename}
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                </section>
            )}

            {form.questions.length > 0 && (
                <ol className="space-y-3">
                    {form.questions.map((q, i) => {
                        const a = answers[q.id] ?? {};
                        return (
                            <li key={q.id} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                                <p className="text-[15px] font-semibold text-slate-900"><span className="text-slate-400 tabular-nums ml-1">{i + 1}.</span>{q.text}</p>
                                {q.kind === "yes_no" ? (
                                    <>
                                        <div className="grid grid-cols-2 gap-2">
                                            {(["no", "yes"] as const).map(v => (
                                                <button key={v} type="button" onClick={() => set(q.id, { answer: v })} aria-pressed={a.answer === v}
                                                    className={`py-3 rounded-xl text-base font-bold border-2 transition-colors ${a.answer === v
                                                        ? (v === "yes" ? "bg-amber-50 border-amber-500 text-amber-900" : "bg-slate-900 border-slate-900 text-white")
                                                        : "bg-white border-slate-200 text-slate-700"}`}>
                                                    {v === "yes" ? "כן" : "לא"}
                                                </button>
                                            ))}
                                        </div>
                                        {a.answer === "yes" && (
                                            <textarea value={a.details ?? ""} onChange={e => set(q.id, { details: e.target.value })} maxLength={1000}
                                                placeholder="פירוט (לא חובה)" rows={2}
                                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-[15px] outline-none focus:ring-2 focus:ring-slate-300" />
                                        )}
                                    </>
                                ) : (
                                    <textarea value={a.text ?? ""} onChange={e => set(q.id, { text: e.target.value })} maxLength={2000} rows={3}
                                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-[15px] outline-none focus:ring-2 focus:ring-slate-300" />
                                )}
                            </li>
                        );
                    })}
                </ol>
            )}

            {form.ask_id_number && (
                <label className="block">
                    <span className="text-sm font-semibold text-slate-700">מספר תעודת זהות</span>
                    <input value={idNumber} onChange={e => setIdNumber(e.target.value)} inputMode="numeric" autoComplete="off" maxLength={12} dir="ltr"
                        className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-3 text-base tabular-nums text-right outline-none focus:ring-2 focus:ring-slate-300" />
                </label>
            )}

            <label className="flex items-start gap-3 rounded-2xl bg-slate-50 border border-slate-200 p-4 cursor-pointer">
                <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-1 h-5 w-5 accent-slate-900 shrink-0" />
                <span className="text-[15px] leading-relaxed text-slate-800 whitespace-pre-wrap">{form.closing || "אני מצהיר/ה שהפרטים שמסרתי נכונים."}</span>
            </label>

            <SignaturePad label="חתימת הלקוח" onChange={setSignature} />

            {err && <p className="text-sm text-rose-600">{err}</p>}
            <div className="space-y-2">
                <button type="button" onClick={submit} disabled={missing.length > 0 || sending}
                    className="w-full py-4 rounded-2xl bg-slate-900 text-white text-lg font-bold disabled:opacity-40">
                    {sending ? "שולח..." : "חתימה ושליחה"}
                </button>
                {missing.length > 0 && <p className="text-center text-xs text-slate-500">חסר: {missing.join(" · ")}</p>}
            </div>
        </div>
    );
}
