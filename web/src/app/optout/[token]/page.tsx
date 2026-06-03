"use client";
import { useState } from "react";
import { useParams } from "next/navigation";

const API = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/$/, "");

export default function OptoutPage() {
    const { token } = useParams() as { token: string };
    const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

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
        <div dir="rtl" className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
            <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
                {state === "done" ? (
                    <>
                        <div className="text-5xl mb-4">✅</div>
                        <h1 className="text-xl font-bold text-slate-800 mb-2">הוסרת מרשימת ההודעות</h1>
                        <p className="text-slate-500 text-sm">לא תקבל/י יותר הודעות שיווקיות אוטומטיות.</p>
                    </>
                ) : state === "error" ? (
                    <>
                        <div className="text-5xl mb-4">😔</div>
                        <h1 className="text-xl font-bold text-red-500 mb-2">משהו השתבש</h1>
                        <button onClick={() => setState("idle")} className="mt-3 text-sm text-slate-400 underline">נסה שוב</button>
                    </>
                ) : (
                    <>
                        <div className="text-5xl mb-4">🔕</div>
                        <h1 className="text-xl font-bold text-slate-800 mb-2">הסרה מרשימת ההודעות</h1>
                        <p className="text-slate-500 text-sm mb-6 leading-relaxed">
                            לחיצה על הכפתור תסיר אותך מקבלת הודעות שיווקיות אוטומטיות.
                        </p>
                        <button
                            onClick={handleOptout}
                            disabled={state === "loading"}
                            className="w-full py-3 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white font-bold text-sm transition-colors">
                            {state === "loading" ? "מעבד..." : "הסר/י אותי מרשימת ההודעות"}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
