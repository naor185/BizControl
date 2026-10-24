"use client";

// A link to pay a business sent on WhatsApp — from the till or an appointment (services/payment_requests; the owner,
// 2026-10-24: "the card terminal isn't connected — send the client a link"). The same look as the deposit's page
// (/pay/<appointment>): the business's logo, what it is for, its Bit / PayBox / bank transfer, a picture of the payment
// and "שילמתי" — the business hears it at once and approves. In the business's language.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { CircleCheck, ImagePlus, X } from "lucide-react";
import { imgUrl } from "@/lib/api";
import { toast } from "@/lib/toast";
import AfterMount from "@/components/AfterMount";
import { tx, speakBusiness, langHeader } from "@/lib/i18n";

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

type View = {
    status: "waiting" | "reported" | "paid" | "canceled";
    business_name: string; logo_url: string | null; client_first_name: string; title: string | null;
    items: { description: string; quantity: number; unit_price_cents: number }[];
    discount_cents: number; amount_cents: number;
    bit_link: string | null; paybox_link: string | null; bank_name: string | null; bank_branch: string | null; bank_account: string | null;
    reported: boolean; has_proof: boolean; locale?: string;
};

const ils = (c: number) => `₪${(c / 100).toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;

export default function PaymentRequestPage() {
    return <AfterMount><PaymentRequest /></AfterMount>;
}

function PaymentRequest() {
    const { id } = useParams<{ id: string }>();
    const url = `${API}/api/public/payment-request/${id}`;
    const [view, setView] = useState<View | null>(null);
    const [missing, setMissing] = useState(false);
    const [proof, setProof] = useState<File | null>(null);
    const [notes, setNotes] = useState("");
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        fetch(url).then(r => (r.ok ? r.json() : Promise.reject(r.status)))
            .then((v: View) => { speakBusiness(v.locale); setView(v); })
            .catch(() => setMissing(true));
    }, [url]);

    const report = async () => {
        if (!view) return;
        setBusy(true);
        try {
            if (proof) {
                const body = new FormData();
                body.append("file", proof);
                const r = await fetch(`${url}/proof`, { method: "POST", body, headers: langHeader() });
                if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail || tx("לא הצלחנו לשלוח את הצילום"));
            }
            const r = await fetch(`${url}/confirm`, { method: "POST", headers: { "Content-Type": "application/json", ...langHeader() },
                                                     body: JSON.stringify({ notes }) });
            if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail || tx("השליחה נכשלה, נסו שוב"));
            setView({ ...view, status: "reported", reported: true, has_proof: view.has_proof || !!proof });
            window.scrollTo({ top: 0 });
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    if (missing) return <Notice title={tx("הקישור לא נמצא")} text={tx("ייתכן שהוא הועתק חלקית. בקשו מהעסק לשלוח אותו שוב.")} />;
    if (!view) return <div className="min-h-screen bg-[var(--background)]" />;
    if (view.status === "canceled") return <Notice title={tx("הקישור בוטל")} text={tx("לפרטים — פנו אל {0}.", { 0: view.business_name })} />;
    if (view.status === "paid") return <Notice ok title={tx("התשלום התקבל — תודה!")} text={tx("{0} אישר/ה את התשלום.", { 0: view.business_name })} />;

    return (
        <div className="min-h-screen bg-[var(--background)] flex flex-col items-center py-12 px-6">
            <div className="max-w-md w-full">
                <div className="flex flex-col items-center text-center mb-8">
                    <div className="w-20 h-20 bg-white rounded-2xl shadow-lg flex items-center justify-center mb-4 border border-slate-100">
                        {view.logo_url
                            /* eslint-disable-next-line @next/next/no-img-element */
                            ? <img src={imgUrl(view.logo_url)} alt="" className="max-w-[70%] max-h-[70%] object-contain" />
                            : <span className="text-2xl font-black text-slate-800">{view.business_name.slice(0, 1)}</span>}
                    </div>
                    <h1 className="text-2xl font-black text-slate-900 leading-tight">{view.business_name}</h1>
                    <p className="text-slate-500 font-medium mt-1">{tx("תשלום")}</p>
                </div>

                <div className="bg-white rounded-[2.5rem] shadow-2xl shadow-slate-200/50 border border-slate-100 overflow-hidden">
                    <div className="p-8 md:p-10 space-y-6 text-center">
                        {view.reported && (
                            <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-start text-sm font-bold text-emerald-800">
                                <CircleCheck className="w-5 h-5 shrink-0" aria-hidden />
                                {tx("קיבלנו — העסק קיבל הודעה ויאשר את התשלום בקרוב.")}
                            </div>
                        )}
                        <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 text-start">
                            <p className="text-slate-500 text-sm mb-2">{tx("היי {0}, לתשלום עבור:", { 0: view.client_first_name })}</p>
                            {view.title && <p className="text-lg font-extrabold text-slate-900">{view.title}</p>}
                            {view.items.map((i, n) => (
                                <div key={n} className="flex justify-between text-sm font-semibold text-slate-700 py-0.5">
                                    <span>{i.description}{i.quantity > 1 ? ` ×${i.quantity}` : ""}</span>
                                    <span dir="ltr">{ils(i.quantity * i.unit_price_cents)}</span>
                                </div>
                            ))}
                            {view.discount_cents > 0 && (
                                <div className="flex justify-between text-sm font-semibold text-rose-600 py-0.5">
                                    <span>{tx("הנחה")}</span><span dir="ltr">-{ils(view.discount_cents)}</span>
                                </div>
                            )}
                        </div>
                        <div>
                            <p className="text-slate-500 text-sm mb-2 font-bold">{tx("סכום לתשלום:")}</p>
                            <div className="text-5xl font-black text-slate-900 tracking-tighter" dir="ltr">{ils(view.amount_cents)}</div>
                        </div>

                        <div className="space-y-3 pt-2">
                            {view.bit_link && (
                                <a href={view.bit_link} target="_blank" rel="noopener noreferrer"
                                    className="flex items-center justify-center gap-3 w-full bg-[#005aff] text-white py-4 rounded-2xl font-black text-lg shadow-lg shadow-blue-500/30">
                                    {tx("תשלום מהיר ב-Bit")}
                                </a>
                            )}
                            {view.paybox_link && (
                                <a href={view.paybox_link} target="_blank" rel="noopener noreferrer"
                                    className="flex items-center justify-center gap-3 w-full bg-[#1bc6e5] text-white py-4 rounded-2xl font-black text-lg shadow-lg shadow-cyan-500/30">
                                    {tx("תשלום מהיר ב-Paybox")}
                                </a>
                            )}
                            {(view.bank_name || view.bank_account) && (
                                <details className="w-full">
                                    <summary className="flex items-center justify-center gap-2 w-full bg-slate-100 text-slate-700 py-4 rounded-2xl font-black text-lg cursor-pointer list-none">
                                        {tx("העברה בנקאית")}
                                    </summary>
                                    <div className="mt-2 bg-slate-50 border border-slate-200 rounded-2xl p-5 text-start space-y-1 text-sm font-semibold text-slate-700">
                                        {view.bank_name && <p>{tx("🏦 בנק: ")}{view.bank_name}</p>}
                                        {view.bank_branch && <p>{tx("🔢 סניף: ")}{view.bank_branch}</p>}
                                        {view.bank_account && <p>{tx("💳 מספר חשבון: ")}{view.bank_account}</p>}
                                    </div>
                                </details>
                            )}
                        </div>

                        {!view.reported && (
                            <div className="pt-6 border-t border-slate-100 space-y-4">
                                <ProofPicker file={proof} onChange={setProof} />
                                <textarea className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm outline-none focus:ring-2 focus:ring-slate-900"
                                    placeholder={tx("הערות לעסק (אופציונלי)")} rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
                                <button type="button" onClick={report} disabled={busy}
                                    className="w-full bg-sky-600 text-white py-4 rounded-2xl font-black text-lg shadow-xl shadow-sky-600/20 disabled:opacity-50">
                                    {busy ? tx("מעדכן...") : tx("שילמתי — עדכנו את העסק ✅")}
                                </button>
                                <p className="text-[11px] text-slate-400 leading-relaxed">
                                    {tx("בלחיצה העסק מקבל הודעה מיד, עם הצילום אם צירפת. הקבלה תישלח אליך אחרי שהעסק יאשר את התשלום.")}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function Notice({ title, text, ok = false }: { title: string; text: string; ok?: boolean }) {
    return (
        <div className="min-h-screen bg-[var(--background)] flex items-center justify-center p-6">
            <div className="max-w-sm w-full bg-white rounded-3xl shadow-xl border border-slate-100 p-8 text-center space-y-3">
                {ok && <CircleCheck className="w-14 h-14 mx-auto text-emerald-600" aria-hidden />}
                <p className="text-2xl font-black text-slate-900">{title}</p>
                <p className="text-slate-600">{text}</p>
            </div>
        </div>
    );
}

function ProofPicker({ file, onChange }: { file: File | null; onChange: (f: File | null) => void }) {
    const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
    useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
    if (file && preview) return (
        <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-2xl p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt={tx("צילום התשלום")} className="w-12 h-16 object-cover rounded-lg border border-slate-200" />
            <span className="flex-1 text-start text-sm font-semibold text-slate-700">{tx("הצילום יישלח לעסק")}</span>
            <button type="button" onClick={() => onChange(null)} aria-label={tx("הסרת הצילום")}
                className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-200">
                <X className="w-4 h-4" aria-hidden />
            </button>
        </div>
    );
    return (
        <label className="flex items-center justify-center gap-2 w-full border-2 border-dashed border-slate-300 rounded-2xl py-4 text-slate-600 font-bold cursor-pointer hover:bg-slate-50">
            <ImagePlus className="w-5 h-5" aria-hidden />
            {tx("צירוף צילום של אישור התשלום (לא חובה)")}
            <input type="file" accept="image/*" className="hidden" onChange={e => onChange(e.target.files?.[0] ?? null)} />
        </label>
    );
}
