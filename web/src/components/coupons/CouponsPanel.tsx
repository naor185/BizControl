"use client";

import { useCallback, useEffect, useState } from "react";
import { Cake, Link2, Loader2, Pause, Pencil, Play, Plus, Tag, Ticket, Trash2, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import { BIZFIND_URL } from "@/lib/config";
import ShareLink from "@/components/ShareLink";

// The business's own coupons (GET/POST/PATCH/DELETE /api/coupons): the owner writes the code and the percent, a
// category and where it was handed out; each coupon has a link to the business's BizFind page that shows it. The
// report: uses, what is left, money in and the discount given — per coupon, per category, per source. Birthday
// coupons (made by the system) are one line. The code is used at the till and on the payment screen.

type State = "active" | "stopped" | "expired" | "used_up";
interface CouponRow {
    id: string; code: string; discount_percent: number; category: string | null; source: string | null;
    max_uses: number | null; once_per_client: boolean; expires_on: string | null; is_active: boolean; note: string | null;
    state: State; uses: number; left: number | null; clicks: number; paid_cents: number; discount_cents: number;
}
interface GroupRow { name: string; coupons: number; uses: number; paid_cents: number; discount_cents: number; clicks: number }
interface Report {
    coupons: CouponRow[];
    birthday: { issued: number; active: number; uses: number; paid_cents: number; discount_cents: number };
    by_category: GroupRow[]; by_source: GroupRow[];
    totals: { uses: number; paid_cents: number; discount_cents: number; clicks: number };
    studio_slug: string | null;
}

const STATE: Record<State, { label: string; cls: string }> = {
    active:  { label: "פעיל",       cls: "bg-emerald-100 text-emerald-700" },
    stopped: { label: "הופסק",      cls: "bg-slate-200 text-slate-600" },
    expired: { label: "פג תוקף",    cls: "bg-amber-100 text-amber-700" },
    used_up: { label: "נוצל עד הסוף", cls: "bg-violet-100 text-violet-700" },
};
const PERCENTS = [5, 10, 15, 20, 25, 30];
const SOURCES = ["אינסטגרם", "פייסבוק", "טיקטוק", "וואטסאפ", "גוגל", "פלאייר", "משפיען/ית", "לקוח ממליץ"];
const USES: (number | null)[] = [null, 1, 10, 50, 100];
const ils = (cents: number) => `₪${(cents / 100).toLocaleString("he-IL", { maximumFractionDigits: 0 })}`;

export default function CouponsPanel() {
    const [data, setData] = useState<Report | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<CouponRow | "new" | null>(null);
    const [linkOf, setLinkOf] = useState<string | null>(null);

    const load = useCallback(() => {
        apiFetch<Report>("/api/coupons").then(setData).catch(e => setError(e instanceof Error ? e.message : "הטעינה נכשלה"));
    }, []);
    useEffect(() => { load(); }, [load]);

    const act = async (fn: () => Promise<unknown>, done: string) => {
        try { await fn(); toast.success(done); load(); }
        catch (e) { toast.error(e instanceof Error ? e.message : "הפעולה נכשלה"); }
    };

    if (error) return <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">{error.includes("רק לבעלים") ? "הקופונים — לבעלים או למנהל." : error}</p>;
    if (!data) return <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 text-violet-600 animate-spin" aria-label="טוען" /></div>;

    const linkFor = (code: string) => (BIZFIND_URL && data.studio_slug ? `${BIZFIND_URL}/b/${data.studio_slug}?c=${encodeURIComponent(code)}` : null);
    const active = data.coupons.filter(c => c.state === "active").length;

    return (
        <div className="space-y-5">
            {/* Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {[
                    { label: "קופונים פעילים", value: active },
                    { label: "שימושים", value: data.totals.uses },
                    { label: "כסף שנכנס", value: ils(data.totals.paid_cents) },
                    { label: "הנחה שניתנה", value: ils(data.totals.discount_cents) },
                    { label: "כניסות מהקישורים", value: data.totals.clicks },
                ].map(({ label, value }) => (
                    <div key={label} className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
                        <div className="text-xl font-black text-slate-800 tabular-nums">{value}</div>
                        <div className="text-xs text-slate-400 mt-0.5">{label}</div>
                    </div>
                ))}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
                <button type="button" onClick={() => setEditing("new")}
                    className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white font-bold text-sm px-4 py-2 rounded-xl">
                    <Plus className="w-4 h-4" aria-hidden /> קופון חדש
                </button>
                <p className="text-xs text-slate-400">הקוד מוקלד בקופה או במסך התשלום של תור — ההנחה יורדת והשימוש נרשם כאן.</p>
            </div>

            {/* The coupons */}
            {data.coupons.length === 0 && !data.birthday.issued ? (
                <div className="text-center py-14 text-slate-400">
                    <Ticket className="w-10 h-10 mx-auto mb-3" strokeWidth={1.5} aria-hidden />
                    <div>אין קופונים עדיין — צרו קופון ראשון, למשל SUMMER10</div>
                </div>
            ) : (
                <div className="grid gap-3">
                    {data.coupons.map(c => {
                        const st = STATE[c.state];
                        const url = linkFor(c.code);
                        return (
                            <div key={c.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
                                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <code className="text-base font-black text-violet-700 bg-violet-50 px-2 py-0.5 rounded-lg" dir="ltr">{c.code}</code>
                                            <span className="text-lg font-black text-slate-800">{c.discount_percent}%</span>
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                                        </div>
                                        <div className="flex gap-1.5 flex-wrap mt-2 text-xs">
                                            {c.category && <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full"><Tag className="w-3 h-3" aria-hidden />{c.category}</span>}
                                            {c.source && <span className="bg-sky-50 text-sky-700 px-2 py-0.5 rounded-full">מקור: {c.source}</span>}
                                            {c.once_per_client && <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">פעם אחת ללקוח</span>}
                                            {c.expires_on && <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">עד {new Date(c.expires_on).toLocaleDateString("he-IL")}</span>}
                                        </div>
                                        {c.note && <p className="text-xs text-slate-500 mt-1.5">{c.note}</p>}
                                    </div>
                                    <dl className="grid grid-cols-4 gap-x-3 gap-y-0.5 text-center text-xs text-slate-400 bg-slate-50 rounded-xl px-2 py-2 sm:bg-transparent sm:p-0">
                                        <dt>שימושים</dt><dt>כניסות</dt><dt>נכנס</dt><dt>הנחה</dt>
                                        <dd className="text-sm font-bold text-slate-800 tabular-nums">{c.max_uses != null ? `${c.uses} מתוך ${c.max_uses}` : c.uses}</dd>
                                        <dd className="text-sm font-bold text-slate-800 tabular-nums">{c.clicks}</dd>
                                        <dd className="text-sm font-bold text-emerald-700 tabular-nums">{ils(c.paid_cents)}</dd>
                                        <dd className="text-sm font-bold text-rose-600 tabular-nums">{ils(c.discount_cents)}</dd>
                                    </dl>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <SmallBtn onClick={() => setLinkOf(linkOf === c.id ? null : c.id)} icon={Link2}>קישור</SmallBtn>
                                    <SmallBtn onClick={() => setEditing(c)} icon={Pencil}>עריכה</SmallBtn>
                                    {c.is_active ? (
                                        <SmallBtn icon={Pause} onClick={() => act(() => apiFetch(`/api/coupons/${c.id}`, { method: "PATCH", body: JSON.stringify({ is_active: false }) }), "הקופון הופסק")}>הפסקה</SmallBtn>
                                    ) : (
                                        <SmallBtn icon={Play} onClick={() => act(() => apiFetch(`/api/coupons/${c.id}`, { method: "PATCH", body: JSON.stringify({ is_active: true }) }), "הקופון חזר לפעול")}>הפעלה</SmallBtn>
                                    )}
                                    {c.uses === 0 && (
                                        <SmallBtn icon={Trash2} danger onClick={() => { if (confirm(`למחוק את הקופון ${c.code}?`)) act(() => apiFetch(`/api/coupons/${c.id}`, { method: "DELETE" }), "הקופון נמחק"); }}>מחיקה</SmallBtn>
                                    )}
                                </div>
                                {linkOf === c.id && (
                                    url ? (
                                        <div className="border-t border-slate-100 pt-3">
                                            <p className="text-xs text-slate-500 mb-2">מי שנכנס בקישור רואה את דף העסק ב-BizFind עם הקופון ({c.discount_percent}% הנחה) — וכל כניסה נספרת כאן.</p>
                                            <ShareLink url={url} whatsappText={`קופון ${c.code} — ${c.discount_percent}% הנחה:`}
                                                printTitle={`${c.discount_percent}% הנחה`} printLine={`קוד קופון: ${c.code} · סורקים ומציגים בקופה`} />
                                        </div>
                                    ) : <p className="text-sm text-amber-900 bg-amber-50 rounded-xl px-3 py-2">כתובת BizFind לא מוגדרת במערכת — פנו לתמיכה של BizControl.</p>
                                )}
                            </div>
                        );
                    })}
                    {data.birthday.issued > 0 && (
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                            <Cake className="w-6 h-6 text-pink-500 hidden sm:block" aria-hidden />
                            <div className="flex-1 min-w-0">
                                <div className="font-bold text-slate-800 flex items-center gap-1.5"><Cake className="w-4 h-4 text-pink-500 sm:hidden" aria-hidden />קופוני יום הולדת</div>
                                <div className="text-xs text-slate-400">המערכת יוצרת אחד לכל לקוח ביום ההולדת · {data.birthday.issued} נוצרו · {data.birthday.active} עוד פעילים</div>
                            </div>
                            <dl className="grid grid-cols-3 gap-x-3 gap-y-0.5 text-center text-xs text-slate-400 bg-slate-50 rounded-xl px-2 py-2 sm:bg-transparent sm:p-0">
                                <dt>שימושים</dt><dt>נכנס</dt><dt>הנחה</dt>
                                <dd className="text-sm font-bold text-slate-800 tabular-nums">{data.birthday.uses}</dd>
                                <dd className="text-sm font-bold text-emerald-700 tabular-nums">{ils(data.birthday.paid_cents)}</dd>
                                <dd className="text-sm font-bold text-rose-600 tabular-nums">{ils(data.birthday.discount_cents)}</dd>
                            </dl>
                        </div>
                    )}
                </div>
            )}

            {/* By category / by source */}
            {(data.by_category.length > 0 || data.by_source.length > 0) && (
                <div className="grid md:grid-cols-2 gap-4">
                    <GroupTable title="לפי קטגוריה" rows={data.by_category} />
                    <GroupTable title="לפי מקור" rows={data.by_source} />
                </div>
            )}

            {editing && (
                <CouponSheet coupon={editing === "new" ? null : editing} categories={Array.from(new Set(data.coupons.map(c => c.category).filter((x): x is string => !!x)))}
                    onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
            )}
        </div>
    );
}

function SmallBtn({ onClick, icon: Icon, children, danger }: { onClick: () => void; icon: typeof Plus; children: React.ReactNode; danger?: boolean }) {
    return (
        <button type="button" onClick={onClick}
            className={`inline-flex items-center gap-1.5 min-h-9 px-3 rounded-xl border text-sm font-semibold ${danger ? "border-rose-200 text-rose-600 hover:bg-rose-50" : "border-slate-200 text-slate-700 hover:border-slate-400"}`}>
            <Icon className="w-4 h-4" aria-hidden /> {children}
        </button>
    );
}

function GroupTable({ title, rows }: { title: string; rows: GroupRow[] }) {
    return (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <h3 className="font-bold text-slate-800 px-4 pt-3 pb-2">{title}</h3>
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-right min-w-[22rem]">
                    <thead><tr className="bg-slate-50 text-slate-500 text-xs"><th className="px-4 py-2">שם</th><th className="px-2 py-2 text-center">קופונים</th><th className="px-2 py-2 text-center">שימושים</th><th className="px-2 py-2 text-center">נכנס</th><th className="px-2 py-2 text-center">הנחה</th></tr></thead>
                    <tbody className="divide-y divide-slate-50">
                        {rows.map(r => (
                            <tr key={r.name}>
                                <td className="px-4 py-2 font-semibold text-slate-700">{r.name}</td>
                                <td className="px-2 py-2 text-center tabular-nums">{r.coupons}</td>
                                <td className="px-2 py-2 text-center tabular-nums">{r.uses}</td>
                                <td className="px-2 py-2 text-center tabular-nums text-emerald-700 font-bold">{ils(r.paid_cents)}</td>
                                <td className="px-2 py-2 text-center tabular-nums text-rose-600">{ils(r.discount_cents)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ── new / edit ────────────────────────────────────────────────────────────────

function addDays(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function CouponSheet({ coupon, categories, onClose, onSaved }: { coupon: CouponRow | null; categories: string[]; onClose: () => void; onSaved: () => void }) {
    const [code, setCode] = useState(coupon?.code || "");
    const [percent, setPercent] = useState<number>(coupon?.discount_percent || 10);
    const [category, setCategory] = useState(coupon?.category || "");
    const [source, setSource] = useState(coupon?.source || "");
    const [maxUses, setMaxUses] = useState<number | null>(coupon?.max_uses ?? null);
    const [once, setOnce] = useState(coupon?.once_per_client || false);
    const [expires, setExpires] = useState(coupon?.expires_on || "");
    const [note, setNote] = useState(coupon?.note || "");
    const [busy, setBusy] = useState(false);

    const save = async () => {
        setBusy(true);
        try {
            const body = { discount_percent: percent, category: category || null, source: source || null, max_uses: maxUses,
                           once_per_client: once, expires_on: expires || null, note: note || null };
            if (coupon) await apiFetch(`/api/coupons/${coupon.id}`, { method: "PATCH", body: JSON.stringify(body) });
            else await apiFetch("/api/coupons", { method: "POST", body: JSON.stringify({ ...body, code }) });
            toast.success(coupon ? "הקופון עודכן" : `הקופון ${code} נוצר`);
            onSaved();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "השמירה נכשלה");
        } finally {
            setBusy(false);
        }
    };

    const chip = (on: boolean) => `min-h-9 px-3 rounded-xl border text-sm font-semibold ${on ? "bg-violet-600 border-violet-600 text-white" : "border-slate-200 text-slate-700 hover:border-slate-400"}`;
    const input = "w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-300";
    const label = "block text-xs font-bold text-slate-500 mb-1.5";
    const validCode = /^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code);

    return (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92dvh] overflow-auto p-5 space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-black">{coupon ? `עריכת קופון ${coupon.code}` : "קופון חדש"}</h2>
                    <button type="button" onClick={onClose} aria-label="סגירה" className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
                </div>

                <div>
                    <label className={label}>הקוד (אתם בוחרים — באנגלית וספרות)</label>
                    <input value={code} disabled={!!coupon} onChange={e => setCode(e.target.value.toUpperCase().replace(/\s/g, ""))} dir="ltr" placeholder="SUMMER10" maxLength={32}
                        className={`${input} font-mono font-bold tracking-wider disabled:bg-slate-50 disabled:text-slate-500`} />
                    {coupon && <p className="text-xs text-slate-400 mt-1">הקוד לא משתנה — הקישור שלו כבר בחוץ.</p>}
                    {!coupon && code && !validCode && <p className="text-xs text-rose-600 mt-1">3 עד 32 תווים: אותיות באנגלית, ספרות, מקף או קו תחתון</p>}
                </div>

                <div>
                    <label className={label}>אחוז הנחה</label>
                    <div className="flex flex-wrap gap-2 items-center">
                        {PERCENTS.map(p => <button key={p} type="button" onClick={() => setPercent(p)} className={chip(percent === p)}>{p}%</button>)}
                        <span className="inline-flex items-center gap-1 text-sm text-slate-500">אחר:
                            <input type="number" min={1} max={100} value={percent} onChange={e => setPercent(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                                className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm" /> %
                        </span>
                    </div>
                </div>

                <div>
                    <label className={label}>קטגוריה (שם שלכם — למשל "קיץ", "משפיענים")</label>
                    <input value={category} onChange={e => setCategory(e.target.value)} list="coupon-categories" maxLength={60} className={input} placeholder="ללא" />
                    <datalist id="coupon-categories">{categories.map(c => <option key={c} value={c} />)}</datalist>
                    {categories.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">{categories.map(c => <button key={c} type="button" onClick={() => setCategory(c)} className={chip(category === c)}>{c}</button>)}</div>
                    )}
                </div>

                <div>
                    <label className={label}>מקור — איפה הקופון מופץ</label>
                    <div className="flex flex-wrap gap-1.5 mb-2">{SOURCES.map(s => <button key={s} type="button" onClick={() => setSource(source === s ? "" : s)} className={chip(source === s)}>{s}</button>)}</div>
                    <input value={source} onChange={e => setSource(e.target.value)} maxLength={60} className={input} placeholder="או כתבו משלכם — למשל שם המשפיען/ית" />
                </div>

                <div>
                    <label className={label}>כמה פעמים אפשר להשתמש</label>
                    <div className="flex flex-wrap gap-2 items-center">
                        {USES.map(u => <button key={String(u)} type="button" onClick={() => setMaxUses(u)} className={chip(maxUses === u)}>{u == null ? "ללא הגבלה" : u}</button>)}
                        <span className="inline-flex items-center gap-1 text-sm text-slate-500">אחר:
                            <input type="number" min={1} value={maxUses ?? ""} onChange={e => setMaxUses(e.target.value ? Math.max(1, Number(e.target.value)) : null)}
                                className="w-20 border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
                        </span>
                    </div>
                    <label className="flex items-center gap-2 mt-2.5 text-sm text-slate-700 cursor-pointer">
                        <input type="checkbox" checked={once} onChange={e => setOnce(e.target.checked)} className="w-4 h-4 accent-violet-600" />
                        פעם אחת לכל לקוח (בקופה צריך לבחור לקוח)
                    </label>
                </div>

                <div>
                    <label className={label}>בתוקף עד</label>
                    <div className="flex flex-wrap gap-2 items-center">
                        {([["ללא", ""], ["שבוע", addDays(7)], ["חודש", addDays(30)], ["3 חודשים", addDays(90)]] as const).map(([l, v]) => (
                            <button key={l} type="button" onClick={() => setExpires(v)} className={chip(expires === v)}>{l}</button>
                        ))}
                        <input type="date" value={expires} onChange={e => setExpires(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
                    </div>
                </div>

                <div>
                    <label className={label}>הערה לעצמכם (לא חובה)</label>
                    <input value={note} onChange={e => setNote(e.target.value)} maxLength={300} className={input} />
                </div>

                <button type="button" onClick={save} disabled={busy || (!coupon && !validCode)}
                    className="w-full inline-flex items-center justify-center gap-2 min-h-12 rounded-2xl bg-violet-600 hover:bg-violet-700 text-white font-bold disabled:opacity-40">
                    {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />} {coupon ? "שמירה" : "יצירת הקופון"}
                </button>
            </div>
        </div>
    );
}
