"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Mail, MessageCircle, RefreshCw, Search, Send } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { whatsappNumber } from "@/lib/format";
import { ComposeMessage, CrmSentLog, CrmTemplates } from "@/components/admin/CrmMessages";
import { CrmBilling } from "@/components/admin/CrmBilling";

// The superadmin's CRM — every business using BizControl, with its plan, activity and a retention signal
// (GET /api/admin/crm/customers; the rules are app/services/platform_crm.py). A row opens the business's page.
// Messages from the company to the owners — the chosen businesses or everyone the filter shows — and the templates
// and the log of what was sent: components/admin/CrmMessages.tsx. Payments: components/admin/CrmBilling.tsx.

type Customer = {
    id: string; name: string; slug: string; business_type: string | null; joined: string | null;
    owner_name: string; owner_email: string | null; owner_phone: string | null;
    plan_id: string; plan_label: string; monthly_ils: number; status: string; ends_at: string | null;
    days_left: number | null; cancel_at_period_end: boolean; last_active: string | null;
    appointments_30d: number; clients: number; whatsapp_month: number;
    signal: "active" | "at_risk" | "inactive"; signal_reason: string;
};

const SIGNAL: Record<Customer["signal"], { label: string; cls: string }> = {
    active:   { label: "פעיל",    cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    at_risk:  { label: "בסיכון",  cls: "bg-amber-50 text-amber-800 border-amber-200" },
    inactive: { label: "לא פעיל", cls: "bg-rose-50 text-rose-700 border-rose-200" },
};
const STATUS: Record<string, string> = {
    trial: "חודש חינם", active: "פעיל", past_due: "באיחור תשלום", grace_period: "תקופת חסד",
    suspended: "מושהה", canceled: "בוטל", expired: "הסתיים",
};
type Filter = "all" | "at_risk" | "inactive" | "trial_week" | `plan:${string}`;
type Tab = "customers" | "billing" | "sent" | "templates";
const TABS: { key: Tab; label: string }[] = [
    { key: "customers", label: "עסקים" }, { key: "billing", label: "תשלומים" }, { key: "sent", label: "הודעות שנשלחו" }, { key: "templates", label: "תבניות הודעה" },
];

function ago(iso: string | null): string {
    if (!iso) return "—";
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    return days <= 0 ? "היום" : days === 1 ? "אתמול" : `לפני ${days} ימים`;
}

export default function AdminCrmPage() {
    const router = useRouter();
    const [rows, setRows] = useState<Customer[] | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [filter, setFilter] = useState<Filter>("all");
    const [q, setQ] = useState("");
    const [tab, setTab] = useState<Tab>("customers");
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [composing, setComposing] = useState(false);

    const load = useCallback(() => {
        apiFetch<Customer[]>("/api/admin/crm/customers")
            .then(r => { setRows(r); setErr(null); })
            .catch(e => { setRows([]); setErr(e instanceof Error ? e.message : "הטעינה נכשלה"); });
    }, []);
    useEffect(() => { load(); }, [load]);

    const all = useMemo(() => rows ?? [], [rows]);
    const plans = useMemo(() => Array.from(new Map(all.map(c => [c.plan_id, c.plan_label])).entries()), [all]);
    const shown = useMemo(() => all.filter(c => {
        if (filter === "at_risk" && c.signal !== "at_risk") return false;
        if (filter === "inactive" && c.signal !== "inactive") return false;
        if (filter === "trial_week" && !(c.status === "trial" && c.days_left !== null && c.days_left <= 7)) return false;
        if (filter.startsWith("plan:") && c.plan_id !== filter.slice(5)) return false;
        const term = q.trim();
        return !term || [c.name, c.owner_name, c.owner_email, c.owner_phone, c.slug].some(v => v && v.includes(term));
    }), [all, filter, q]);

    // the message goes to the ticked businesses, or — with none ticked — to everyone the filter shows
    const recipients = picked.size ? all.filter(c => picked.has(c.id)) : shown;
    const allShownPicked = shown.length > 0 && shown.every(c => picked.has(c.id));
    const toggle = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const toggleShown = () => setPicked(p => {
        const n = new Set(p);
        shown.forEach(c => { if (allShownPicked) n.delete(c.id); else n.add(c.id); });
        return n;
    });

    const count = (s: Customer["signal"]) => all.filter(c => c.signal === s).length;
    const trialWeek = all.filter(c => c.status === "trial" && c.days_left !== null && c.days_left <= 7).length;
    const monthly = all.reduce((sum, c) => sum + c.monthly_ils, 0);
    const chip = (key: Filter, label: string, n?: number) => (
        <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key}
            className={`px-3 py-1.5 rounded-full text-sm font-semibold border transition-colors ${filter === key ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"}`}>
            {label}{n !== undefined && <span className="mr-1 opacity-70 tabular-nums">{n}</span>}
        </button>
    );

    return (
        <div className="max-w-7xl mx-auto py-8 px-4 space-y-6" dir="rtl">
            <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
                <ArrowRight className="h-4 w-4" /> חזרה לאדמין
            </Link>

            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-black text-slate-900">הלקוחות שלי</h1>
                    <p className="text-slate-500 text-sm mt-1">כל העסקים שמשתמשים ב-BizControl — מסלול, פעילות וסימן שימור. לחיצה על עסק פותחת את הכרטיס שלו.</p>
                </div>
                <button onClick={load} className="px-4 py-2 text-sm font-bold bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center gap-2 text-slate-700">
                    <RefreshCw className="h-4 w-4" /> רענון
                </button>
            </div>

            <div className="flex gap-1 border-b border-slate-200" role="tablist">
                {TABS.map(t => (
                    <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                        className={`px-4 py-2.5 text-sm font-bold -mb-px border-b-2 ${tab === t.key ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === "billing" && <CrmBilling />}
            {tab === "sent" && <CrmSentLog />}
            {tab === "templates" && <CrmTemplates />}

            {tab === "customers" && <>
            {/* the picture at a glance */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                    { label: "עסקים", value: all.length },
                    { label: "פעילים", value: count("active"), tone: "text-emerald-700" },
                    { label: "בסיכון", value: count("at_risk"), tone: "text-amber-700" },
                    { label: "לא פעילים", value: count("inactive"), tone: "text-rose-700" },
                    { label: "חודש חינם נגמר השבוע", value: trialWeek, tone: trialWeek ? "text-amber-700" : undefined },
                    { label: "צפי הכנסה חודשי", value: `₪${monthly.toLocaleString("he-IL")}` },
                ].map(t => (
                    <div key={t.label} className="bg-white border border-slate-200 rounded-2xl px-4 py-3">
                        <div className={`text-2xl font-black tabular-nums ${t.tone ?? "text-slate-900"}`}>{t.value}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{t.label}</div>
                    </div>
                ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
                {chip("all", "הכול", all.length)}
                {chip("at_risk", "בסיכון", count("at_risk"))}
                {chip("inactive", "לא פעילים", count("inactive"))}
                {chip("trial_week", "חודש חינם נגמר השבוע", trialWeek)}
                {plans.map(([id, label]) => chip(`plan:${id}`, label))}
                <label className="relative mr-auto">
                    <Search className="h-4 w-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" aria-hidden />
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש: עסק, בעלים, טלפון, מייל"
                        className="border border-slate-200 rounded-xl pr-9 pl-3 py-2 text-sm w-64 max-w-full bg-white" />
                </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <button onClick={() => setComposing(true)} disabled={recipients.length === 0}
                    className="px-4 py-2 text-sm font-bold bg-slate-900 text-white rounded-xl hover:bg-slate-800 disabled:opacity-40 flex items-center gap-2">
                    <Send className="h-4 w-4" />
                    {picked.size ? `הודעה ל-${picked.size} שנבחרו` : `הודעה לכל ${shown.length} שבסינון`}
                </button>
                {picked.size > 0 && (
                    <button onClick={() => setPicked(new Set())} className="text-sm text-slate-500 hover:text-slate-900">ניקוי הבחירה</button>
                )}
            </div>

            {err && <p className="text-sm text-rose-600">{err}</p>}

            {rows === null ? (
                <p className="text-center text-slate-400 py-12">טוען...</p>
            ) : (
                <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-slate-500 border-b border-slate-100">
                                <th className="px-4 py-3 w-10">
                                    <input type="checkbox" checked={allShownPicked} onChange={toggleShown} aria-label="לבחור את כל העסקים שבסינון" className="h-4 w-4 accent-slate-900" />
                                </th>
                                {["עסק", "בעל העסק", "מסלול", "מצב", "נכנס לאחרונה", "תורים 30 יום", "WhatsApp החודש", "שימור"].map(h => (
                                    <th key={h} className="text-right font-semibold px-4 py-3 whitespace-nowrap">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {shown.map(c => (
                                <tr key={c.id} onClick={() => router.push(`/admin/studios/${c.id}`)}
                                    className={`border-b border-slate-50 last:border-0 hover:bg-slate-50 cursor-pointer align-top ${picked.has(c.id) ? "bg-slate-50" : ""}`}>
                                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                                        <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} aria-label={`לבחור את ${c.name}`} className="h-4 w-4 accent-slate-900" />
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="font-bold text-slate-900">{c.name}</div>
                                        <div className="text-xs text-slate-400">הצטרף {c.joined ? new Date(c.joined).toLocaleDateString("he-IL") : "—"} · {c.clients} לקוחות</div>
                                    </td>
                                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                                        <div className="text-slate-800">{c.owner_name || "—"}</div>
                                        <div className="flex items-center gap-3 mt-1 text-xs">
                                            {c.owner_phone && (
                                                <a href={`https://wa.me/${whatsappNumber(c.owner_phone)}`} target="_blank" rel="noopener"
                                                    className="inline-flex items-center gap-1 text-emerald-700 hover:underline" dir="ltr">
                                                    <MessageCircle className="h-3.5 w-3.5" aria-hidden /> {c.owner_phone}
                                                </a>
                                            )}
                                            {c.owner_email && (
                                                <a href={`mailto:${c.owner_email}`} className="inline-flex items-center gap-1 text-slate-500 hover:underline" dir="ltr">
                                                    <Mail className="h-3.5 w-3.5" aria-hidden /> {c.owner_email}
                                                </a>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap">
                                        <div className="text-slate-800 font-semibold">{c.plan_label}</div>
                                        <div className="text-xs text-slate-400 tabular-nums">{c.monthly_ils ? `₪${c.monthly_ils} לחודש` : "ללא תשלום"}</div>
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap">
                                        <div className="text-slate-800">{STATUS[c.status] ?? c.status}{c.cancel_at_period_end ? " · מבוטל בסוף התקופה" : ""}</div>
                                        {c.days_left !== null && c.status !== "expired" && (
                                            <div className={`text-xs tabular-nums ${c.days_left <= 7 ? "text-amber-700 font-semibold" : "text-slate-400"}`}>
                                                {c.days_left < 0 ? "הסתיים" : c.days_left === 0 ? "נגמר היום" : `נשארו ${c.days_left} ימים`}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{ago(c.last_active)}</td>
                                    <td className="px-4 py-3 tabular-nums text-slate-600">{c.appointments_30d}</td>
                                    <td className="px-4 py-3 tabular-nums text-slate-600">{c.whatsapp_month}</td>
                                    <td className="px-4 py-3">
                                        <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full border ${SIGNAL[c.signal].cls}`}>{SIGNAL[c.signal].label}</span>
                                        <div className="text-xs text-slate-500 mt-1">{c.signal_reason}</div>
                                    </td>
                                </tr>
                            ))}
                            {shown.length === 0 && (
                                <tr><td colSpan={9} className="text-center text-slate-400 py-10">אין עסקים שמתאימים לסינון</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
            </>}

            {composing && <ComposeMessage recipients={recipients} onClose={() => setComposing(false)} />}
        </div>
    );
}
