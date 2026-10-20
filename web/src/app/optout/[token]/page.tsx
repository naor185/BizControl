"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { imgUrl } from "@/lib/api";

import { tx, speakBusiness } from "@/lib/i18n";
import AfterMount from "@/components/AfterMount";
const API = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/$/, "");

type Info = { studio_name: string; logo_url: string | null; message: string; locale?: string };   // locale: the business's language

// in the browser only: the page speaks the business's language, which the server's first page doesn't know
export default function OptoutPage() {
    return <AfterMount><Optout /></AfterMount>;
}

function Optout() {
    const { token } = useParams() as { token: string };
    const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
    const [info, setInfo] = useState<Info | null>(null);

    useEffect(() => {
        fetch(`${API}/api/public/invite/${token}/info`)
            .then(r => r.ok ? r.json() : null)
            .then((d: Info | null) => { if (d) speakBusiness(d.locale); setInfo(d); })
            .catch(() => setInfo(null));
    }, [token]);

    const handleOptout = async () => {
        setState("loading");
        try {
            const r = await fetch(`${API}/api/public/invite/${token}/optout`, { method: "POST" });
            setState(r.ok ? "done" : "error");
        } catch {
            setState("error");
        }
    };

    return (
        <div className="min-h-screen bg-[var(--background)] flex items-center justify-center p-6">
            <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
                {info?.logo_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imgUrl(info.logo_url)} alt={info.studio_name} className="h-14 mx-auto mb-4 object-contain" />
                )}
                {info?.studio_name && (
                    <div className="text-xs font-semibold text-slate-400 mb-4">{info.studio_name}</div>
                )}
                {state === "done" ? (
                    <>
                        <div className="text-5xl mb-4">✅</div>
                        <h1 className="text-xl font-bold text-slate-800 mb-2">{tx("הוסרת מרשימת ההודעות")}</h1>
                        <p className="text-slate-500 text-sm">{tx("לא תקבל/י יותר הודעות שיווקיות אוטומטיות")}{info?.studio_name ? tx(" מ-{0}", { 0: info.studio_name }) : ""}.</p>
                    </>
                ) : state === "error" ? (
                    <>
                        <div className="text-5xl mb-4">😔</div>
                        <h1 className="text-xl font-bold text-red-500 mb-2">{tx("משהו השתבש")}</h1>
                        <button onClick={() => setState("idle")} className="mt-3 text-sm text-slate-400 underline">{tx("נסה שוב")}</button>
                    </>
                ) : (
                    <>
                        <div className="text-5xl mb-4">🔕</div>
                        <h1 className="text-xl font-bold text-slate-800 mb-2">{tx("הסרה מרשימת ההודעות")}</h1>
                        <p className="text-slate-500 text-sm mb-6 leading-relaxed">
                            {info?.message || tx("לחיצה על הכפתור תסיר אותך מקבלת הודעות שיווקיות אוטומטיות.")}
                        </p>
                        <button
                            onClick={handleOptout}
                            disabled={state === "loading"}
                            className="w-full py-3 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white font-bold text-sm transition-colors">
                            {state === "loading" ? tx("מעבד...") : tx("הסר/י אותי מרשימת ההודעות")}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
