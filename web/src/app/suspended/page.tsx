"use client";

import AfterMount from "@/components/AfterMount";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Hourglass, Lock, Mail, MessageCircle, Trash2 } from "lucide-react";
import { clearToken } from "@/lib/api";
import { isNativeApp } from "@/lib/platform";
import { WHEN_EXPIRED } from "@/lib/planConsequences";

import { tx } from "@/lib/i18n";
function SuspendedContent() {
    const sp = useSearchParams();
    const reason = sp.get("reason");
    const isExpired = reason === "expired";
    const isDeleted = reason === "deleted";          // the owner deleted the business from the app
    // Apple: inside the app nothing asks to renew or buy — the contact stays, as plain contact
    const [isNative] = useState(() => isNativeApp());

    function logout() {
        clearToken();
        window.location.href = "/login";
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--background)] p-6">
            <div className="w-full max-w-sm text-center animate-page-in">

                <div className="w-20 h-20 rounded-3xl bg-white border border-slate-100 shadow-sm flex items-center justify-center mx-auto mb-6">
                    {isDeleted ? <Trash2 className="h-9 w-9 text-slate-500" /> : isExpired ? <Hourglass className="h-9 w-9 text-slate-500" /> : <Lock className="h-9 w-9 text-slate-500" />}
                </div>

                <h1 className="text-2xl font-bold text-slate-900 mb-2">
                    {isDeleted ? tx("העסק נמחק") : isExpired ? tx("המנוי הסתיים") : tx("החשבון הושהה")}
                </h1>
                <p className="text-slate-500 text-sm leading-relaxed mb-5">
                    {isDeleted
                        ? tx("העסק נמחק לבקשתך, וכל הנתונים יימחקו לצמיתות 30 יום אחרי הבקשה. התחרטתם? פנו אלינו לפני כן.")
                        : isExpired
                        ? (isNative ? tx("תוקף המנוי שלך פג.") : tx("תוקף המנוי שלך פג. עד לחידוש:"))
                        : tx("החשבון הושהה זמנית. לפרטים ולסיוע, פנה אלינו.")}
                </p>

                {isExpired && !isNative && (
                    <ul className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5 mb-5 space-y-2.5 text-start text-sm text-slate-600 leading-relaxed list-disc list-inside marker:text-slate-300">
                        {WHEN_EXPIRED.map(line => <li key={line}>{tx(line)}</li>)}
                    </ul>
                )}

                <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5 mb-5 space-y-2.5 text-start">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">{isDeleted || isNative ? tx("יצירת קשר") : tx("יצירת קשר לחידוש")}</p>

                    <a
                        href="https://wa.me/972528518805"
                        className="flex items-center gap-3 p-3.5 rounded-2xl bg-green-50 hover:bg-green-100 transition-colors"
                    >
                        <MessageCircle className="h-6 w-6 text-green-700 shrink-0" />
                        <div>
                            <div className="text-sm font-semibold text-green-800">WhatsApp</div>
                            <div className="text-xs text-green-600">{isDeleted || isNative ? tx("שלחו לנו הודעה") : tx("שלח הודעה לחידוש מיידי")}</div>
                        </div>
                    </a>

                    <a
                        href="mailto:ncbilutattoo@gmail.com"
                        className="flex items-center gap-3 p-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 transition-colors"
                    >
                        <Mail className="h-6 w-6 text-slate-600 shrink-0" />
                        <div>
                            <div className="text-sm font-semibold text-slate-800">{tx("אימייל")}</div>
                            <div className="text-xs text-slate-500 font-mono" dir="ltr">ncbilutattoo@gmail.com</div>
                        </div>
                    </a>
                </div>

                <button
                    onClick={logout}
                    className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                >
                    {tx("התנתקות וחזרה להתחברות")}
                </button>
            </div>
        </div>
    );
}

export default function SuspendedPage() {
    return (
        <AfterMount><Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900" />
            </div>
        }>
            <SuspendedContent />
        </Suspense></AfterMount>
    );
}
