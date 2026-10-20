"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Check, Clock, HeartPulse } from "lucide-react";
import { API_BASE } from "@/lib/api";
import HealthFormFill, { type ClientPart, type HealthFormView } from "@/components/health/HealthFormFill";

import { tx, speakBusiness, langHeader } from "@/lib/i18n";
import AfterMount from "@/components/AfterMount";
// The health declaration from the link a business sent on WhatsApp — the client fills and signs on their own phone,
// without signing in (the token in the link is the key: /api/public/health/{token}, app/services/health_forms.py).
// Once filled the link closes, and shows nothing of what was signed.

type View = ((HealthFormView & { status: "waiting_client" }) | { status: "signed"; business_name: string } | { status: "expired"; business_name: string })
    & { locale?: string };   // the business's language — the page speaks it

// in the browser only: the page speaks the business's language, which the server's first page doesn't know
export default function HealthLinkPage() {
    return <AfterMount><HealthLink /></AfterMount>;
}

function HealthLink() {
    const { token } = useParams<{ token: string }>();
    const [view, setView] = useState<View | null>(null);
    const [missing, setMissing] = useState(false);
    const url = `${API_BASE}/api/public/health/${token}`;

    useEffect(() => {
        fetch(url).then(r => (r.ok ? r.json() : Promise.reject(r.status)))
            .then((v: View) => { speakBusiness(v.locale); setView(v); }).catch(() => setMissing(true));
    }, [url]);

    const sign = async (part: ClientPart) => {
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...langHeader() }, body: JSON.stringify(part) });
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error(data?.detail || tx("השליחה נכשלה, נסו שוב"));
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
        <main className="min-h-screen bg-[var(--background)]">
            <div className="max-w-2xl mx-auto px-4 py-6">
                {missing ? notice(<HeartPulse className="h-12 w-12 mx-auto text-slate-300" aria-hidden />, tx("הקישור לא נמצא"),
                    tx("ייתכן שהוא הועתק חלקית. בקשו מהעסק לשלוח אותו שוב."))
                    : !view ? <p className="text-center text-slate-400 py-20">{tx("טוען...")}</p>
                    : view.status === "signed" ? notice(<Check className="h-14 w-14 mx-auto text-emerald-600" aria-hidden />, tx("תודה! ההצהרה נשלחה"),
                        tx("הצהרת הבריאות נשמרה אצל {0}. נתראה בתור.", { 0: view.business_name }))
                    : view.status === "expired" ? notice(<Clock className="h-12 w-12 mx-auto text-slate-400" aria-hidden />, tx("הקישור כבר לא בתוקף"),
                        tx("בקשו מ-{0} לשלוח קישור חדש.", { 0: view.business_name }))
                    : <HealthFormFill form={view} fileSrc={view.file ? `${url}/file` : null} onSubmit={sign} />}
            </div>
        </main>
    );
}
