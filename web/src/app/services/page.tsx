"use client";
import { useState, useEffect, useCallback } from "react";
import { ClipboardList, Clock, ConciergeBell, CreditCard, Globe, HeartPulse, Pencil, Plus, Save, Trash2, X, Zap } from "lucide-react";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import { apiFetch } from "@/lib/api";
import { useTerms } from "@/lib/useTerms";
import { toast } from "@/lib/toast";

import { intl, tx } from "@/lib/i18n";
// The business's services — name, length, price (optional), color in the calendar, deposit, who gives it. In the
// look of the rest of the system: white cards on the background the superadmin chose (the owner, 2026-10-19 — it had
// its own fixed dark purple look). data-tour="service-new" / "service-form": ויקי's guide (lib/tours) and its video.

interface Service {
    id: string;
    name: string;
    description?: string;
    duration_minutes: number;
    price_cents: number;
    price_ils: number;
    color: string;
    category?: string;
    is_active: boolean;
    requires_consultation: boolean;
    is_bookable_online: boolean;
    sort_order: number;
    requires_deposit: boolean;
    deposit_amount_cents: number;
    deposit_amount_ils: number;
    send_aftercare: boolean;
    aftercare_message?: string | null;   // this service's own care instructions; empty = the business's
    staff_ids: string[];
}

interface CareTemplate { key: string; label: string; text: string; }

interface StaffMember { id: string; display_name: string; role: string; }

const COLORS = ["#7c3aed","#4f46e5","#0ea5e9","#10b981","#f59e0b","#ef4444","#ec4899","#8b5cf6","#14b8a6","#f97316"];

const DURATION_OPTIONS = [15,20,30,45,60,75,90,120,150,180,240,300,360];

function fmt(n: number) { return n.toLocaleString(intl(), { minimumFractionDigits: 0 }); }
function durLabel(m: number) { return m < 60 ? tx("{0} דק'", { 0: m }) : m % 60 === 0 ? tx("{0} שע'", { 0: m/60 }) : tx("{0}:{1} שע'", { 0: Math.floor(m/60), 1: String(m%60).padStart(2,"0") }); }

const LABEL = "block text-xs font-semibold text-slate-600 mb-1.5";
const INPUT = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100";

type Flag = "is_active" | "is_bookable_online" | "requires_consultation" | "send_aftercare";

function ServiceModal({
    service, staff, onClose, onSaved,
}: { service?: Service; staff: StaffMember[]; onClose: () => void; onSaved: () => void }) {
    const terms = useTerms();   // the example comes from the business's field, not "קעקוע קטן"
    const isEdit = !!service;
    const [form, setForm] = useState({
        name: service?.name || "",
        description: service?.description || "",
        duration_minutes: service?.duration_minutes || 60,
        price_cents: service?.price_cents || 0,
        color: service?.color || "#7c3aed",
        category: service?.category || "",
        is_active: service?.is_active ?? true,
        requires_consultation: service?.requires_consultation ?? false,
        is_bookable_online: service?.is_bookable_online ?? false,
        requires_deposit: service?.requires_deposit ?? false,
        deposit_amount_cents: service?.deposit_amount_cents ?? 0,
        send_aftercare: service?.send_aftercare ?? false,
        aftercare_message: service?.aftercare_message || "",
        staff_ids: service?.staff_ids || [],
    });
    const [saving, setSaving] = useState(false);
    // ready care instructions (piercing, tattoo) for this service's own text — the owner, 2026-10-27
    const [templates, setTemplates] = useState<CareTemplate[]>([]);
    useEffect(() => {
        apiFetch<CareTemplate[]>("/api/services/aftercare-templates").then(setTemplates).catch(() => { /* no buttons */ });
    }, []);

    const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

    const loadTemplate = (t: CareTemplate) => {
        const now = form.aftercare_message.trim();
        if (now && now !== t.text.trim() && !confirm(tx("להחליף את הטקסט שכתוב בתבנית?"))) return;
        set("aftercare_message", t.text);
    };

    const save = async () => {
        if (!form.name.trim()) { toast.error(tx("שם שירות חובה")); return; }
        setSaving(true);
        try {
            const body = { ...form };
            if (isEdit) {
                await apiFetch(`/api/services/${service!.id}`, { method: "PUT", body: JSON.stringify(body) });
            } else {
                await apiFetch("/api/services", { method: "POST", body: JSON.stringify(body) });
            }
            onSaved();
            onClose();
        } catch (e) { toast.error(e instanceof Error ? e.message : tx("השמירה נכשלה")); }
        finally { setSaving(false); }
    };

    const toggleStaff = (id: string) =>
        set("staff_ids", form.staff_ids.includes(id)
            ? form.staff_ids.filter(x => x !== id)
            : [...form.staff_ids, id]);

    const flags: { key: Flag; label: string }[] = [
        { key: "is_active", label: tx("פעיל") },
        { key: "is_bookable_online", label: tx("ניתן לקביעה אונליין") },
        { key: "requires_consultation", label: tx("דורש ייעוץ קודם") },
        { key: "send_aftercare", label: tx("שלח הוראות טיפול אחרי סיום") },
    ];

    return (
        // z 1000: the guide (ויקי) stays above it
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
            <div data-tour="service-form" role="dialog" aria-labelledby="service-form-title"
                className="w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-3xl bg-white shadow-2xl border border-slate-100 p-6">
                <div className="flex items-center justify-between mb-5">
                    <h2 id="service-form-title" className="text-lg font-bold text-slate-900">{isEdit ? tx("עריכת שירות") : tx("שירות חדש")}</h2>
                    <button type="button" onClick={onClose} aria-label={tx("סגירה")}
                        className="w-9 h-9 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100">
                        <X className="w-5 h-5" aria-hidden />
                    </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                        <label className={LABEL}>{tx("שם השירות *")}</label>
                        <input value={form.name} onChange={e => set("name", e.target.value)} className={INPUT}
                            placeholder={terms.example_service ? tx("לדוגמה: {0}", { 0: terms.example_service }) : tx("שם השירות")} />
                    </div>

                    <div>
                        <label className={LABEL}>{tx("משך זמן")}</label>
                        <select value={form.duration_minutes} onChange={e => set("duration_minutes", Number(e.target.value))} className={INPUT}>
                            {DURATION_OPTIONS.map(d => <option key={d} value={d}>{durLabel(d)}</option>)}
                        </select>
                    </div>

                    <div>
                        <label className={LABEL}>{tx("מחיר (₪) ")}<span className="font-normal text-slate-400">{tx("— לא חובה")}</span></label>
                        {/* not required (owner, 2026-10-16: "the price changes from service to service — not locked"): empty
                            means "משתנה" — clients see no price, and the amount is written in the payment */}
                        <input type="number" inputMode="decimal" min={0} step={10} placeholder={tx("משתנה")}
                            value={form.price_cents ? form.price_cents / 100 : ""}
                            onChange={e => set("price_cents", Math.round(parseFloat(e.target.value || "0") * 100))}
                            className={INPUT} />
                    </div>
                    <p className="col-span-2 -mt-2 text-xs text-slate-500">
                        {tx("המחיר משתנה מלקוח ללקוח? השאירו ריק — הלקוחות לא יראו מחיר, ואת הסכום רושמים בתשלום.")}
                    </p>

                    <div>
                        <label className={LABEL}>{tx("קטגוריה")}</label>
                        <input value={form.category} onChange={e => set("category", e.target.value)} className={INPUT} placeholder={tx("לדוגמה: צבע")} />
                    </div>

                    <div>
                        <span className={LABEL}>{tx("צבע ביומן")}</span>
                        <div className="flex flex-wrap gap-2 pt-1">
                            {COLORS.map(c => (
                                <button key={c} type="button" onClick={() => set("color", c)} aria-label={tx("צבע {0}", { 0: c })} aria-pressed={form.color === c}
                                    className={`w-7 h-7 rounded-full transition ${form.color === c ? "ring-2 ring-offset-2 ring-slate-800" : ""}`}
                                    style={{ background: c }} />
                            ))}
                        </div>
                    </div>

                    <div className="col-span-2">
                        <label className={LABEL}>{tx("תיאור (אופציונלי)")}</label>
                        <textarea value={form.description} onChange={e => set("description", e.target.value)}
                            className={`${INPUT} min-h-[70px] resize-y`} placeholder={tx("תיאור קצר של השירות...")} />
                    </div>

                    <div className="col-span-2 flex flex-wrap gap-x-5 gap-y-2">
                        {flags.map(({ key, label }) => (
                            <label key={key} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                                <input type="checkbox" checked={form[key]} onChange={e => set(key, e.target.checked)} className="w-4 h-4 accent-sky-600" />
                                {label}
                            </label>
                        ))}
                    </div>

                    {form.send_aftercare && (
                        <div className="col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                <label htmlFor="service-aftercare" className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                                    <HeartPulse className="w-4 h-4 text-slate-500" aria-hidden /> {tx("הוראות טיפול לשירות הזה")}
                                </label>
                                {templates.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="text-xs text-slate-500">{tx("תבנית מוכנה:")}</span>
                                        {templates.map(t => (
                                            <button key={t.key} type="button" onClick={() => loadTemplate(t)}
                                                className="min-h-8 px-3 rounded-full border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:border-sky-300 hover:text-sky-800">
                                                {tx(t.label)}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <textarea id="service-aftercare" value={form.aftercare_message} onChange={e => set("aftercare_message", e.target.value)}
                                className={`${INPUT} min-h-[160px] resize-y`} dir="auto"
                                placeholder={tx("ריק — נשלחות ההוראות הכלליות של העסק (תבניות הודעות ← הוראות אחרי הטיפול)")} />
                            <p className="mt-1.5 text-xs text-slate-500">{tx("נשלח ללקוח אחרי שהתור הסתיים, במקום ההוראות הכלליות. {client_name} — שם הלקוח.")}</p>
                        </div>
                    )}

                    {/* Deposit — was previously only configurable in a separate,
                        disconnected "treatment types" settings section that had
                        no relation to the actual service being booked. */}
                    <div className="col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <label className="flex items-center gap-2 text-sm font-semibold text-slate-800 cursor-pointer">
                            <input type="checkbox" checked={form.requires_deposit} onChange={e => set("requires_deposit", e.target.checked)} className="w-4 h-4 accent-sky-600" />
                            <CreditCard className="w-4 h-4 text-slate-500" aria-hidden /> {tx("דורש מקדמה לקביעת תור")}
                        </label>
                        {form.requires_deposit && (
                            <div className="mt-3 max-w-[200px]">
                                <label className={LABEL}>{tx("סכום המקדמה (₪)")}</label>
                                <input type="number" inputMode="decimal" min={0} step={10} placeholder="0"
                                    value={form.deposit_amount_cents ? form.deposit_amount_cents / 100 : ""}
                                    onChange={e => set("deposit_amount_cents", Math.round(parseFloat(e.target.value || "0") * 100))}
                                    className={INPUT} />
                            </div>
                        )}
                    </div>

                    {staff.length > 0 && (
                        <div className="col-span-2">
                            <span className={LABEL}>{tx("עובדים שמבצעים שירות זה")}</span>
                            <div className="flex flex-wrap gap-2">
                                {staff.map(m => {
                                    const on = form.staff_ids.includes(m.id);
                                    return (
                                        <button key={m.id} type="button" onClick={() => toggleStaff(m.id)} aria-pressed={on}
                                            className={`min-h-9 px-3 rounded-full border text-sm transition ${on ? "border-sky-300 bg-sky-50 text-sky-800 font-semibold" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                                            {m.display_name || tx("ללא שם")}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-3 mt-6">
                    <button type="button" onClick={onClose} className="min-h-11 px-4 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">{tx("ביטול")}</button>
                    <button type="button" onClick={save} disabled={saving}
                        className="inline-flex items-center gap-1.5 min-h-11 px-5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold disabled:opacity-60">
                        {isEdit ? <Save className="w-4 h-4" aria-hidden /> : <Plus className="w-4 h-4" aria-hidden />}
                        {saving ? tx("שומר...") : isEdit ? tx("שמור שינויים") : tx("צור שירות")}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function ServicesPage() {
    const [services, setServices] = useState<Service[]>([]);
    const [staff, setStaff] = useState<StaffMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [modal, setModal] = useState<"new" | Service | null>(null);
    const [seeding, setSeeding] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const svcs = await apiFetch<Service[]>("/api/services?active_only=false");
            setServices(svcs);
        } catch (e) { toast.error(e instanceof Error ? e.message : tx("שגיאה בטעינת השירותים")); }
        try {
            const staffData = await apiFetch<StaffMember[]>("/api/users/artists");
            setStaff(staffData);
        } catch { /* no team list — the form just doesn't offer it */ }
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const deleteService = async (id: string) => {
        if (!confirm(tx("למחוק שירות זה?"))) return;
        await apiFetch(`/api/services/${id}`, { method: "DELETE" });
        load();
    };

    const seedFromTemplate = async () => {
        if (!confirm(tx("לטעון שירותי ברירת מחדל לפי סוג העסק?"))) return;
        setSeeding(true);
        try {
            const res = await apiFetch<{ created: string[] }>("/api/services/seed-from-template", { method: "POST" });
            toast.success(tx("נוצרו {0} שירותים", { 0: res.created.length }));
            load();
        } catch (e) { toast.error(e instanceof Error ? e.message : tx("הטעינה נכשלה")); }
        finally { setSeeding(false); }
    };

    const grouped = services.reduce((acc, s) => {
        const cat = s.category || tx("כללי");
        (acc[cat] = acc[cat] || []).push(s);
        return acc;
    }, {} as Record<string, Service[]>);

    return (
        <RequireAuth>
            <AppShell title={tx("שירותים")}>
                <div className="p-4 md:p-8 space-y-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900">
                                <ConciergeBell className="w-6 h-6 text-sky-600" aria-hidden /> {tx("קטלוג שירותים")}
                            </h1>
                            <p className="text-sm text-slate-600 mt-1">{tx("הגדר שירותים, משכי זמן ומחירים לעסק שלך")}</p>
                        </div>
                        <div className="flex gap-2">
                            {services.length === 0 && (
                                <button type="button" onClick={seedFromTemplate} disabled={seeding}
                                    className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-xl border border-emerald-200 bg-white text-emerald-700 text-sm font-semibold hover:bg-emerald-50 disabled:opacity-60">
                                    <Zap className="w-4 h-4" aria-hidden /> {seeding ? tx("טוען...") : tx("טען ברירות מחדל")}
                                </button>
                            )}
                            <button type="button" data-tour="service-new" onClick={() => setModal("new")}
                                className="inline-flex items-center gap-1.5 min-h-11 px-5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold shadow-sm">
                                <Plus className="w-4 h-4" aria-hidden /> {tx("שירות חדש")}
                            </button>
                        </div>
                    </div>

                    {loading ? (
                        <p className="py-16 text-center text-slate-500">{tx("טוען...")}</p>
                    ) : services.length === 0 ? (
                        <div className="rounded-3xl border border-slate-200/70 bg-white p-10 text-center shadow-sm">
                            <ConciergeBell className="w-12 h-12 mx-auto text-slate-300" aria-hidden />
                            <p className="mt-3 font-semibold text-slate-700">{tx("אין שירותים עדיין")}</p>
                            <p className="mt-1 text-sm text-slate-500">{tx("לחץ \"טען ברירות מחדל\" לטעינה מהירה לפי סוג העסק, או צור שירות ידנית")}</p>
                        </div>
                    ) : (
                        Object.entries(grouped).map(([cat, svcs]) => (
                            <section key={cat}>
                                <h2 className="mb-3 text-sm font-bold text-slate-700">{cat}</h2>
                                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                    {svcs.sort((a, b) => a.sort_order - b.sort_order).map(svc => (
                                        <div key={svc.id} className={`rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm ${svc.is_active ? "" : "opacity-60"}`}
                                            style={{ borderInlineStartWidth: 4, borderInlineStartColor: svc.color }}>
                                            <div className="flex items-center gap-2">
                                                <span className="flex-1 min-w-0 truncate font-bold text-slate-900">{svc.name}</span>
                                                {!svc.is_active && <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{tx("כבוי")}</span>}
                                            </div>
                                            <div className="mt-2 flex items-center gap-4 text-sm text-slate-600">
                                                <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" aria-hidden /> {durLabel(svc.duration_minutes)}</span>
                                                <span className="font-semibold">{svc.price_cents > 0 ? `₪${fmt(svc.price_ils)}` : tx("מחיר משתנה")}</span>
                                            </div>
                                            {svc.description && <p className="mt-2 text-xs text-slate-500">{svc.description}</p>}
                                            <div className="mt-3 flex flex-wrap gap-1.5">
                                                {svc.is_bookable_online && <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700"><Globe className="w-3 h-3" aria-hidden />{tx(" אונליין")}</span>}
                                                {svc.requires_consultation && <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-0.5 text-xs text-amber-700"><ClipboardList className="w-3 h-3" aria-hidden />{tx(" ייעוץ")}</span>}
                                                {svc.requires_deposit && <span className="inline-flex items-center gap-1 rounded-lg bg-sky-50 px-2 py-0.5 text-xs text-sky-700"><CreditCard className="w-3 h-3" aria-hidden />{tx(" מקדמה ₪")}{fmt(svc.deposit_amount_ils)}</span>}
                                                {svc.send_aftercare && <span className="inline-flex items-center gap-1 rounded-lg bg-pink-50 px-2 py-0.5 text-xs text-pink-700"><HeartPulse className="w-3 h-3" aria-hidden />{tx(" טיפול-אחרי")}</span>}
                                            </div>
                                            <div className="mt-3 flex justify-end gap-2">
                                                <button type="button" onClick={() => setModal(svc)}
                                                    className="inline-flex items-center gap-1 min-h-9 px-3 rounded-lg bg-slate-100 text-sm font-semibold text-slate-700 hover:bg-slate-200">
                                                    <Pencil className="w-3.5 h-3.5" aria-hidden /> {tx("עריכה")}
                                                </button>
                                                <button type="button" onClick={() => deleteService(svc.id)} aria-label={tx("מחיקת {0}", { 0: svc.name })}
                                                    className="inline-flex items-center justify-center min-h-9 w-9 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100">
                                                    <Trash2 className="w-4 h-4" aria-hidden />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        ))
                    )}

                    {modal && (
                        <ServiceModal
                            service={modal === "new" ? undefined : modal}
                            staff={staff}
                            onClose={() => setModal(null)}
                            onSaved={load}
                        />
                    )}
                </div>
            </AppShell>
        </RequireAuth>
    );
}
