"use client";
import { toast } from "@/lib/toast";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

type VarStatus = Record<string, boolean>;

type WalletSystemStatus = {
    apple: { configured: boolean; vars: VarStatus };
    google: { configured: boolean; vars: VarStatus };
};

const APPLE_VAR_LABELS: Record<string, string> = {
    APPLE_WALLET_PASS_TYPE_ID: "Pass Type ID",
    APPLE_WALLET_TEAM_ID: "Team ID",
    APPLE_WALLET_CERT_PEM: "Certificate PEM",
    APPLE_WALLET_CERT_KEY_PEM: "Certificate Private Key",
    APPLE_WALLET_WWDR_PEM: "Apple WWDR CA Certificate",
};

const GOOGLE_VAR_LABELS: Record<string, string> = {
    GOOGLE_WALLET_SERVICE_ACCOUNT_JSON: "Service Account JSON",
    GOOGLE_WALLET_ISSUER_ID: "Issuer ID",
};

function EnvRow({ name, label, set }: { name: string; label: string; set: boolean }) {
    return (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${set ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-200"}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${set ? "bg-emerald-500 text-white" : "bg-rose-400 text-white"}`}>
                {set ? "✓" : "✗"}
            </div>
            <div className="flex-1 min-w-0">
                <div className={`text-sm font-bold ${set ? "text-emerald-800" : "text-rose-800"}`}>{label}</div>
                <div className="text-xs font-mono text-slate-500 truncate">{name}</div>
            </div>
            <span className={`text-[11px] font-black px-2 py-0.5 rounded-full ${set ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                {set ? "SET" : "MISSING"}
            </span>
        </div>
    );
}

function ProviderCard({
    title,
    icon,
    configured,
    vars,
    varLabels,
    description,
}: {
    title: string;
    icon: string;
    configured: boolean;
    vars: VarStatus;
    varLabels: Record<string, string>;
    description: string;
}) {
    return (
        <div className={`bg-white rounded-3xl border shadow-sm overflow-hidden ${configured ? "border-emerald-100" : "border-slate-100"}`}>
            {/* Header */}
            <div className={`px-6 py-5 border-b ${configured ? "bg-emerald-50/50 border-emerald-100" : "bg-slate-50 border-slate-100"}`}>
                <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl font-black shadow-sm ${configured ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
                        {icon}
                    </div>
                    <div>
                        <div className="font-black text-slate-900 text-lg">{title}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{description}</div>
                    </div>
                    <div className="mr-auto">
                        <span className={`text-xs font-black px-3 py-1.5 rounded-full ${configured ? "bg-emerald-100 text-emerald-700 border border-emerald-200" : "bg-amber-100 text-amber-700 border border-amber-200"}`}>
                            {configured ? "✅ מוגדר ומוכן" : "⚠️ חסרים פרמטרים"}
                        </span>
                    </div>
                </div>
            </div>

            {/* Env vars */}
            <div className="p-5 space-y-2">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Environment Variables</div>
                {Object.entries(vars).map(([name, isSet]) => (
                    <EnvRow key={name} name={name} label={varLabels[name] ?? name} set={isSet} />
                ))}
            </div>
        </div>
    );
}

export default function AdminWalletPage() {
    const [status, setStatus] = useState<WalletSystemStatus | null>(null);
    const [loading, setLoading] = useState(true);

    const load = () => {
        setLoading(true);
        apiFetch<WalletSystemStatus>("/api/admin/wallet-system")
            .then(s => setStatus(s))
            .catch(() => toast.error("שגיאה בטעינת סטטוס Wallet"))
            .finally(() => setLoading(false));
    };

    useEffect(() => { load(); }, []);

    const appleOk = status?.apple.configured ?? false;
    const googleOk = status?.google.configured ?? false;
    const allOk = appleOk && googleOk;

    return (
        <div className="max-w-3xl mx-auto py-8 px-4 space-y-8" dir="rtl">

            {/* Page header */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-900">Wallet System Settings</h1>
                    <p className="text-slate-500 text-sm mt-1">הגדרות מרכזיות עבור Apple Wallet ו-Google Wallet — גלויות לסופר אדמין בלבד</p>
                </div>
                <button
                    onClick={load}
                    className="px-4 py-2 text-sm font-bold bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors text-slate-700"
                >
                    רענן
                </button>
            </div>

            {/* Global status banner */}
            <div className={`rounded-3xl p-5 border ${allOk ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
                <div className="flex items-center gap-4">
                    <div className={`text-4xl ${allOk ? "" : "grayscale opacity-60"}`}>
                        {allOk ? "🚀" : "⚙️"}
                    </div>
                    <div>
                        <div className={`font-black text-lg ${allOk ? "text-emerald-800" : "text-amber-800"}`}>
                            {allOk ? "Wallet System — מוכן לפעולה" : "Wallet System — טרם הוגדר"}
                        </div>
                        <div className={`text-sm mt-0.5 ${allOk ? "text-emerald-700" : "text-amber-700"}`}>
                            {allOk
                                ? "כל הפרמטרים מוגדרים. כפתורי Apple/Google Wallet יופיעו אוטומטית בפורטל הלקוחות."
                                : "הגדר את משתני הסביבה החסרים בסביבת הייצור (Railway / Render) כדי להפעיל את שירות ה-Wallet."}
                        </div>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-16">
                    <div className="w-10 h-10 rounded-full border-4 border-slate-200 border-t-indigo-500 animate-spin" />
                </div>
            ) : status && (
                <div className="space-y-6">
                    <ProviderCard
                        title="Apple Wallet"
                        icon=""
                        configured={status.apple.configured}
                        vars={status.apple.vars}
                        varLabels={APPLE_VAR_LABELS}
                        description="Apple Developer Certificate + Pass Type ID נדרשים"
                    />

                    <ProviderCard
                        title="Google Wallet"
                        icon="G"
                        configured={status.google.configured}
                        vars={status.google.vars}
                        varLabels={GOOGLE_VAR_LABELS}
                        description="Google Cloud Service Account + Issuer ID נדרשים"
                    />
                </div>
            )}

            {/* Instructions */}
            <div className="bg-slate-50 rounded-3xl border border-slate-200 p-6 space-y-4 text-sm text-slate-600">
                <div className="font-black text-slate-800 text-base">כיצד להגדיר</div>
                <div className="space-y-2">
                    <div className="font-bold text-slate-700">Apple Wallet:</div>
                    <ol className="list-decimal list-inside space-y-1 text-xs leading-relaxed pr-2">
                        <li>צור Pass Type ID ב-Apple Developer Console</li>
                        <li>הורד את ה-Certificate (.p12) ועבד אותו ל-PEM</li>
                        <li>הורד את ה-WWDR Certificate מ-Apple</li>
                        <li>קד את כל הקבצים ב-base64 והגדר כ-ENV vars ב-Railway</li>
                    </ol>
                </div>
                <div className="space-y-2">
                    <div className="font-bold text-slate-700">Google Wallet:</div>
                    <ol className="list-decimal list-inside space-y-1 text-xs leading-relaxed pr-2">
                        <li>צור פרויקט ב-Google Cloud עם Google Wallet API</li>
                        <li>צור Service Account עם Wallet Object Issuer role</li>
                        <li>הורד את קובץ ה-JSON וקד אותו ב-base64</li>
                        <li>קבל Issuer ID מ-Google Pay & Wallet Console</li>
                    </ol>
                </div>
            </div>
        </div>
    );
}
