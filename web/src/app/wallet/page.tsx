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

type WalletStatus = {
    apple_configured: boolean;
    google_configured: boolean;
};

const DEFAULT_DESIGN: Design = {
    background_color: "#0f172a",
    text_color: "#f8fafc",
    strip_color: "#6366f1",
    label_color: "#94a3b8",
    logo_url: null,
    show_points: true,
    show_tier: true,
    show_barcode: true,
    card_title: null,
    card_description: null,
};

function PremiumCardPreview({ d, studioName }: { d: Design; studioName: string }) {
    const bg = d.background_color;
    const accent = d.strip_color;

    return (
        <div className="w-full max-w-85 mx-auto" style={{ perspective: "1000px" }}>
            <div
                className="relative w-full rounded-3xl overflow-hidden select-none"
                style={{
                    aspectRatio: "1.586 / 1",
                    background: `linear-gradient(135deg, ${bg} 0%, ${bg}ee 60%, ${accent}22 100%)`,
                    color: d.text_color,
                    boxShadow: `0 32px 64px -16px ${bg}99, 0 8px 32px -8px ${accent}44, inset 0 1px 0 rgba(255,255,255,0.08)`,
                }}
            >
                {/* Holographic sheen overlay */}
                <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                        background: "linear-gradient(105deg, transparent 20%, rgba(255,255,255,0.06) 50%, transparent 80%)",
                    }}
                />

                {/* Top gradient strip */}
                <div className="absolute top-0 left-0 right-0 h-1"
                    style={{ background: `linear-gradient(90deg, ${accent}00, ${accent}, ${accent}00)` }} />

                {/* Radial glow in corner */}
                <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full pointer-events-none"
                    style={{ background: `radial-gradient(circle, ${accent}30, transparent 70%)` }} />

                <div className="relative h-full flex flex-col justify-between p-5">
                    {/* Top row: chip + logo */}
                    <div className="flex items-start justify-between">
                        {/* EMV Chip */}
                        <div
                            className="w-9 h-6 rounded-md relative overflow-hidden"
                            style={{
                                background: `linear-gradient(135deg, ${accent}bb, ${d.label_color}88)`,
                                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25), 0 2px 4px rgba(0,0,0,0.3)",
                            }}
                        >
                            <div className="absolute inset-0 grid grid-cols-2 gap-px p-1 opacity-50">
                                {[0,1,2,3].map(i => (
                                    <div key={i} className="rounded-sm" style={{ background: "rgba(255,255,255,0.35)" }} />
                                ))}
                            </div>
                            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px" style={{ background: "rgba(255,255,255,0.2)" }} />
                        </div>

                        {/* Logo / Studio initial */}
                        {d.logo_url ? (
                            <img src={d.logo_url} alt="logo"
                                className="h-9 w-9 rounded-xl object-cover"
                                style={{ boxShadow: `0 4px 12px ${accent}44` }} />
                        ) : (
                            <div
                                className="h-9 w-9 rounded-xl flex items-center justify-center font-black text-base"
                                style={{
                                    background: `linear-gradient(135deg, ${accent}55, ${accent}22)`,
                                    border: `1px solid ${accent}55`,
                                    color: d.text_color,
                                }}
                            >
                                {(d.card_title || studioName)?.[0]?.toUpperCase() ?? "●"}
                            </div>
                        )}
                    </div>

                    {/* Studio name */}
                    <div className="mt-2">
                        <div
                            className="text-[9px] font-bold uppercase tracking-[0.25em] mb-0.5"
                            style={{ color: d.label_color, opacity: 0.7 }}
                        >
                            מועדון לקוחות
                        </div>
                        <div className="text-[15px] font-black tracking-wide leading-tight" style={{ letterSpacing: "0.04em" }}>
                            {d.card_title || studioName}
                        </div>
                    </div>

                    {/* Bottom row */}
                    <div className="flex items-end justify-between gap-3">
                        <div className="space-y-2 flex-1 min-w-0">
                            <div>
                                <div className="text-[8px] font-bold uppercase tracking-widest opacity-40" style={{ color: d.label_color }}>שם חבר/ה</div>
                                <div className="text-[11px] font-bold truncate mt-0.5">שם הלקוח</div>
                            </div>

                            {(d.show_points || d.show_tier) && (
                                <div className="flex items-center gap-3">
                                    {d.show_points && (
                                        <div>
                                            <div className="text-[8px] font-bold uppercase tracking-widest opacity-40" style={{ color: d.label_color }}>נקודות</div>
                                            <div className="text-lg font-black leading-none mt-0.5">1,250</div>
                                        </div>
                                    )}
                                    {d.show_tier && (
                                        <div className="text-[10px] font-black px-2 py-0.5 rounded-full"
                                            style={{
                                                background: `${accent}33`,
                                                border: `1px solid ${accent}55`,
                                                color: d.text_color,
                                            }}>
                                            ⭐ Gold
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* QR placeholder */}
                        {d.show_barcode && (
                            <div className="shrink-0 rounded-xl overflow-hidden p-1.5 bg-white/10 backdrop-blur-sm border border-white/10">
                                <svg viewBox="0 0 100 100" className="w-12 h-12" fill={d.text_color} opacity="0.75">
                                    <rect x="8" y="8" width="28" height="28" rx="4" />
                                    <rect x="64" y="8" width="28" height="28" rx="4" />
                                    <rect x="8" y="64" width="28" height="28" rx="4" />
                                    <rect x="64" y="64" width="8" height="8" rx="1" />
                                    <rect x="76" y="64" width="8" height="8" rx="1" />
                                    <rect x="64" y="76" width="8" height="8" rx="1" />
                                    <rect x="84" y="76" width="8" height="8" rx="1" />
                                    <rect x="76" y="84" width="16" height="8" rx="1" />
                                    <rect x="14" y="14" width="16" height="16" rx="2" fill={d.background_color} />
                                    <rect x="70" y="14" width="16" height="16" rx="2" fill={d.background_color} />
                                    <rect x="14" y="70" width="16" height="16" rx="2" fill={d.background_color} />
                                </svg>
                            </div>
                        )}
                    </div>
                </div>

                {/* Bottom glow line */}
                <div className="absolute bottom-0 left-0 right-0 h-px"
                    style={{ background: `linear-gradient(90deg, transparent, ${accent}88, transparent)` }} />
            </div>
        </div>
    );
}

function StatusPill({ configured, label }: { configured: boolean; label: string }) {
    return (
        <div className="flex items-center gap-3 p-4 rounded-2xl border"
            style={{
                background: configured ? "rgba(16,185,129,0.06)" : "rgba(248,250,252,0.5)",
                borderColor: configured ? "rgba(16,185,129,0.2)" : "rgba(226,232,240,1)",
            }}>
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-lg font-black ${configured ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
                {configured ? "✓" : "○"}
            </div>
            <div className="flex-1">
                <div className="text-sm font-bold text-slate-800">{label}</div>
                <div className={`text-xs font-semibold mt-0.5 ${configured ? "text-emerald-600" : "text-amber-600"}`}>
                    {configured ? "מחובר ומוכן" : "ממתין להגדרת מערכת"}
                </div>
            </div>
            <span className={`text-[11px] font-black px-2.5 py-1 rounded-full ${configured ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                {configured ? "פעיל" : "לא פעיל"}
            </span>
        </div>
    );
}

export default function WalletDesignerPage() {
    const [design, setDesign] = useState<Design>(DEFAULT_DESIGN);
    const [studioName, setStudioName] = useState("הסטודיו שלי");
    const [walletStatus, setWalletStatus] = useState<WalletStatus>({ apple_configured: false, google_configured: false });
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        apiFetch<Design>("/api/wallet-design").then(d => {
            setDesign({ ...DEFAULT_DESIGN, ...d });
        }).catch(() => {});
        apiFetch<{ name: string }>("/api/studios/me").then(s => {
            setStudioName(s.name || "הסטודיו שלי");
        }).catch(() => {});
        apiFetch<WalletStatus>("/api/wallet-design/status").then(s => {
            setWalletStatus(s);
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
            <AppShell title="עיצוב כרטיס מועדון 💳">
                <div className="grid lg:grid-cols-[1fr_380px] gap-10 items-start">

                    {/* ── Controls ── */}
                    <div className="space-y-6">

                        {/* Wallet Status */}
                        <div className="bg-white rounded-3xl border border-slate-100 p-6 shadow-sm space-y-3">
                            <h3 className="font-bold text-slate-800 text-base">סטטוס Wallet</h3>
                            <StatusPill configured={walletStatus.apple_configured} label="Apple Wallet" />
                            <StatusPill configured={walletStatus.google_configured} label="Google Wallet" />
                            {(!walletStatus.apple_configured || !walletStatus.google_configured) && (
                                <p className="text-xs text-slate-400 pt-1 leading-relaxed">
                                    כפתורי Wallet יופיעו אוטומטית בפורטל הלקוח כאשר מנהל המערכת יסיים את ההגדרה הטכנית.
                                </p>
                            )}
                        </div>

                        {/* Card texts */}
                        <div className="bg-white rounded-3xl border border-slate-100 p-6 space-y-4 shadow-sm">
                            <h3 className="font-bold text-slate-800 text-base">טקסטים על הכרטיס</h3>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">שם על הכרטיס</label>
                                <input
                                    type="text"
                                    value={design.card_title || ""}
                                    onChange={e => update("card_title", e.target.value || null)}
                                    placeholder={studioName}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400 transition"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">תיאור קצר (אופציונלי)</label>
                                <input
                                    type="text"
                                    value={design.card_description || ""}
                                    onChange={e => update("card_description", e.target.value || null)}
                                    placeholder="הצטרף/י למועדון ותיהנה מהטבות"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400 transition"
                                />
                            </div>
                        </div>

                        {/* Colors */}
                        <div className="bg-white rounded-3xl border border-slate-100 p-6 shadow-sm">
                            <h3 className="font-bold text-slate-800 text-base mb-4">צבעים</h3>
                            <div className="grid grid-cols-2 gap-4">
                                {([
                                    ["background_color", "רקע"],
                                    ["text_color", "טקסט"],
                                    ["strip_color", "צבע מבטא"],
                                    ["label_color", "תוויות"],
                                ] as [keyof Design, string][]).map(([key, label]) => (
                                    <label key={key} className="flex items-center gap-3 cursor-pointer group">
                                        <div className="relative">
                                            <div
                                                className="w-10 h-10 rounded-xl border-2 border-slate-200 group-hover:border-indigo-400 transition-colors shadow-sm"
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
                        <div className="bg-white rounded-3xl border border-slate-100 p-6 shadow-sm">
                            <h3 className="font-bold text-slate-800 text-base mb-4">שדות להצגה בכרטיס</h3>
                            <div className="space-y-3">
                                {([
                                    ["show_points", "הצג נקודות"],
                                    ["show_tier", "הצג דרגת מועדון"],
                                    ["show_barcode", "הצג QR Code"],
                                ] as [keyof Design, string][]).map(([key, label]) => (
                                    <div key={key} className="flex items-center justify-between py-1">
                                        <span className="text-sm font-medium text-slate-700">{label}</span>
                                        <button
                                            type="button"
                                            onClick={() => update(key, !design[key])}
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${design[key] ? "bg-indigo-600" : "bg-slate-200"}`}
                                        >
                                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${design[key] ? "translate-x-6" : "translate-x-1"}`} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl shadow-lg transition-all disabled:opacity-50 text-base"
                        >
                            {saving ? "שומר..." : saved ? "✅ נשמר בהצלחה!" : "שמור עיצוב"}
                        </button>
                    </div>

                    {/* ── Live Preview ── */}
                    <div className="lg:sticky lg:top-6 flex flex-col items-center gap-5">
                        <div className="text-xs text-slate-500 font-bold uppercase tracking-widest">תצוגה מקדימה חיה</div>
                        <PremiumCardPreview d={design} studioName={studioName} />
                        <p className="text-[11px] text-slate-400 text-center max-w-70 leading-relaxed">
                            כרטיס זה יוצג ללקוחות בפורטל האישי.
                            כפתורי Apple Wallet ו-Google Wallet יופיעו אוטומטית כשהשירות יהיה פעיל.
                        </p>
                    </div>
                </div>
            </AppShell>
        </RequireAuth>
    );
}
