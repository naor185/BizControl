"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Check, Clock, HeartPulse } from "lucide-react";
import { API_BASE } from "@/lib/api";
import HealthFormFill, { type ClientPart, type HealthFormView } from "@/components/health/HealthFormFill";

// The health declaration from the link a business sent on WhatsApp — the client fills and signs on their own phone,
// without signing in (the token in the link is the key: /api/public/health/{token}, app/services/health_forms.py).
// Once filled the link closes, and shows nothing of what was signed.

type View = (HealthFormView & { status: "waiting_client" }) | { status: "signed"; business_name: string } | { status: "expired"; business_name: string };

export default function HealthLinkPage() {
    const { token } = useParams<{ token: string }>();
    const [view, setView] = useState<View | null>(null);
    const [missing, setMissing] = useState(false);
    const url = `${API_BASE}/api/public/health/${token}`;

    useEffect(() => {
        fetch(url).then(r => (r.ok ? r.json() : Promise.reject(r.status)))
            .then(setView).catch(() => setMissing(true));
    }, [url]);

    const sign = async (part: ClientPart) => {
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(part) });
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error(data?.detail || "השליחה נכשלה, נסו שוב");
        setView(data);
        window.scrollTo({ top: 0 });
    };

    const notice = (icon: React.ReactNode, title: string, text: string) => (
        <div className="text-center space-y-4 py-20">
            {icon}
            <p className="text-2xl font-black text-slate-900">{title}</p>
            <p className="text-slate-600">{text}</p>
        </div>
    );

    return (
        <main className="min-h-screen bg-slate-50" dir="rtl">
            <div className="max-w-2xl mx-auto px-4 py-6">
                {missing ? notice(<HeartPulse className="h-12 w-12 mx-auto text-slate-300" aria-hidden />, "הקישור לא נמצא",
                    "ייתכן שהוא הועתק חלקית. בקשו מהעסק לשלוח אותו שוב.")
                    : !view ? <p className="text-center text-slate-400 py-20">טוען...</p>
                    : view.status === "signed" ? notice(<Check className="h-14 w-14 mx-auto text-emerald-600" aria-hidden />, "תודה! ההצהרה נשלחה",
                        `הצהרת הבריאות נשמרה אצל ${view.business_name}. נתראה בתור.`)
                    : view.status === "expired" ? notice(<Clock className="h-12 w-12 mx-auto text-slate-400" aria-hidden />, "הקישור כבר לא בתוקף",
                        `בקשו מ-${view.business_name} לשלוח קישור חדש.`)
                    : <HealthFormFill form={view} fileSrc={view.file ? `${url}/file` : null} onSubmit={sign} />}
            </div>
        </main>
    );
}
