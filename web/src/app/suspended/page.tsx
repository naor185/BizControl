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
        <div
            className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-6"
            dir="rtl"
        >
            <div className="w-full max-w-md text-center">
                <div className="text-6xl mb-6">{isExpired ? "⏳" : "🔒"}</div>

                <h1 className="text-2xl font-bold text-gray-900 mb-3">
                    {isExpired ? "המנוי שלך הסתיים" : "החשבון הושהה"}
                </h1>

                <p className="text-gray-500 mb-8 leading-relaxed">
                    {isExpired
                        ? "תוקף המנוי שלך פג. כדי לחדש ולהמשיך להשתמש במערכת, פנה אלינו."
                        : "החשבון שלך הושהה זמנית. לפרטים ולסיוע, פנה אלינו."}
                </p>

                <div className="bg-white rounded-2xl border shadow-sm p-6 mb-6 text-right space-y-3">
                    <div className="text-sm font-semibold text-gray-700 mb-4">יצירת קשר לחידוש</div>

                    <a
                        href="https://wa.me/972528518805"
                        className="flex items-center gap-3 p-3 rounded-xl bg-green-50 hover:bg-green-100 transition text-green-800 font-medium text-sm"
                    >
                        <span className="text-2xl">💬</span>
                        <div>
                            <div>WhatsApp</div>
                            <div className="text-xs font-normal text-green-600">שלח הודעה לחידוש מיידי</div>
                        </div>
                    </a>

                    <a
                        href="mailto:ncbilutattoo@gmail.com"
                        className="flex items-center gap-3 p-3 rounded-xl bg-blue-50 hover:bg-blue-100 transition text-blue-800 font-medium text-sm"
                    >
                        <span className="text-2xl">📧</span>
                        <div>
                            <div>אימייל</div>
                            <div className="text-xs font-normal text-blue-600">ncbilutattoo@gmail.com</div>
                        </div>
                    </a>
                </div>

                <button
                    onClick={logout}
                    className="text-sm text-gray-400 hover:text-gray-600 underline"
                >
                    התנתקות
                </button>
            </div>
        </div>
    );
}

export default function SuspendedPage() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center">טוען...</div>}>
            <SuspendedContent />
        </Suspense>
    );
}
