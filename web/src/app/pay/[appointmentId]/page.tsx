"use client";

import { toast } from "@/lib/toast";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { CircleCheck, ImagePlus, X } from "lucide-react";
import { usePlatformTheme } from "@/lib/usePlatformTheme";

import { tx, intl, speakBusiness, langHeader } from "@/lib/i18n";
import AfterMount from "@/components/AfterMount";
const API = process.env.NEXT_PUBLIC_API_URL || "https://api.biz-control.com";

interface PublicPaymentInfo {
    id: string;
    client_name: string;
    appointment_title: string;
    starts_at: string;
    deposit_amount_cents: number;
    bit_link: string | null;
    paybox_link: string | null;
    bank_name: string | null;
    bank_branch: string | null;
    bank_account: string | null;
    theme_primary_color: string;
    theme_secondary_color: string;
    logo_filename: string | null;
    payment_sent: boolean;       // already tapped "שילמתי"
    payment_verified: boolean;   // the business approved the deposit
    has_proof: boolean;          // a picture of the payment is attached
    locale?: string;             // the business's language — the page speaks it
}

// The picture of the payment (a Bit screenshot…) — sent to the business with "שילמתי": most businesses send their
// messages through the platform's WhatsApp number, so a picture sent back on WhatsApp reaches nobody (2026-10-15).
async function sendProof(apptId: string, file: File) {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(`${API}/api/public/payment/${apptId}/proof`, { method: "POST", body, headers: langHeader() });
    if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail || tx("לא הצלחנו לשלוח את הצילום"));
    }
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
        <label className="flex items-center justify-center gap-2 w-full border-2 border-dashed border-slate-300 rounded-2xl py-4 text-slate-600 font-bold cursor-pointer hover:bg-slate-50 transition">
            <ImagePlus className="w-5 h-5" aria-hidden />
            {tx("צירוף צילום של אישור התשלום (לא חובה)")}
            <input type="file" accept="image/*" className="hidden" onChange={e => onChange(e.target.files?.[0] ?? null)} />
        </label>
    );
}

// in the browser only: the page speaks the business's language, which the server's first page doesn't know
export default function PublicPaymentPage() {
    return <AfterMount><PaymentPage /></AfterMount>;
}

function PaymentPage() {
    const params = useParams();
    const apptId = params.appointmentId as string;
    const theme = usePlatformTheme();

    const [loading, setLoading] = useState(true);
    const [info, setInfo] = useState<PublicPaymentInfo | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [done, setDone] = useState(false);
    const [notes, setNotes] = useState("");
    const [proof, setProof] = useState<File | null>(null);

    useEffect(() => {
        fetch(`${API}/api/public/payment/${apptId}`)
            .then(res => {
                if (!res.ok) throw new Error(tx("לא נמצאו פרטי תור"));
                return res.json();
            })
            .then((data: PublicPaymentInfo) => {
                speakBusiness(data.locale);
                setInfo(data);
                setLoading(false);
            })
            .catch(err => {
                setError(err.message);
                setLoading(false);
            });
    }, [apptId]);

    // came back after "שילמתי" without a picture — add it now
    const handleLateProof = async (file: File | null) => {
        if (!file || !info) return;
        setConfirming(true);
        try {
            await sendProof(apptId, file);
            setInfo({ ...info, has_proof: true });
            toast.success(tx("הצילום נשלח לעסק"));
        } catch (err: unknown) {
            toast.error((err as Error).message);
        } finally {
            setConfirming(false);
        }
    };

    const handleConfirm = async () => {
        setConfirming(true);
        try {
            if (proof) await sendProof(apptId, proof);
            const res = await fetch(`${API}/api/public/payment/${apptId}/confirm`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...langHeader() },
                body: JSON.stringify({ notes })
            });
            if (!res.ok) throw new Error(tx("שגיאה בעדכון התשלום"));
            setDone(true);
        } catch (err: any) {
            toast.error(err.message);
        } finally {
            setConfirming(false);
        }
    };

    if (loading) return (
        <div className="min-h-screen bg-[var(--background)] flex items-center justify-center p-6">
            <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin"></div>
                <p className="text-slate-500 font-medium">{tx("טוען פרטים...")}</p>
            </div>
        </div>
    );

    if (error || !info) return (
        <div className="min-h-screen bg-[var(--background)] flex items-center justify-center p-6">
            <div className="bg-white p-8 rounded-3xl shadow-xl border border-red-100 text-center max-w-sm w-full">
                <div className="text-4xl mb-4 text-red-500">❌</div>
                <h1 className="text-xl font-bold text-slate-900 mb-2">{tx("אופס, משהו השתבש")}</h1>
                <p className="text-slate-500">{error || tx("הקישור אינו תקין או פג תוקפו")}</p>
            </div>
        </div>
    );

    const date = new Date(info.starts_at);
    const amount = (info.deposit_amount_cents / 100).toFixed(2);

    if (info.payment_verified || (info.payment_sent && !done)) return (
        <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
            <CircleCheck className="w-20 h-20 text-emerald-500 mb-6" aria-hidden />
            <h1 className="text-2xl font-extrabold text-slate-900 mb-3">
                {info.payment_verified ? tx("המקדמה התקבלה והתור מאושר") : tx("כבר עדכנת שהעברת את המקדמה")}
            </h1>
            <p className="text-lg text-slate-600 max-w-md leading-relaxed">
                {info.payment_verified
                    ? <>{tx("התור שלך ל-")}<strong>{info.appointment_title}</strong>{tx(" ב-")}{date.toLocaleDateString(intl())}{tx(" מאושר. נתראה!")}</>
                    : tx("העסק קיבל את העדכון ויאשר את התשלום בקרוב.")}
            </p>
            {!info.payment_verified && !info.has_proof && (
                <div className="mt-8 w-full max-w-sm">
                    <ProofPicker file={null} onChange={handleLateProof} />
                    {confirming && <p className="mt-2 text-sm text-slate-500">{tx("שולח...")}</p>}
                </div>
            )}
            <div className="mt-12 text-slate-400 text-sm">{tx("ניתן לסגור את הדף.")}</div>
        </div>
    );

    if (done) return (
        <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
            <div className="w-24 h-24 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-4xl mb-8 animate-bounce">✓</div>
            <h1 className="text-3xl font-extrabold text-slate-900 mb-4">{tx("הדיווח התקבל בהצלחה!")}</h1>
            <p className="text-lg text-slate-600 max-w-md leading-relaxed">
                {tx("תודה")} {info.client_name}{tx(", הודענו לעסק שביצעת את התשלום. ")}<br />
                {tx("התור שלך ל-")}<strong>{info.appointment_title}</strong>{tx(" ב-")}{date.toLocaleDateString(intl())} {tx("ממתין לאישור סופי.")}
            </p>
            <div className="mt-12 text-slate-400 text-sm">{tx("ניתן לסגור את הדף.")}</div>
        </div>
    );

    return (
        <div className="min-h-screen bg-[var(--background)] flex flex-col items-center py-12 px-6">
            <div className="max-w-md w-full">
                {/* Header/Logo */}
                <div className="flex flex-col items-center text-center mb-10">
                    <div className="w-20 h-20 bg-white rounded-2xl shadow-lg flex items-center justify-center mb-4 border border-slate-100">
                        {info.logo_filename ? (
                            <img src={info.logo_filename.startsWith("http") ? info.logo_filename : `${API}/uploads/${info.logo_filename}`} alt="Logo" className="max-w-[70%] max-h-[70%] object-contain" />
                        ) : (
                            <span className="text-2xl font-bold" style={{ color: theme.primary }}>B</span>
                        )}
                    </div>
                    <h1 className="text-2xl font-black text-slate-900 leading-tight">{tx("אישור תשלום מקדמה")}</h1>
                    <p className="text-slate-500 font-medium mt-1">BizControl Studio System</p>
                </div>

                <div className="bg-white rounded-[2.5rem] shadow-2xl shadow-slate-200/50 border border-slate-100 overflow-hidden">
                    <div className="p-8 md:p-10">
                        <div className="space-y-6 text-center">
                            <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
                                <p className="text-slate-500 text-sm mb-1">{tx("היי ")}{info.client_name}{tx(", עבור התור:")}</p>
                                <h2 className="text-xl font-extrabold text-slate-900 mb-2">{info.appointment_title}</h2>
                                <div className="text-slate-600 font-bold flex items-center justify-center gap-2">
                                    <span>{date.toLocaleDateString(intl())}</span>
                                    <span>•</span>
                                    <span>{date.toLocaleTimeString(intl(), { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                            </div>

                            <div>
                                <p className="text-slate-500 text-sm mb-2 font-bold italic">{tx("נא להעביר מקדמה על סך:")}</p>
                                <div className="text-5xl font-black text-slate-900 tracking-tighter">
                                    ₪{amount}
                                </div>
                            </div>

                            <div className="space-y-3 pt-6">
                                {info.bit_link && (
                                    <a
                                        href={info.bit_link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center justify-center gap-3 w-full bg-[#005aff] text-white py-4 rounded-2xl font-black text-lg shadow-lg shadow-blue-500/30 hover:scale-[1.02] transition-transform active:scale-[0.98]"
                                    >
                                        <span>💙</span> {tx("תשלום מהיר ב-Bit")}
                                    </a>
                                )}
                                {info.paybox_link && (
                                    <a
                                        href={info.paybox_link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center justify-center gap-3 w-full bg-[#1bc6e5] text-white py-4 rounded-2xl font-black text-lg shadow-lg shadow-cyan-500/30 hover:scale-[1.02] transition-transform active:scale-[0.98]"
                                    >
                                        <span>💸</span> {tx("תשלום מהיר ב-Paybox")}
                                    </a>
                                )}
                                {(info.bank_name || info.bank_account) && (
                                    <details className="w-full">
                                        <summary className="flex items-center justify-center gap-2 w-full bg-slate-100 text-slate-700 py-4 rounded-2xl font-black text-lg cursor-pointer hover:bg-slate-200 transition-colors list-none">
                                            <span>🏦</span> {tx("העברה בנקאית")}
                                        </summary>
                                        <div className="mt-2 bg-slate-50 border border-slate-200 rounded-2xl p-5 text-start space-y-1 text-sm font-semibold text-slate-700">
                                            {info.bank_name && <p>{tx("🏦 בנק: ")}{info.bank_name}</p>}
                                            {info.bank_branch && <p>{tx("🔢 סניף: ")}{info.bank_branch}</p>}
                                            {info.bank_account && <p>{tx("💳 מספר חשבון: ")}{info.bank_account}</p>}
                                            <p className="text-slate-500 text-xs pt-1">{tx("לאחר ההעברה, לחץ על הכפתור למטה לאישור")}</p>
                                        </div>
                                    </details>
                                )}
                            </div>

                            <div className="pt-8 border-t border-slate-100 space-y-4">
                                <ProofPicker file={proof} onChange={setProof} />
                                <div className="text-start space-y-2">
                                    <label className="text-sm font-bold text-slate-700 ms-1">{tx("הערות לעסק (אופציונלי):")}</label>
                                    <textarea
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm outline-none focus:ring-2 focus:ring-slate-900 transition-all"
                                        placeholder={tx("למשל: שילמתי מחשבון של מישהו אחר...")}
                                        rows={2}
                                        value={notes}
                                        onChange={e => setNotes(e.target.value)}
                                    ></textarea>
                                </div>

                                <button
                                    onClick={handleConfirm}
                                    disabled={confirming}
                                    className="w-full bg-sky-600 text-white py-4 rounded-2xl font-black text-lg shadow-xl shadow-sky-600/20 hover:bg-slate-800 disabled:opacity-50 transition-all"
                                >
                                    {confirming ? tx("מעדכן...") : tx("לחצתי ושילמתי - עדכן את העסק! ✅")}
                                </button>
                                <p className="text-[11px] text-slate-400 leading-relaxed">
                                    {tx("בלחיצה על הכפתור העסק מקבל הודעה מיד, עם הצילום אם צירפת. אישור סופי יישלח אליך לאחר אימות התשלום.")}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-8 text-center text-slate-400 text-[10px] font-bold tracking-widest uppercase">
                    Powered by BizControl Advanced AI Studio System
                </div>
            </div>
        </div>
    );
}
