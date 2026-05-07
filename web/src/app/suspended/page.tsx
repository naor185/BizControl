"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { clearToken } from "@/lib/api";

function SuspendedContent() {
    const sp = useSearchParams();
    const reason = sp.get("reason");
    const isExpired = reason === "expired";

    function logout() {
        clearToken();
        window.location.href = "/login";
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6" dir="rtl">
            <div className="w-full max-w-sm text-center animate-page-in">

                <div className="w-20 h-20 rounded-3xl bg-white border border-slate-100 shadow-sm flex items-center justify-center text-4xl mx-auto mb-6">
                    {isExpired ? "⏳" : "🔒"}
                </div>

                <h1 className="text-2xl font-bold text-slate-900 mb-2">
                    {isExpired ? "המנוי הסתיים" : "החשבון הושהה"}
                </h1>
                <p className="text-slate-500 text-sm leading-relaxed mb-8">
                    {isExpired
                        ? "תוקף המנוי שלך פג. כדי לחדש ולהמשיך להשתמש במערכת, פנה אלינו."
                        : "החשבון הושהה זמנית. לפרטים ולסיוע, פנה אלינו."}
                </p>

                <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5 mb-5 space-y-2.5 text-right">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">יצירת קשר לחידוש</p>

                    <a
                        href="https://wa.me/972528518805"
                        className="flex items-center gap-3 p-3.5 rounded-2xl bg-green-50 hover:bg-green-100 transition-colors"
                    >
                        <span className="text-2xl leading-none">💬</span>
                        <div>
                            <div className="text-sm font-semibold text-green-800">WhatsApp</div>
                            <div className="text-xs text-green-600">שלח הודעה לחידוש מיידי</div>
                        </div>
                    </a>

                    <a
                        href="mailto:ncbilutattoo@gmail.com"
                        className="flex items-center gap-3 p-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 transition-colors"
                    >
                        <span className="text-2xl leading-none">📧</span>
                        <div>
                            <div className="text-sm font-semibold text-slate-800">אימייל</div>
                            <div className="text-xs text-slate-500 font-mono" dir="ltr">ncbilutattoo@gmail.com</div>
                        </div>
                    </a>
                </div>

                <button
                    onClick={logout}
                    className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                >
                    התנתקות וחזרה להתחברות
                </button>
            </div>
        </div>
    );
}

export default function SuspendedPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900" />
            </div>
        }>
            <SuspendedContent />
        </Suspense>
    );
}
