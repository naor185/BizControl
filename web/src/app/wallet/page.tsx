"use client";
import { toast } from "@/lib/toast";

import { useEffect, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";

type Design = {
    background_color: string;
    text_color: string;
    strip_color: string;
    label_color: string;
    logo_url: string | null;
    show_points: boolean;
    show_tier: boolean;
    show_barcode: boolean;
    card_title: string | null;
    card_description: string | null;
};

const DEFAULT_DESIGN: Design = {
    background_color: "#1a1a2e",
    text_color: "#ffffff",
    strip_color: "#6366f1",
    label_color: "#a5b4fc",
    logo_url: null,
    show_points: true,
    show_tier: true,
    show_barcode: true,
    card_title: null,
    card_description: null,
};

function CardPreview({ d, studioName }: { d: Design; studioName: string }) {
    return (
        <div
            className="relative w-80 rounded-3xl overflow-hidden shadow-2xl select-none"
            style={{ background: d.background_color, color: d.text_color, minHeight: 200 }}
        >
            {/* Strip bar at top */}
            <div className="h-3 w-full" style={{ background: d.strip_color }} />

            <div className="px-6 py-5 space-y-4">
                {/* Header row */}
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-xs font-semibold opacity-60 uppercase tracking-widest"
                            style={{ color: d.label_color }}>מועדון לקוחות</div>
                        <div className="text-lg font-black leading-tight mt-0.5">
                            {d.card_title || studioName}
                        </div>
                    </div>
                    {d.logo_url ? (
                        <img src={d.logo_url} alt="logo" className="w-12 h-12 rounded-xl object-cover" />
                    ) : (
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                            style={{ background: d.strip_color }}>💎</div>
                    )}
                </div>

                {/* Name */}
                <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest opacity-50"
                        style={{ color: d.label_color }}>שם חבר/ה</div>
                    <div className="text-base font-bold">שם הלקוח</div>
                </div>

                {/* Points row */}
                {d.show_points && (
                    <div className="flex gap-6">
                        <div>
                            <div className="text-[10px] font-bold uppercase tracking-widest opacity-50"
                                style={{ color: d.label_color }}>נקודות</div>
                            <div className="text-2xl font-black">1,250</div>
                        </div>
                        {d.show_tier && (
                            <div>
                                <div className="text-[10px] font-bold uppercase tracking-widest opacity-50"
                                    style={{ color: d.label_color }}>סטטוס</div>
                                <div className="text-base font-bold">חבר/ת מועדון ⭐</div>
                            </div>
                        )}
                    </div>
                )}

                {/* Description */}
                {d.card_description && (
                    <div className="text-xs opacity-60">{d.card_description}</div>
                )}

                {/* QR placeholder */}
                {d.show_barcode && (
                    <div className="flex justify-center pt-2">
                        <div className="w-20 h-20 rounded-xl flex items-center justify-center"
                            style={{ background: d.text_color + "20" }}>
                            <svg viewBox="0 0 100 100" className="w-16 h-16" fill={d.text_color} opacity="0.7">
                                <rect x="10" y="10" width="30" height="30" rx="3" />
                                <rect x="60" y="10" width="30" height="30" rx="3" />
                                <rect x="10" y="60" width="30" height="30" rx="3" />
                                <rect x="60" y="60" width="8" height="8" />
                                <rect x="72" y="60" width="8" height="8" />
                                <rect x="60" y="72" width="8" height="8" />
                                <rect x="84" y="72" width="8" height="8" />
                                <rect x="72" y="84" width="8" height="8" />
                                <rect x="84" y="84" width="8" height="8" />
                            </svg>
                        </div>
                    </div>
                )}
            </div>

            {/* Bottom strip */}
            <div className="h-1.5 w-full" style={{ background: d.strip_color + "80" }} />
        </div>
    );
}

export default function WalletDesignerPage() {
    const [design, setDesign] = useState<Design>(DEFAULT_DESIGN);
    const [studioName, setStudioName] = useState("סטודיו שלי");
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        apiFetch<Design>("/api/wallet-design").then(d => {
            setDesign({ ...DEFAULT_DESIGN, ...d });
        }).catch(() => {});
        apiFetch<{ name: string }>("/api/studios/me").then(s => {
            setStudioName(s.name || "סטודיו שלי");
        }).catch(() => {});
    }, []);

    const update = (k: keyof Design, v: string | boolean | null) => {
        setDesign(prev => ({ ...prev, [k]: v }));
        setSaved(false);
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            await apiFetch("/api/wallet-design", {
                method: "PATCH",
                body: JSON.stringify(design),
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
        } catch {
            toast.error("שגיאה בשמירה");
        } finally {
            setSaving(false);
        }
    };

    return (
        <RequireAuth>
            <AppShell title="Wallet Card Designer 💳">
                <div className="grid lg:grid-cols-2 gap-10">

                    {/* Controls */}
                    <div className="space-y-8">

                        {/* Card texts */}
                        <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4 shadow-sm">
                            <h3 className="font-bold text-slate-800 text-base">טקסטים על הכרטיס</h3>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">שם על הכרטיס</label>
                                <input
                                    type="text"
                                    value={design.card_title || ""}
                                    onChange={e => update("card_title", e.target.value || null)}
                                    placeholder={studioName}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">תיאור קצר (אופציונלי)</label>
                                <input
                                    type="text"
                                    value={design.card_description || ""}
                                    onChange={e => update("card_description", e.target.value || null)}
                                    placeholder="הצטרף/י למועדון ותיהנה מהטבות"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
                                />
                            </div>
                        </div>

                        {/* Colors */}
                        <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
                            <h3 className="font-bold text-slate-800 text-base mb-4">צבעים</h3>
                            <div className="grid grid-cols-2 gap-4">
                                {([
                                    ["background_color", "רקע"],
                                    ["text_color", "טקסט"],
                                    ["strip_color", "פס עיצוב"],
                                    ["label_color", "תוויות"],
                                ] as [keyof Design, string][]).map(([key, label]) => (
                                    <label key={key} className="flex items-center gap-3 cursor-pointer group">
                                        <div className="relative">
                                            <div
                                                className="w-10 h-10 rounded-xl border-2 border-slate-200 group-hover:border-indigo-400 transition-colors"
                                                style={{ background: design[key] as string }}
                                            />
                                            <input
                                                type="color"
                                                value={design[key] as string}
                                                onChange={e => update(key, e.target.value)}
                                                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                            />
                                        </div>
                                        <span className="text-sm font-medium text-slate-700">{label}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Fields visibility */}
                        <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
                            <h3 className="font-bold text-slate-800 text-base mb-4">שדות להצגה</h3>
                            <div className="space-y-3">
                                {([
                                    ["show_points", "הצג נקודות"],
                                    ["show_tier", "הצג סטטוס מועדון"],
                                    ["show_barcode", "הצג QR Code"],
                                ] as [keyof Design, string][]).map(([key, label]) => (
                                    <div key={key} className="flex items-center justify-between">
                                        <span className="text-sm text-slate-700">{label}</span>
                                        <button
                                            type="button"
                                            onClick={() => update(key, !design[key])}
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${design[key] ? "bg-indigo-600" : "bg-slate-200"}`}
                                        >
                                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${design[key] ? "translate-x-6" : "translate-x-1"}`} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Apple / Google status */}
                        <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm space-y-3">
                            <h3 className="font-bold text-slate-800 text-base">סטטוס Wallet</h3>
                            <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                                <span className="text-2xl"> </span>
                                <div className="flex-1">
                                    <div className="text-sm font-semibold">Apple Wallet</div>
                                    <div className="text-xs text-slate-400">דורש Apple Developer Certificate</div>
                                </div>
                                <span className="text-xs font-bold px-2 py-1 rounded-lg bg-amber-100 text-amber-700">ממתין לקונפיגורציה</span>
                            </div>
                            <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                                <span className="text-2xl">G</span>
                                <div className="flex-1">
                                    <div className="text-sm font-semibold">Google Wallet</div>
                                    <div className="text-xs text-slate-400">דורש Google Cloud Service Account</div>
                                </div>
                                <span className="text-xs font-bold px-2 py-1 rounded-lg bg-amber-100 text-amber-700">ממתין לקונפיגורציה</span>
                            </div>
                            <p className="text-xs text-slate-400 mt-1">
                                כאשר מוגדרות הסביבות (env vars), הכפתורים יופיעו אוטומטית בפורטל הלקוח.
                            </p>
                        </div>

                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl shadow-lg transition-all disabled:opacity-50"
                        >
                            {saving ? "שומר..." : saved ? "✅ נשמר בהצלחה!" : "שמור עיצוב"}
                        </button>
                    </div>

                    {/* Preview */}
                    <div className="flex flex-col items-center gap-6">
                        <div className="text-sm text-slate-500 font-medium">תצוגה מקדימה חיה</div>
                        <CardPreview d={design} studioName={studioName} />
                        <div className="text-xs text-slate-400 text-center max-w-xs">
                            כרטיס זה יוצג ב-Apple Wallet ו-Google Wallet כאשר הקונפיגורציה תהיה מוכנה.
                            בינתיים הלקוחות יוכלו לראות את הכרטיס בפורטל האישי שלהם.
                        </div>
                    </div>
                </div>
            </AppShell>
        </RequireAuth>
    );
}
