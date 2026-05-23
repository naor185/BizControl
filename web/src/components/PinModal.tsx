"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { setBusinessSession } from "@/lib/businessSession";

type Mode = "verify" | "set" | "change";

type Props = {
    mode: Mode;
    onSuccess: () => void;
    onClose?: () => void;
};

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

type ApiError = { message?: string };

export default function PinModal({ mode, onSuccess, onClose }: Props) {
    const [pin, setPin] = useState("");
    const [currentPin, setCurrentPin] = useState("");
    const [step, setStep] = useState<"current" | "new" | "confirm">(
        mode === "change" ? "current" : mode === "set" ? "new" : "verify"
    );
    const [confirmPin, setConfirmPin] = useState("");
    const [error, setError] = useState("");
    const [shake, setShake] = useState(false);
    const [loading, setLoading] = useState(false);
    const [locked, setLocked] = useState(false);
    const [lockMessage, setLockMessage] = useState("");

    const activePin = step === "current" ? currentPin : step === "confirm" ? confirmPin : pin;
    const setActivePin = step === "current" ? setCurrentPin : step === "confirm" ? setConfirmPin : setPin;

    const triggerShake = useCallback(() => {
        setShake(true);
        setTimeout(() => setShake(false), 600);
    }, []);

    const handleDigit = useCallback((d: string) => {
        if (locked || loading) return;
        if (d === "⌫") {
            setActivePin(p => p.slice(0, -1));
            setError("");
            return;
        }
        if (!d) return;
        setActivePin(p => {
            if (p.length >= 4) return p;
            return p + d;
        });
        setError("");
    }, [locked, loading, setActivePin]);

    // Keyboard support
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key >= "0" && e.key <= "9") handleDigit(e.key);
            else if (e.key === "Backspace") handleDigit("⌫");
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [handleDigit]);

    // Auto-submit when 4 digits entered
    useEffect(() => {
        if (activePin.length === 4) {
            const t = setTimeout(() => handleSubmit(), 200);
            return () => clearTimeout(t);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePin]);

    const handleSubmit = async () => {
        if (loading) return;
        const target = activePin;
        if (target.length < 4) return;

        if (step === "current") {
            setCurrentPin(target);
            setStep("new");
            setPin("");
            return;
        }

        if (step === "new") {
            setPin(target);
            setStep("confirm");
            setConfirmPin("");
            return;
        }

        if (step === "confirm") {
            if (target !== pin) {
                setError("הקודים אינם תואמים");
                triggerShake();
                setConfirmPin("");
                return;
            }
        }

        setLoading(true);
        setError("");

        try {
            if (mode === "verify") {
                const res = await apiFetch<{ business_token: string }>("/api/security/pin/verify", {
                    method: "POST",
                    body: JSON.stringify({ pin: target }),
                });
                setBusinessSession(res.business_token);
                onSuccess();
            } else {
                await apiFetch("/api/security/pin/set", {
                    method: "POST",
                    body: JSON.stringify({
                        pin: mode === "change" ? pin : target,
                        current_pin: mode === "change" ? currentPin : undefined,
                    }),
                });
                onSuccess();
            }
        } catch (e: unknown) {
            const err = e as ApiError;
            const msg = err.message || "שגיאה";
            if (msg.includes("נעול") || msg.includes("ניסיונות")) {
                setLocked(true);
                setLockMessage(msg);
            } else {
                setError(msg);
                triggerShake();
            }
            setActivePin("");
        } finally {
            setLoading(false);
        }
    };

    const stepLabel = {
        verify: "הזן PIN",
        current: "PIN נוכחי",
        new: "PIN חדש",
        confirm: "אשר PIN",
    }[step];

    const stepHint = {
        verify: "הזן את ה-PIN שלך כדי לגשת לניהול עסק",
        current: "הזן את ה-PIN הנוכחי שלך",
        new: "בחר PIN חדש (4 ספרות)",
        confirm: "הזן שוב את ה-PIN החדש לאישור",
    }[step];

    const currentDots = step === "current" ? currentPin : step === "confirm" ? confirmPin : pin;

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" dir="rtl">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className={`relative w-full sm:w-96 bg-white sm:rounded-3xl rounded-t-3xl shadow-2xl overflow-hidden transition-all ${shake ? "animate-[shake_0.5s_ease-in-out]" : ""}`}
                style={{ boxShadow: "0 25px 60px -12px rgba(0,0,0,0.4)" }}>

                {/* Top bar */}
                <div className="h-1 w-full bg-gradient-to-r from-violet-500 via-purple-500 to-indigo-500" />

                {/* Header */}
                <div className="pt-7 pb-4 px-6 text-center">
                    <div className="w-14 h-14 bg-gradient-to-br from-violet-600 to-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-violet-500/30">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-white">
                            <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" fill="none" />
                            <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            <circle cx="12" cy="16" r="1.5" fill="currentColor" />
                        </svg>
                    </div>
                    <h2 className="text-lg font-bold text-slate-900">ניהול עסק</h2>
                    <p className="text-sm text-slate-500 mt-1">{stepHint}</p>

                    {/* Step indicator for set/change */}
                    {(mode === "set" || mode === "change") && (
                        <div className="flex justify-center gap-2 mt-3">
                            {(mode === "change" ? ["current", "new", "confirm"] : ["new", "confirm"]).map((s, i) => (
                                <div key={s} className={`h-1 w-8 rounded-full transition-colors ${
                                    (mode === "change" ? ["current", "new", "confirm"] : ["new", "confirm"]).indexOf(step) >= i
                                        ? "bg-violet-500" : "bg-slate-200"
                                }`} />
                            ))}
                        </div>
                    )}
                </div>

                {/* PIN dots */}
                <div className="flex justify-center gap-5 py-5">
                    {[0, 1, 2, 3].map(i => (
                        <div
                            key={i}
                            className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
                                currentDots.length > i
                                    ? "bg-violet-600 border-violet-600 scale-110"
                                    : "bg-transparent border-slate-300"
                            }`}
                        />
                    ))}
                </div>

                {/* Error */}
                {error && (
                    <div className="mx-6 mb-3 text-center text-sm font-medium text-rose-600 bg-rose-50 rounded-xl py-2 px-3">
                        {error}
                    </div>
                )}

                {locked && (
                    <div className="mx-6 mb-3 text-center text-sm font-medium text-orange-700 bg-orange-50 rounded-xl py-3 px-3 space-y-1">
                        <div className="font-bold">🔒 {lockMessage}</div>
                    </div>
                )}

                {/* Numeric pad */}
                {!locked && (
                    <div className="grid grid-cols-3 gap-2 px-6 pb-6">
                        {DIGITS.map((d, i) => (
                            <button
                                key={i}
                                onClick={() => handleDigit(d)}
                                disabled={loading || !d && d !== "0"}
                                className={`
                                    h-16 rounded-2xl text-xl font-semibold transition-all active:scale-90
                                    ${d === "⌫"
                                        ? "bg-slate-100 text-slate-500 hover:bg-slate-200"
                                        : d === ""
                                            ? ""
                                            : "bg-slate-100 text-slate-900 hover:bg-violet-50 hover:text-violet-700 hover:border hover:border-violet-200 shadow-sm"
                                    }
                                    ${loading ? "opacity-50 cursor-not-allowed" : ""}
                                `}
                            >
                                {loading && d === "0" ? (
                                    <span className="inline-block w-5 h-5 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin" />
                                ) : d}
                            </button>
                        ))}
                    </div>
                )}

                {/* Footer: cancel + forgot */}
                <div className="border-t border-slate-100 px-6 py-4 flex justify-between items-center">
                    {onClose ? (
                        <button onClick={onClose} className="text-sm text-slate-400 hover:text-slate-600 transition-colors">
                            ביטול
                        </button>
                    ) : <span />}
                    {mode === "verify" && (
                        <span className="text-xs text-slate-400">5 ניסיונות מקסימום</span>
                    )}
                </div>
            </div>

            <style jsx global>{`
                @keyframes shake {
                    0%, 100% { transform: translateX(0); }
                    10%, 50%, 90% { transform: translateX(-8px); }
                    30%, 70% { transform: translateX(8px); }
                }
            `}</style>
        </div>
    );
}
