"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Eye, FileText, Paperclip, Plus, Trash2, X } from "lucide-react";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import { API_BASE, apiFetch, getToken } from "@/lib/api";
import { toast } from "@/lib/toast";
import HealthFormFill, { type HealthFile, type HealthQuestion } from "@/components/health/HealthFormFill";
import { useFormFile } from "@/components/health/HealthDeclarations";

// The business's health declaration (app/services/health_forms.py): its text, its questions (yes/no — "yes" asks for
// details — or open), a file of its own (PDF / image), or all of them together. A ready-made form until it's saved.
// Changing it never changes a declaration someone already signed.

type Form = { title: string; intro: string; questions: HealthQuestion[]; closing: string; ask_id_number: boolean; file: HealthFile | null; saved: boolean };
const input = "w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-slate-300";

export default function HealthFormSettingsPage() {
    const [form, setForm] = useState<Form | null>(null);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [preview, setPreview] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);
    const fileSrc = useFormFile(form?.file?.id);

    useEffect(() => { apiFetch<Form>("/api/health-form").then(setForm).catch(() => toast.error("הטעינה נכשלה")); }, []);
    if (!form) return <RequireAuth><AppShell title="הצהרת בריאות"><p className="text-center text-slate-400 py-16">טוען...</p></AppShell></RequireAuth>;

    const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
    const setQ = (i: number, patch: Partial<HealthQuestion>) => set({ questions: form.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) });
    const moveQ = (i: number, by: number) => {
        const qs = [...form.questions];
        [qs[i], qs[i + by]] = [qs[i + by], qs[i]];
        set({ questions: qs });
    };

    const upload = async (file: File) => {
        setUploading(true);
        try {
            const body = new FormData();
            body.append("file", file);
            const r = await fetch(`${API_BASE}/api/health-form/file`, { method: "POST", body, headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
            const data = await r.json().catch(() => null);
            if (!r.ok) throw new Error(data?.detail || "ההעלאה נכשלה");
            set({ file: data });
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "ההעלאה נכשלה");
        } finally {
            setUploading(false);
            if (fileInput.current) fileInput.current.value = "";
        }
    };
    const save = async () => {
        setSaving(true);
        try {
            setForm(await apiFetch<Form>("/api/health-form", {
                method: "PUT",
                body: JSON.stringify({ ...form, file_id: form.file?.id ?? null }),
            }));
            toast.success("הטופס נשמר");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "השמירה נכשלה");
        } finally {
            setSaving(false);
        }
    };

    return (
        <RequireAuth>
            <AppShell title="הצהרת בריאות">
                <div className="max-w-3xl mx-auto py-6 px-4 space-y-6" dir="rtl">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div>
                            <h1 className="text-2xl font-black text-slate-900">הצהרת בריאות</h1>
                            <p className="text-sm text-slate-500 mt-1 max-w-xl">
                                הטופס שהלקוח ממלא וחותם עליו לפני הטיפול: באייפד או באייפון בעסק, מהתור או מתיק הלקוח. אחרי הלקוח חותם גם המבצע.
                                אפשר לכתוב כאן שאלות, לצרף קובץ משלך, או את שניהם.
                                {!form.saved && " זה טופס מוכן להתחלה, אפשר לשנות בו הכול."}
                            </p>
                        </div>
                        <button onClick={() => setPreview(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-sm font-bold text-slate-700">
                            <Eye className="h-4 w-4" aria-hidden /> איך הלקוח רואה את זה
                        </button>
                    </div>

                    <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                        <label className="block">
                            <span className="text-xs font-semibold text-slate-500">כותרת</span>
                            <input className={`${input} mt-1 font-bold`} value={form.title} maxLength={120} onChange={e => set({ title: e.target.value })} />
                        </label>
                        <label className="block">
                            <span className="text-xs font-semibold text-slate-500">טקסט פתיחה / ההצהרה עצמה</span>
                            <textarea className={`${input} mt-1 min-h-[110px] leading-relaxed`} value={form.intro} maxLength={5000} onChange={e => set({ intro: e.target.value })} />
                        </label>

                        <div>
                            <span className="text-xs font-semibold text-slate-500">קובץ משלך (לא חובה)</span>
                            <div className="mt-1 flex items-center gap-3 flex-wrap">
                                {form.file ? (
                                    <>
                                        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                                            <FileText className="h-4 w-4" aria-hidden />
                                            {fileSrc ? <a href={fileSrc} target="_blank" rel="noopener" className="underline">{form.file.filename}</a> : form.file.filename}
                                        </span>
                                        <button onClick={() => set({ file: null })} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-rose-600">
                                            <X className="h-3.5 w-3.5" aria-hidden /> הסרה
                                        </button>
                                    </>
                                ) : (
                                    <button onClick={() => fileInput.current?.click()} disabled={uploading}
                                        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                                        <Paperclip className="h-4 w-4" aria-hidden /> {uploading ? "מעלה..." : "צירוף PDF או תמונה"}
                                    </button>
                                )}
                                <input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden"
                                    onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }} />
                            </div>
                            <p className="text-xs text-slate-400 mt-1">הלקוח רואה את הקובץ בטופס ומאשר אותו בחתימה. עד 8MB.</p>
                        </div>
                    </section>

                    <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                        <div className="flex items-center justify-between">
                            <h2 className="font-bold text-slate-900">שאלות</h2>
                            <span className="text-xs text-slate-500">{form.questions.length} שאלות</span>
                        </div>
                        <ol className="space-y-2">
                            {form.questions.map((q, i) => (
                                <li key={q.id} className="flex items-start gap-2">
                                    <span className="text-xs text-slate-400 tabular-nums pt-2.5 w-5 shrink-0">{i + 1}.</span>
                                    <div className="flex-1 space-y-1.5">
                                        <textarea className={`${input} leading-relaxed`} rows={2} value={q.text} maxLength={500} onChange={e => setQ(i, { text: e.target.value })} aria-label={`שאלה ${i + 1}`} />
                                        <div className="flex gap-1.5">
                                            {(["yes_no", "text"] as const).map(k => (
                                                <button key={k} type="button" onClick={() => setQ(i, { kind: k })} aria-pressed={q.kind === k}
                                                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${q.kind === k ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"}`}>
                                                    {k === "yes_no" ? "כן / לא" : "תשובה פתוחה"}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-0.5 shrink-0">
                                        <button onClick={() => moveQ(i, -1)} disabled={i === 0} aria-label="למעלה" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-20"><ArrowUp className="h-4 w-4" /></button>
                                        <button onClick={() => moveQ(i, 1)} disabled={i === form.questions.length - 1} aria-label="למטה" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-20"><ArrowDown className="h-4 w-4" /></button>
                                        <button onClick={() => set({ questions: form.questions.filter((_, j) => j !== i) })} aria-label="מחיקה" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>
                                    </div>
                                </li>
                            ))}
                        </ol>
                        <button onClick={() => set({ questions: [...form.questions, { id: `new${Date.now().toString(36)}`, text: "", kind: "yes_no" }] })}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-sm font-bold text-slate-700">
                            <Plus className="h-4 w-4" aria-hidden /> שאלה חדשה
                        </button>
                    </section>

                    <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                        <label className="block">
                            <span className="text-xs font-semibold text-slate-500">משפט האישור לפני החתימה</span>
                            <textarea className={`${input} mt-1 min-h-[80px] leading-relaxed`} value={form.closing} maxLength={2000} onChange={e => set({ closing: e.target.value })} />
                        </label>
                        <label className="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" checked={form.ask_id_number} onChange={e => set({ ask_id_number: e.target.checked })} className="h-5 w-5 accent-slate-900" />
                            <span className="text-sm text-slate-800">לבקש מספר תעודת זהות</span>
                        </label>
                    </section>

                    <div className="sticky bottom-4 flex justify-end">
                        <button onClick={save} disabled={saving}
                            className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-slate-900 text-white font-bold shadow-lg disabled:opacity-50">
                            <Check className="h-4 w-4" aria-hidden /> {saving ? "שומר..." : "שמירת הטופס"}
                        </button>
                    </div>
                </div>

                {preview && (
                    <div className="fixed inset-0 z-[70] bg-slate-50 overflow-y-auto" role="dialog" aria-modal="true">
                        <div className="sticky top-0 bg-white/90 backdrop-blur border-b border-slate-200">
                            <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between" dir="rtl">
                                <span className="font-bold text-slate-900">תצוגה מקדימה — כך הלקוח רואה את הטופס</span>
                                <button onClick={() => setPreview(false)} aria-label="סגירה" className="p-2 -m-2 text-slate-500 hover:text-slate-900"><X className="h-6 w-6" /></button>
                            </div>
                        </div>
                        <div className="max-w-2xl mx-auto px-4 py-6">
                            <HealthFormFill
                                form={{ ...form, questions: form.questions.filter(q => q.text.trim()), client_name: "ישראל ישראלי (דוגמה)", business_name: "" }}
                                fileSrc={fileSrc}
                                onSubmit={async () => { setPreview(false); toast.success("זו רק תצוגה מקדימה — שום דבר לא נשמר"); }} />
                        </div>
                    </div>
                )}
            </AppShell>
        </RequireAuth>
    );
}
