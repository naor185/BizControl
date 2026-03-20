"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface PublicPaymentInfo {
    id: string;
    client_name: string;
    appointment_title: string;
    starts_at: string;
    deposit_amount_cents: number;
    bit_link: string | null;
    paybox_link: string | null;
    theme_primary_color: string;
    theme_secondary_color: string;
    logo_filename: string | null;
}

export default function PublicPaymentPage() {
    const params = useParams();
    const apptId = params.appointmentId as string;

    const [loading, setLoading] = useState(true);
    const [info, setInfo] = useState<PublicPaymentInfo | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [done, setDone] = useState(false);
    const [notes, setNotes] = useState("");

    useEffect(() => {
        fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/public/payment/${apptId}`)
            .then(res => {
                if (!res.ok) throw new Error("לא נמצאו פרטי תור");
                return res.json();
            })
            .then(data => {
                setInfo(data);
                setLoading(false);
            })
            .catch(err => {
                setError(err.message);
                setLoading(false);
            });
    }, [apptId]);

    const handleConfirm = async () => {
        setConfirming(true);
        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/public/payment/${apptId}/confirm`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ notes })
            });
            if (!res.ok) throw new Error("שגיאה בעדכון התשלום");
            setDone(true);
        } catch (err: any) {
            alert(err.message);
        } finally {
            setConfirming(false);
        }
    };

    if (loading) return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
            <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin"></div>
                <p className="text-slate-500 font-medium">טוען פרטים...</p>
            </div>
        </div>
    );

    if (error || !info) return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
            <div className="bg-white p-8 rounded-3xl shadow-xl border border-red-100 text-center max-w-sm w-full">
                <div className="text-4xl mb-4 text-red-500">❌</div>
                <h1 className="text-xl font-bold text-slate-900 mb-2">אופס, משהו השתבש</h1>
                <p className="text-slate-500">{error || "הקישור אינו תקין או פג תוקפו"}</p>
            </div>
        </div>
    );

    const date = new Date(info.starts_at);
    const amount = (info.deposit_amount_cents / 100).toFixed(2);

    if (done) return (
        <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center" dir="rtl">
            <div className="w-24 h-24 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-4xl mb-8 animate-bounce">✓</div>
            <h1 className="text-3xl font-extrabold text-slate-900 mb-4">הדיווח התקבל בהצלחה!</h1>
            <p className="text-lg text-slate-600 max-w-md leading-relaxed">
                תודה {info.client_name}, הודענו לסטודיו שביצעת את התשלום. <br />
                התור שלך ל-<strong>{info.appointment_title}</strong> ב-{date.toLocaleDateString('he-IL')} ממתין לאישור סופי.
            </p>
            <div className="mt-12 text-slate-400 text-sm">ניתן לסגור את הדף.</div>
        </div>
    );

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center py-12 px-6" dir="rtl">
            <div className="max-w-md w-full">
                {/* Header/Logo */}
                <div className="flex flex-col items-center text-center mb-10">
                    <div className="w-20 h-20 bg-white rounded-2xl shadow-lg flex items-center justify-center mb-4 border border-slate-100">
                        {info.logo_filename ? (
                            <img src={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/uploads/${info.logo_filename}`} alt="Logo" className="max-w-[70%] max-h-[70%] object-contain" />
                        ) : (
                            <span className="text-2xl font-bold" style={{ color: info.theme_primary_color }}>B</span>
                        )}
                    </div>
                    <h1 className="text-2xl font-black text-slate-900 leading-tight">אישור תשלום מקדמה</h1>
                    <p className="text-slate-500 font-medium mt-1">BizControl Studio System</p>
                </div>

                <div className="bg-white rounded-[2.5rem] shadow-2xl shadow-slate-200/50 border border-slate-100 overflow-hidden">
                    <div className="p-8 md:p-10">
                        <div className="space-y-6 text-center">
                            <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
                                <p className="text-slate-500 text-sm mb-1">היי {info.client_name}, עבור התור:</p>
                                <h2 className="text-xl font-extrabold text-slate-900 mb-2">{info.appointment_title}</h2>
                                <div className="text-slate-600 font-bold flex items-center justify-center gap-2">
                                    <span>{date.toLocaleDateString('he-IL')}</span>
                                    <span>•</span>
                                    <span>{date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                            </div>

                            <div>
                                <p className="text-slate-500 text-sm mb-2 font-bold italic">נא להעביר מקדמה על סך:</p>
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
                                        שילום מהיר ב-Bit 📱
                                    </a>
                                )}
                                {info.paybox_link && (
                                    <a
                                        href={info.paybox_link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center justify-center gap-3 w-full bg-[#1bc6e5] text-white py-4 rounded-2xl font-black text-lg shadow-lg shadow-cyan-500/30 hover:scale-[1.02] transition-transform active:scale-[0.98]"
                                    >
                                        שילום מהיר ב-Paybox 💸
                                    </a>
                                )}
                            </div>

                            <div className="pt-8 border-t border-slate-100 space-y-4">
                                <div className="text-right space-y-2">
                                    <label className="text-sm font-bold text-slate-700 mr-1">הערות לסטודיו (אופציונלי):</label>
                                    <textarea
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm outline-none focus:ring-2 focus:ring-slate-900 transition-all"
                                        placeholder="למשל: שילמתי מחשבון של מישהו אחר..."
                                        rows={2}
                                        value={notes}
                                        onChange={e => setNotes(e.target.value)}
                                    ></textarea>
                                </div>

                                <button
                                    onClick={handleConfirm}
                                    disabled={confirming}
                                    className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-lg shadow-xl shadow-slate-900/20 hover:bg-slate-800 disabled:opacity-50 transition-all"
                                >
                                    {confirming ? "מעדכן..." : "לחצתי ושילמתי - עדכן את הסטודיו! ✅"}
                                </button>
                                <p className="text-[11px] text-slate-400 leading-relaxed">
                                    בלחיצה על הכפתור, המערכת תשלח הודעה אוטומטית למקעקע. אישור סופי יישלח אליך לאחר אימות התשלום.
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
