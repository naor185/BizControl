"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Check, ChevronRight, ImagePlus, Lock, Phone, Search, Trash2, Trophy, Users, X } from "lucide-react";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import PlanLock from "@/components/PlanLock";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import { intl, tx } from "@/lib/i18n";
import { Audience, AUDIENCES, audienceLabel, ChosenClient, Draw, MAX_WINNERS, placeLabel, STATUS, Winner } from "@/lib/luckyClub";

// One Lucky Club draw (the owner's spec, 2026-11-04): a draft is written here — name, picture, when, its rules, who
// takes part (with how many, counted live), how many win and a prize for each place — then locked (who takes part is
// written down) and drawn (the server picks the winners). A done draw shows its winners, each prize's redeemed mark,
// and who took part. "new" = a draft not saved yet.

const LABEL = "mb-1.5 block text-xs font-semibold text-slate-600";
const INPUT = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100";

const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(intl(), { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null;

/** An ISO time as the datetime-local input wants it (the device's time) — and back. */
const toLocalInput = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (s: string) => (s ? new Date(s).toISOString() : null);

function BackLink() {
    return (
        <Link href="/clients/lucky" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900">
            <ChevronRight className="h-4 w-4 ltr:-scale-x-100" aria-hidden /> {tx("כל ההגרלות")}
        </Link>
    );
}

// ── the draft ──────────────────────────────────────────────────────────────────

type Form = {
    name: string; description: string; image_url: string; terms: string; scheduled_at: string; audience: Audience;
    winners_count: number; prizes: { title: string; description: string }[]; manual: ChosenClient[];
};

function formOf(d: Draw | null): Form {
    const prizes = Array.from({ length: MAX_WINNERS }, (_, i) => {
        const p = d?.prizes.find(x => x.place === i + 1);
        return { title: p?.title ?? "", description: p?.description ?? "" };
    });
    return {
        name: d?.name ?? "", description: d?.description ?? "", image_url: d?.image_url ?? "", terms: d?.terms ?? "",
        scheduled_at: toLocalInput(d?.scheduled_at ?? null), audience: d?.audience ?? "club",
        winners_count: d?.winners_count ?? 1, prizes, manual: d?.manual_clients ?? [],
    };
}

function Editor({ draw, onSaved }: { draw: Draw | null; onSaved: (d: Draw) => void }) {
    const router = useRouter();
    const [f, setF] = useState<Form>(() => formOf(draw));
    const [count, setCount] = useState<number | null>(draw?.participants_count ?? null);
    const [busy, setBusy] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [q, setQ] = useState("");
    const [found, setFound] = useState<ChosenClient[]>([]);
    const set = <K extends keyof Form>(k: K, v: Form[K]) => setF(x => ({ ...x, [k]: v }));

    // how many take part — counted on the server from the clients as they are now
    const manualIds = f.manual.map(c => c.id).join(",");
    useEffect(() => {
        const t = setTimeout(() => {
            apiFetch<{ count: number }>("/api/lucky-club/audience-count", {
                method: "POST", body: JSON.stringify({ audience: f.audience, client_ids: manualIds ? manualIds.split(",") : [] }),
            }).then(r => setCount(r.count)).catch(() => setCount(null));
        }, 250);
        return () => clearTimeout(t);
    }, [f.audience, manualIds]);

    // choosing clients by hand — the business's own, from the clients search
    useEffect(() => {
        if (f.audience !== "manual" || !q.trim()) { setFound([]); return; }
        const t = setTimeout(() => {
            apiFetch<ChosenClient[]>(`/api/clients/?q=${encodeURIComponent(q.trim())}&limit=8`)
                .then(list => setFound(list.filter(c => !c.full_name?.startsWith("לקוח מזדמן"))))
                .catch(() => setFound([]));
        }, 250);
        return () => clearTimeout(t);
    }, [q, f.audience]);

    const upload = async (file: File) => {
        const fd = new FormData();
        fd.append("file", file);
        setUploading(true);
        try {
            const r = await apiFetch<{ url?: string; filename: string }>("/api/studio/upload/image", { method: "POST", body: fd });
            set("image_url", r.url || r.filename);
        } catch (e) {
            toast.error((e as Error)?.message || tx("העלאת התמונה נכשלה"));
        } finally {
            setUploading(false);
        }
    };

    const body = () => ({
        name: f.name.trim(), description: f.description, image_url: f.image_url, terms: f.terms,
        scheduled_at: fromLocalInput(f.scheduled_at), audience: f.audience, winners_count: f.winners_count,
        manual_client_ids: f.manual.map(c => c.id),
        prizes: f.prizes.slice(0, f.winners_count).map((p, i) => ({ place: i + 1, title: p.title.trim(), description: p.description })),
    });

    const save = async (): Promise<Draw | null> => {
        if (!f.name.trim()) { toast.error(tx("שם ההגרלה חובה")); return null; }
        setBusy(true);
        try {
            const d = draw
                ? await apiFetch<Draw>(`/api/lucky-club/draws/${draw.id}`, { method: "PATCH", body: JSON.stringify(body()) })
                : await apiFetch<Draw>("/api/lucky-club/draws", { method: "POST", body: JSON.stringify(body()) });
            return d;
        } catch (e) {
            toast.error((e as Error)?.message || tx("השמירה נכשלה"));
            return null;
        } finally {
            setBusy(false);
        }
    };

    const saveOnly = async () => {
        const d = await save();
        if (!d) return;
        toast.success(tx("ההגרלה נשמרה"));
        if (!draw) router.replace(`/clients/lucky/${d.id}`); else onSaved(d);
    };

    const lock = async () => {
        const missing = f.prizes.slice(0, f.winners_count).findIndex(p => !p.title.trim());
        if (missing >= 0) { toast.error(tx("חסר פרס למקום {0}", { 0: missing + 1 })); return; }
        if (!confirm(tx("לנעול את ההגרלה עם {0} משתתפים? אחרי הנעילה רשימת המשתתפים קבועה ואי אפשר לשנות את ההגרלה.", { 0: count ?? "—" }))) return;
        const d = await save();
        if (!d) return;
        setBusy(true);
        try {
            const locked = await apiFetch<Draw>(`/api/lucky-club/draws/${d.id}/lock`, { method: "POST" });
            toast.success(tx("ההגרלה ננעלה — {0} משתתפים", { 0: locked.participants_count }));
            if (!draw) router.replace(`/clients/lucky/${d.id}`); else onSaved(locked);
        } catch (e) {
            toast.error((e as Error)?.message || tx("הנעילה נכשלה"));
            if (!draw) router.replace(`/clients/lucky/${d.id}`);
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!draw || !confirm(tx("למחוק את הטיוטה?"))) return;
        try {
            await apiFetch(`/api/lucky-club/draws/${draw.id}`, { method: "DELETE" });
            router.push("/clients/lucky");
        } catch (e) {
            toast.error((e as Error)?.message || tx("המחיקה נכשלה"));
        }
    };

    const enough = count !== null && count >= f.winners_count;

    return (
        <div className="mx-auto max-w-3xl space-y-5">
            <BackLink />
            <h1 className="text-2xl font-black text-slate-900">{draw ? tx("עריכת הגרלה") : tx("הגרלה חדשה")}</h1>

            {/* the draw */}
            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
                <div>
                    <label htmlFor="lucky-name" className={LABEL}>{tx("שם ההגרלה *")}</label>
                    <input id="lucky-name" value={f.name} onChange={e => set("name", e.target.value)} maxLength={120} className={INPUT}
                        placeholder={tx("לדוגמה: הגרלת חנוכה למועדון")} />
                </div>
                <div>
                    <label htmlFor="lucky-desc" className={LABEL}>{tx("תיאור")}</label>
                    <textarea id="lucky-desc" value={f.description} onChange={e => set("description", e.target.value)} maxLength={2000}
                        className={`${INPUT} min-h-[70px] resize-y`} placeholder={tx("מה מגרילים ולמה — יוצג במסך ההגרלה")} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                        <label htmlFor="lucky-when" className={LABEL}>{tx("תאריך ושעת ההגרלה")}</label>
                        <input id="lucky-when" type="datetime-local" value={f.scheduled_at} onChange={e => set("scheduled_at", e.target.value)} className={INPUT} />
                    </div>
                    <div>
                        <span className={LABEL}>{tx("תמונת ההגרלה")}</span>
                        <div className="flex items-center gap-3">
                            {f.image_url
                                ? <img src={f.image_url} alt="" className="h-12 w-12 rounded-xl object-cover" />
                                : <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-400"><ImagePlus className="h-5 w-5" aria-hidden /></span>}
                            <label className="inline-flex min-h-10 cursor-pointer items-center rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                                {uploading ? tx("מעלה...") : f.image_url ? tx("החלפה") : tx("העלאת תמונה")}
                                <input type="file" accept="image/*" className="hidden" disabled={uploading}
                                    onChange={e => { const file = e.target.files?.[0]; if (file) upload(file); e.target.value = ""; }} />
                            </label>
                            {f.image_url && (
                                <button type="button" onClick={() => set("image_url", "")} aria-label={tx("הסרת התמונה")}
                                    className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100">
                                    <X className="h-4 w-4" aria-hidden />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </section>

            {/* who takes part */}
            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-bold text-slate-900">{tx("מי משתתף")}</h2>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold ${enough ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                        <Users className="h-4 w-4" aria-hidden /> {count === null ? "—" : tx("{0} משתתפים", { 0: count })}
                    </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={tx("מי משתתף")}>
                    {AUDIENCES.map(a => (
                        <button key={a.key} type="button" role="radio" aria-checked={f.audience === a.key} onClick={() => set("audience", a.key)}
                            className={`rounded-xl border-2 px-4 py-3 text-start transition ${f.audience === a.key ? "border-amber-500 bg-amber-50" : "border-slate-200 hover:border-slate-300"}`}>
                            <span className="block text-sm font-bold text-slate-900">{a.label}</span>
                            <span className="block text-xs text-slate-500">{a.hint}</span>
                        </button>
                    ))}
                </div>
                {f.audience === "manual" && (
                    <div className="space-y-3">
                        <div className="relative">
                            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                            <input value={q} onChange={e => setQ(e.target.value)} className={`${INPUT} ps-9`}
                                placeholder={tx("חיפוש לקוח לפי שם או טלפון")} aria-label={tx("חיפוש לקוח לפי שם או טלפון")} />
                            {found.filter(c => !f.manual.some(m => m.id === c.id)).length > 0 && (
                                <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                                    {found.filter(c => !f.manual.some(m => m.id === c.id)).map(c => (
                                        <li key={c.id}>
                                            <button type="button" onClick={() => { set("manual", [...f.manual, c]); setQ(""); }}
                                                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-start text-sm hover:bg-slate-50">
                                                <span className="font-semibold text-slate-800">{c.full_name}</span>
                                                <span className="text-xs text-slate-500" dir="ltr">{c.phone}</span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                        {f.manual.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                                {f.manual.map(c => (
                                    <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pe-1 ps-3 text-sm text-slate-800">
                                        {c.full_name}
                                        <button type="button" onClick={() => set("manual", f.manual.filter(m => m.id !== c.id))}
                                            aria-label={tx("הסרת {0}", { 0: c.full_name })} className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-slate-200">
                                            <X className="h-3.5 w-3.5" aria-hidden />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        ) : <p className="text-sm text-slate-500">{tx("עוד לא נבחרו לקוחות")}</p>}
                    </div>
                )}
                <p className="text-xs text-slate-500">{tx("לקוחות שנמחקו ו\"לקוח מזדמן\" לא משתתפים. הרשימה נקבעת ברגע הנעילה.")}</p>
            </section>

            {/* winners and prizes */}
            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-bold text-slate-900">{tx("זוכים ופרסים")}</h2>
                    <div className="inline-flex rounded-xl border border-slate-200 p-1" role="radiogroup" aria-label={tx("מספר הזוכים")}>
                        {Array.from({ length: MAX_WINNERS }, (_, i) => i + 1).map(n => (
                            <button key={n} type="button" role="radio" aria-checked={f.winners_count === n} onClick={() => set("winners_count", n)}
                                className={`min-h-9 rounded-lg px-3 text-sm font-bold transition ${f.winners_count === n ? "bg-amber-500 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
                                {n === 1 ? tx("זוכה אחד") : tx("{0} זוכים", { 0: n })}
                            </button>
                        ))}
                    </div>
                </div>
                {f.prizes.slice(0, f.winners_count).map((p, i) => (
                    <div key={i} className="grid gap-2 sm:grid-cols-[7rem_1fr]">
                        <span className="pt-2.5 text-sm font-bold text-slate-700">{placeLabel(i + 1)}</span>
                        <div className="space-y-2">
                            <input value={p.title} maxLength={160} aria-label={tx("הפרס ל{0}", { 0: placeLabel(i + 1) })}
                                onChange={e => set("prizes", f.prizes.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                                className={INPUT} placeholder={[tx("לדוגמה: טיפול מתנה"), tx("לדוגמה: 30% הנחה"), tx("לדוגמה: מוצר מתנה")][i]} />
                            <input value={p.description} maxLength={1000} aria-label={tx("פרטי הפרס ל{0}", { 0: placeLabel(i + 1) })}
                                onChange={e => set("prizes", f.prizes.map((x, j) => j === i ? { ...x, description: e.target.value } : x))}
                                className={INPUT} placeholder={tx("פרטים (לא חובה) — למשל עד מתי אפשר לממש")} />
                        </div>
                    </div>
                ))}
            </section>

            {/* the rules */}
            <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-5">
                <label htmlFor="lucky-terms" className="font-bold text-slate-900">{tx("תקנון")} <span className="text-sm font-normal text-slate-400">{tx("— לא חובה")}</span></label>
                <textarea id="lucky-terms" value={f.terms} onChange={e => set("terms", e.target.value)} maxLength={5000}
                    className={`${INPUT} min-h-[90px] resize-y`}
                    placeholder={tx("מי רשאי להשתתף, איך מממשים את הפרס ועד מתי. יוצג במסך ההגרלה.")} />
                <p className="text-xs text-slate-500">{tx("הגרלות בישראל כפופות לחוק — מומלץ לפרסם תקנון קצר. זה לא ייעוץ משפטי.")}</p>
            </section>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    {draw && (
                        <button type="button" onClick={remove} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-rose-600 hover:bg-rose-50">
                            <Trash2 className="h-4 w-4" aria-hidden /> {tx("מחיקת הטיוטה")}
                        </button>
                    )}
                </div>
                <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={saveOnly} disabled={busy}
                        className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                        {busy ? tx("שומר...") : tx("שמירת טיוטה")}
                    </button>
                    <button type="button" onClick={lock} disabled={busy || !enough}
                        title={!enough ? tx("צריך לפחות משתתף אחד לכל זוכה") : undefined}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-amber-500 px-4 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-50">
                        <Lock className="h-4 w-4" aria-hidden /> {tx("נעילת ההגרלה")}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── locked, done, canceled ─────────────────────────────────────────────────────

function WinnerCard({ w, onChange }: { w: Winner; onChange: (w: Winner) => void }) {
    const [busy, setBusy] = useState(false);
    const toggle = async () => {
        setBusy(true);
        try {
            onChange(await apiFetch<Winner>(`/api/lucky-club/winners/${w.id}/redeem`, {
                method: "POST", body: JSON.stringify({ redeemed: w.status !== "redeemed" }),
            }));
        } catch (e) {
            toast.error((e as Error)?.message || tx("העדכון נכשל"));
        } finally {
            setBusy(false);
        }
    };
    const redeemed = w.status === "redeemed";
    return (
        <li className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-500 text-lg font-black text-white">{w.place}</span>
            <div className="min-w-0 flex-1">
                <div className="font-bold text-slate-900">{w.full_name}</div>
                <div className="text-sm text-slate-600">{w.prize_title}</div>
                {w.phone && (
                    <a href={`tel:${w.phone}`} className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800" dir="ltr">
                        <Phone className="h-3 w-3" aria-hidden /> {w.phone}
                    </a>
                )}
            </div>
            <div className="flex flex-col items-end gap-1.5">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${redeemed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                    {redeemed ? tx("מומש · {0}", { 0: when(w.redeemed_at) }) : tx("ממתין למימוש")}
                </span>
                <button type="button" onClick={toggle} disabled={busy}
                    className={`inline-flex min-h-9 items-center gap-1 rounded-lg px-3 text-xs font-bold disabled:opacity-60 ${redeemed ? "text-slate-600 hover:bg-slate-100" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}>
                    {redeemed ? tx("החזרה לממתין") : <><Check className="h-3.5 w-3.5" aria-hidden /> {tx("סימון כמומש")}</>}
                </button>
            </div>
        </li>
    );
}

function DrawView({ draw, onChange }: { draw: Draw; onChange: (d: Draw) => void }) {
    const [busy, setBusy] = useState(false);
    const [filter, setFilter] = useState("");
    const people = useMemo(() => {
        const all = draw.participants || [];
        const t = filter.trim();
        return t ? all.filter(p => p.full_name.includes(t)) : all;
    }, [draw.participants, filter]);

    const act = async (path: string, ask: string, done: string) => {
        if (!confirm(ask)) return;
        setBusy(true);
        try {
            onChange(await apiFetch<Draw>(`/api/lucky-club/draws/${draw.id}/${path}`, { method: "POST" }));
            toast.success(done);
        } catch (e) {
            toast.error((e as Error)?.message || tx("הפעולה נכשלה"));
        } finally {
            setBusy(false);
        }
    };

    const meta: [string, string | null][] = [
        [tx("מי משתתף"), audienceLabel(draw.audience)],
        [tx("משתתפים"), String(draw.participants_count)],
        [tx("מועד ההגרלה"), when(draw.scheduled_at)],
        [tx("ננעלה"), draw.locked_at ? `${when(draw.locked_at)}${draw.locked_by_name ? ` · ${draw.locked_by_name}` : ""}` : null],
        [tx("הוגרלה"), draw.drawn_at ? `${when(draw.drawn_at)}${draw.drawn_by_name ? ` · ${draw.drawn_by_name}` : ""}` : null],
        [tx("בוטלה"), when(draw.canceled_at)],
    ];

    return (
        <div className="mx-auto max-w-3xl space-y-5">
            <BackLink />
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {draw.image_url && <img src={draw.image_url} alt="" className="h-44 w-full object-cover" />}
                <div className="space-y-3 p-5">
                    <div className="flex flex-wrap items-center gap-2">
                        <h1 className="text-2xl font-black text-slate-900">{draw.name}</h1>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS[draw.status].chip}`}>{STATUS[draw.status].label}</span>
                    </div>
                    {draw.description && <p className="whitespace-pre-line text-sm text-slate-600">{draw.description}</p>}
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                        {meta.filter(([, v]) => v).map(([k, v]) => (
                            <div key={k}>
                                <dt className="text-xs text-slate-500">{k}</dt>
                                <dd className="font-semibold text-slate-800">{v}</dd>
                            </div>
                        ))}
                    </dl>
                    {draw.terms && (
                        <details className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
                            <summary className="cursor-pointer font-semibold text-slate-700">{tx("תקנון")}</summary>
                            <p className="mt-2 whitespace-pre-line text-slate-600">{draw.terms}</p>
                        </details>
                    )}
                </div>
            </section>

            {draw.status === "done" ? (
                <section className="space-y-3">
                    <h2 className="flex items-center gap-2 font-bold text-slate-900"><Trophy className="h-5 w-5 text-amber-500" aria-hidden /> {tx("הזוכים")}</h2>
                    <ul className="space-y-2">
                        {draw.winners.map(w => (
                            <WinnerCard key={w.id} w={w} onChange={nw => onChange({ ...draw, winners: draw.winners.map(x => x.id === nw.id ? nw : x) })} />
                        ))}
                    </ul>
                    <p className="text-xs text-slate-500">{tx("הזוכים נבחרו באקראי בשרת ולא ניתנים לשינוי. אפשר רק לסמן אם הפרס מומש.")}</p>
                </section>
            ) : (
                <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
                    <h2 className="font-bold text-slate-900">{tx("הפרסים")}</h2>
                    <ul className="space-y-1.5 text-sm">
                        {draw.prizes.map(p => (
                            <li key={p.place}><span className="font-semibold text-slate-800">{placeLabel(p.place)}:</span> {p.title}
                                {p.description && <span className="text-slate-500"> — {p.description}</span>}</li>
                        ))}
                    </ul>
                </section>
            )}

            {draw.status === "locked" && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm text-amber-900">
                        {tx("ההגרלה נעולה עם {0} משתתפים. המערכת תבחר {1} זוכים באקראי — פעם אחת, בלי אפשרות לשנות.", { 0: draw.participants_count, 1: draw.winners_count })}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={busy}
                            onClick={() => act("cancel", tx("לבטל את ההגרלה? היא תישאר בהיסטוריה כמבוטלת."), tx("ההגרלה בוטלה"))}
                            className="min-h-11 rounded-xl px-3 text-sm font-semibold text-rose-600 hover:bg-rose-100 disabled:opacity-60">
                            {tx("ביטול ההגרלה")}
                        </button>
                        <button type="button" disabled={busy}
                            onClick={() => act("run", tx("להגריל עכשיו? יוגרלו {0} זוכים מתוך {1} משתתפים, והזוכים לא ישתנו.", { 0: draw.winners_count, 1: draw.participants_count }), tx("ההגרלה בוצעה"))}
                            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-amber-500 px-4 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-60">
                            <Trophy className="h-4 w-4" aria-hidden /> {tx("להגריל עכשיו")}
                        </button>
                    </div>
                </div>
            )}

            {(draw.participants?.length ?? 0) > 0 && (
                <details className="rounded-2xl border border-slate-200 bg-white p-5">
                    <summary className="cursor-pointer font-bold text-slate-900">{tx("המשתתפים ({0})", { 0: draw.participants_count })}</summary>
                    <p className="mt-1 text-xs text-slate-500">{tx("כמו שהיו ברגע הנעילה")}</p>
                    <input value={filter} onChange={e => setFilter(e.target.value)} className={`${INPUT} mt-3`}
                        placeholder={tx("חיפוש משתתף")} aria-label={tx("חיפוש משתתף")} />
                    <ul className="mt-3 grid max-h-96 gap-1 overflow-y-auto sm:grid-cols-2">
                        {people.slice(0, 500).map(p => (
                            <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm odd:bg-slate-50">
                                <span className="text-slate-800">{p.full_name}</span>
                                {p.was_club_member && <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800">{tx("מועדון")}</span>}
                            </li>
                        ))}
                    </ul>
                    {people.length > 500 && <p className="mt-2 text-xs text-slate-500">{tx("ועוד {0} — חפשו לפי שם", { 0: people.length - 500 })}</p>}
                </details>
            )}
        </div>
    );
}

// ── the page ───────────────────────────────────────────────────────────────────

function DrawPage() {
    const { id } = useParams<{ id: string }>();
    const isNew = id === "new";
    const [draw, setDraw] = useState<Draw | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const loaded = useRef<string | null>(null);

    const load = useCallback(() => {
        apiFetch<Draw>(`/api/lucky-club/draws/${id}`).then(setDraw).catch(e => setErr(e?.message || tx("הטעינה נכשלה")));
    }, [id]);

    useEffect(() => {
        if (isNew || loaded.current === id) return;
        loaded.current = id;
        load();
    }, [id, isNew, load]);

    if (isNew) return <Editor draw={null} onSaved={setDraw} />;
    if (err) return <div className="mx-auto max-w-3xl space-y-4"><BackLink /><div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{err}</div></div>;
    if (!draw) return <div className="flex h-40 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-amber-500" /></div>;
    if (draw.status === "draft") return <Editor key={draw.id} draw={draw} onSaved={setDraw} />;
    return <DrawView draw={draw} onChange={setDraw} />;
}

export default function LuckyDrawPage() {
    return (
        <RequireAuth>
            <AppShell title={tx("Lucky Club")}>
                <PlanLock module="lucky_club" feature={tx("Lucky Club — הגרלות ופרסים")}>
                    <DrawPage />
                </PlanLock>
            </AppShell>
        </RequireAuth>
    );
}
