"use client";

// The guide — "המדריך שלך" (the owner, 2026-10-15): a new business owner learns the system inside it, one step at a time
// (lib/tours): it says what to do, takes you to the screen, highlights the thing to press there, and moves on only when
// the server confirms the step really happened (api/tutorial_routes /checks) — with praise. Three paths: the owner's
// first steps (opens by itself once), the owner's working day (offered when the first steps are done), and a worker's
// first steps (opens by itself once). It can be shrunk, skipped step by step, closed, and opened again from the "?"
// button; its state is kept per user on the server, so the phone, the computer and the app agree. It never blocks the
// screen: the highlight lets every click through.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, CircleHelp, GraduationCap, PlayCircle, X } from "lucide-react";
import { apiFetch, getCurrentUserRole } from "@/lib/api";
import { toast } from "@/lib/toast";
import { OWNER_START, TOURS, posterOf, type TourDef, type TourMove, type TourStep } from "@/lib/tours";
import VideoModal from "./VideoModal";

type TourState = { state: "active" | "dismissed" | "done"; skipped: string[] };
type Checks = Record<string, { applies: boolean; done: boolean }>;
type TourApi = { available: boolean; open: () => void; startAt: (stepId: string) => void; stepFor: (itemId: string) => string | null };

const TourContext = createContext<TourApi>({ available: false, open: () => {}, startAt: () => {}, stepFor: () => null });
export const useTour = () => useContext(TourContext);

const MIN_KEY = "bc_tour_minimized";
const AVOID = ["settings-save", "plan-bar"];   // fixed bars at the bottom the guide mustn't cover
const WORKERS = ["artist", "staff"];
const pathOf = (href: string) => href.split("?")[0];
const hasTab = (href: string) => href.includes("tab=");
const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// the marked element on the screen (and, for `enabled`, one that can be pressed now)
function onScreen(name: string, enabled = false): HTMLElement | null {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && !(enabled && el.matches(":disabled"))) return el;
    }
    return null;
}

function celebrate() {
    if (reducedMotion()) return;
    import("canvas-confetti").then(m => m.default({ particleCount: 90, spread: 75, origin: { y: 0.75 } })).catch(() => {});
}

export function TourButton() {
    const tour = useTour();
    if (!tour.available) return null;
    return (
        <button type="button" onClick={tour.open} title="הדרכה צעד אחר צעד" aria-label="פתיחת המדריך — הדרכה צעד אחר צעד"
            className="w-9 h-9 flex items-center justify-center rounded-full text-slate-500 hover:text-sky-600 hover:bg-sky-50 transition">
            <CircleHelp className="w-5 h-5" aria-hidden />
        </button>
    );
}

export default function TourProvider({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const [who] = useState<"owner" | "worker" | null>(() => {
        const role = getCurrentUserRole();
        return role === "owner" ? "owner" : role && WORKERS.includes(role) ? "worker" : null;
    });
    const mine = useMemo(() => TOURS.filter(t => t.who === who), [who]);
    const [tours, setTours] = useState<Record<string, TourState> | null>(null);
    const [checks, setChecks] = useState<Checks | null>(null);
    const [name, setName] = useState<string | null>(null);
    const [intro, setIntro] = useState(false);
    const [picking, setPicking] = useState(false);            // "?" with more than one path — which one
    const [focus, setFocus] = useState<string | null>(null);
    const [praise, setPraise] = useState<TourStep | null>(null);
    const [minimized, setMinimizedState] = useState(() => { try { return localStorage.getItem(MIN_KEY) === "1"; } catch { return false; } });
    const [shown, setShown] = useState<{ move: TourMove; rect: DOMRect } | null>(null);
    const [panelOnTop, setPanelOnTop] = useState(false);      // the thing to press is low on the screen
    const [barBelow, setBarBelow] = useState(false);          // a bar at the bottom the guide would cover
    const [watching, setWatching] = useState<TourStep | null>(null);   // a step's video, open
    const doneBefore = useRef<{ tour: string; ids: Set<string> } | null>(null);
    const scrolledTo = useRef("");

    const setMinimized = (v: boolean) => { setMinimizedState(v); try { localStorage.setItem(MIN_KEY, v ? "1" : "0"); } catch { /* fine */ } };
    const save = useCallback((tourId: string, patch: Partial<TourState>) => {
        setTours(all => ({ ...(all ?? {}), [tourId]: { state: "active", skipped: [], ...(all?.[tourId] ?? {}), ...patch } }));
        apiFetch(`/api/tutorial/${tourId}`, { method: "PUT", body: JSON.stringify(patch) }).catch(() => { /* next time */ });
    }, []);
    const loadChecks = useCallback(() => {
        apiFetch<{ name: string | null; checks: Checks }>("/api/tutorial/checks")
            .then(r => { setChecks(r.checks); setName(r.name); }).catch(() => { /* next time */ });
    }, []);

    useEffect(() => {
        if (!who) return;
        apiFetch<Record<string, TourState>>("/api/tutorial").then(setTours).catch(() => { /* off */ });
        loadChecks();
    }, [who, loadChecks]);

    // a path's steps: those whose checks apply (in the plan, not "not relevant", someone to give a task to…);
    // a step that only shows something is done once seen
    const stepsOf = useCallback((t: TourDef) => t.steps.filter(s => s.confirms.every(id => checks?.[id]?.applies)), [checks]);
    const isDone = useCallback((t: TourDef, s: TourStep) => (s.manual
        ? !!tours?.[t.id]?.skipped.includes(s.id)
        : s.confirms.every(id => checks?.[id]?.done)), [checks, tours]);
    const left = useCallback((t: TourDef) => stepsOf(t).filter(s => !isDone(t, s)), [stepsOf, isDone]);

    const tour = mine.find(t => tours?.[t.id]?.state === "active") ?? null;
    const state = tour ? tours?.[tour.id] : undefined;
    const skipped = state?.skipped ?? [];
    const steps = tour ? stepsOf(tour) : [];
    const pending = tour ? steps.filter(s => !isDone(tour, s) && !skipped.includes(s.id)) : [];
    const current = (focus ? pending.find(s => s.id === focus) : undefined) ?? pending[0] ?? null;
    const onStepPage = !!current && pathname === pathOf(current.href);
    const next = tour?.next ? mine.find(t => t.id === tour.next && tours?.[t.id]?.state !== "done") : undefined;
    const offerNext = next && left(next).length > 0 ? next : undefined;

    // one path open at a time — the one open before is put aside (or, moving on from a finished one, done)
    const start = useCallback((t: TourDef, before: "dismissed" | "done" = "dismissed") => {
        setPicking(false);
        setPraise(null);
        setFocus(null);
        setMinimized(false);
        mine.forEach(o => { if (o.id !== t.id && tours?.[o.id]?.state === "active") save(o.id, { state: before }); });
        save(t.id, { state: "active", skipped: [] });
        setIntro(true);
    }, [mine, tours, save]);

    // a path that opens by itself — once, for someone with its steps to do (not for the superadmin inside a business)
    useEffect(() => {
        if (!tours || !checks || tour) return;
        let impersonating = false;
        try { impersonating = !!sessionStorage.getItem("admin_return"); } catch { /* fine */ }
        if (impersonating) return;
        const fresh = mine.find(t => t.auto && !tours[t.id] && left(t).length > 0);
        if (fresh) start(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tours, checks]);

    // a step that just became done — praise
    useEffect(() => {
        if (!tour || !checks) { doneBefore.current = null; return; }
        const nowDone = new Set(steps.filter(s => !s.manual && isDone(tour, s)).map(s => s.id));
        const before = doneBefore.current?.tour === tour.id ? doneBefore.current.ids : null;
        doneBefore.current = { tour: tour.id, ids: nowDone };
        if (!before) return;
        const fresh = steps.find(s => nowDone.has(s.id) && !before.has(s.id));
        if (fresh) {
            setPraise(fresh);
            setMinimized(false);
            celebrate();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [checks, tour?.id]);

    // checking: on moving between screens, and every few seconds on the step's own screen
    useEffect(() => {
        if (!tour || !current || current.manual) return;
        loadChecks();
        if (!onStepPage) return;
        const t = setInterval(loadChecks, 3000);
        return () => clearInterval(t);
    }, [tour, current, onStepPage, pathname, loadChecks]);

    // the thing to press now — the first move that applies and is on the screen
    useEffect(() => {
        scrolledTo.current = "";
    }, [current]);
    useEffect(() => {
        if (!tour || !current || !onStepPage || minimized || praise || intro) { setShown(null); setPanelOnTop(false); return; }
        const tick = () => {
            let found: { move: TourMove; el: HTMLElement } | null = null;
            for (const move of current.moves) {
                if (move.unless && checks?.[move.unless]?.done) continue;
                const el = onScreen(move.target, move.enabled);
                if (el) { found = { move, el }; break; }
            }
            if (!found) { setShown(null); setPanelOnTop(false); return; }
            if (scrolledTo.current !== found.move.target) {
                scrolledTo.current = found.move.target;
                found.el.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
            }
            const r = found.el.getBoundingClientRect();
            setPanelOnTop(r.bottom > window.innerHeight * 0.55);
            setShown(prev => prev && prev.move === found!.move && Math.abs(prev.rect.top - r.top) < 1 && Math.abs(prev.rect.left - r.left) < 1
                && Math.abs(prev.rect.width - r.width) < 1 && Math.abs(prev.rect.height - r.height) < 1 ? prev : { move: found!.move, rect: r });
        };
        tick();
        const t = setInterval(tick, 300);
        return () => clearInterval(t);
    }, [tour, current, onStepPage, minimized, praise, intro, checks]);

    // the bars at the bottom — on every screen the guide is open on
    useEffect(() => {
        if (!tour || minimized) { setBarBelow(false); return; }
        const check = () => setBarBelow(AVOID.some(name => !!onScreen(name)));
        check();
        const t = setInterval(check, 800);
        return () => clearInterval(t);
    }, [tour, minimized, pathname]);

    const go = useCallback((step: TourStep) => {
        setIntro(false);
        setFocus(step.id);
        if (pathname === pathOf(step.href)) {
            // a settings tab — the page reads it when it opens
            if (hasTab(step.href)) window.location.assign(step.href);
        } else router.push(step.href);
    }, [pathname, router]);

    const api: TourApi = useMemo(() => ({
        available: !!who && mine.length > 0,
        open: () => {
            setMinimized(false);
            if (tour) return;
            if (mine.length === 1) start(mine[0]);
            else setPicking(true);
        },
        startAt: (stepId: string) => {
            const t = mine.find(o => o.steps.some(s => s.id === stepId));
            const step = t?.steps.find(s => s.id === stepId);
            if (!t || !step) return;
            setMinimized(false);
            setPraise(null);
            setPicking(false);
            mine.forEach(o => { if (o.id !== t.id && tours?.[o.id]?.state === "active") save(o.id, { state: "dismissed" }); });
            save(t.id, { state: "active", skipped: (tours?.[t.id]?.skipped ?? []).filter(s => s !== stepId) });
            go(step);
        },
        stepFor: (itemId: string) => (who === "owner" ? OWNER_START.steps.find(s => s.confirms.includes(itemId))?.id ?? null : null),
    }), [who, mine, tour, tours, go, save, start]);

    useEffect(() => {
        if (!(tour || picking) || minimized || watching) return;          // Esc over a video closes the video only
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { if (picking) setPicking(false); else setMinimized(true); } };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [tour, picking, minimized, watching]);

    const close = () => {
        if (picking) { setPicking(false); return; }
        if (tour) save(tour.id, { state: "dismissed" });
        toast.info("אפשר לפתוח את המדריך שוב בכל רגע מהכפתור ? למעלה");
    };
    const skip = (step: TourStep) => { if (!tour) return; setFocus(null); save(tour.id, { skipped: [...skipped, step.id] }); };
    const seen = (step: TourStep) => {                       // a step that only shows something — on to the next
        if (!tour) return;
        skip(step);
        const after = pending.find(s => s.id !== step.id);
        if (after) go(after);
    };
    const afterPraise = () => {
        setPraise(null);
        setFocus(null);
        if (pending[0]) go(pending[0]);
    };

    const showGuide = !!who && !!checks && ((!!tour && steps.length > 0) || picking);
    const finished = !!tour && !picking && !praise && !intro && pending.length === 0;
    const doneCount = tour ? steps.filter(s => isDone(tour, s)).length : 0;
    const index = current ? steps.indexOf(current) : -1;

    let body: React.ReactNode = null;
    let buttons: React.ReactNode = null;
    const primary = "flex-1 min-h-11 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold transition";
    const secondary = "min-h-11 px-4 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 transition";
    if (picking) {
        body = <>
            <p className="font-bold text-slate-900">במה נתחיל?</p>
            <div className="mt-2 space-y-2">
                {mine.map(t => {
                    const all = stepsOf(t);
                    if (all.length === 0) return null;
                    const did = all.filter(s => isDone(t, s)).length;
                    return (
                        <button key={t.id} type="button" onClick={() => start(t)}
                            className="w-full min-h-12 flex items-center gap-3 rounded-2xl border border-slate-200 px-3 py-2 text-right hover:border-sky-300 hover:bg-sky-50 transition">
                            <span className="flex-1 min-w-0">
                                <span className="block font-bold text-slate-800">{t.title}</span>
                                <span className="block text-xs text-slate-500">{all.map(s => s.title).join(" · ")}</span>
                            </span>
                            <span className={`shrink-0 text-xs font-bold tabular-nums ${did === all.length ? "text-emerald-700" : "text-slate-500"}`}>{did}/{all.length}</span>
                            <ChevronLeft className="w-4 h-4 shrink-0 text-slate-400" aria-hidden />
                        </button>
                    );
                })}
            </div>
        </>;
    } else if (intro && tour) {
        const withMoney = steps.some(s => s.later);
        body = <>
            <p className="font-bold text-slate-900">היי{name ? ` ${name}` : ""}!</p>
            <p className="mt-1">
                {tour.welcome}: {steps.map(s => s.title).join(", ")}. {withMoney
                    ? "צעד עם כסף — מכירה או מקדמה — לא עושים בשביל התרגול: אני מראה איך, ובודק אותו במכירה האמיתית הבאה. "
                    : ""}כל צעד לוקח דקה או שתיים, ואני בודק שהוא באמת הצליח.
            </p>
        </>;
        buttons = <>
            <button type="button" className={primary} onClick={() => (pending[0] ? go(pending[0]) : setIntro(false))}>בואו נתחיל</button>
            <button type="button" className={secondary} onClick={() => { setIntro(false); setMinimized(true); }}>לא עכשיו</button>
        </>;
    } else if (praise) {
        body = <p><span className="font-black text-emerald-700">מעולה!</span> {praise.done}</p>;
        buttons = <button type="button" className={primary} onClick={afterPraise}>{pending.length ? "לשלב הבא" : "סיום"}</button>;
    } else if (finished && tour) {
        body = <>
            <p className="font-black text-emerald-700">כל הכבוד, סיימת את &quot;{tour.title}&quot;!</p>
            <p className="mt-1">{offerNext ? `הצעד הבא: "${offerNext.title}" — ${offerNext.steps.map(s => s.title).join(", ")}.` : tour.finish}</p>
        </>;
        buttons = offerNext ? <>
            <button type="button" className={primary} onClick={() => start(offerNext, "done")}>ממשיכים</button>
            <button type="button" className={secondary} onClick={() => save(tour.id, { state: "done" })}>בפעם אחרת</button>
        </> : <button type="button" className={primary} onClick={() => save(tour.id, { state: "done" })}>סגירה</button>;
    } else if (current) {
        const say = onStepPage && shown ? shown.move.say : null;
        body = <>
            <p className="font-bold text-slate-900">{current.title}</p>
            <p className="mt-1">{say ?? current.intro}</p>
            {current.video && (
                <button type="button" onClick={() => setWatching(current)}
                    className="mt-2 inline-flex items-center gap-1.5 text-sm font-bold text-sky-700 hover:text-sky-900">
                    <PlayCircle className="w-4 h-4" aria-hidden /> צפו בסרטון קצר
                </button>
            )}
        </>;
        buttons = current.manual ? <>
            {onStepPage
                ? <button type="button" className={primary} onClick={() => seen(current)}>הבנתי</button>
                : <button type="button" className={primary} onClick={() => go(current)}>קחו אותי לשם</button>}
        </> : <>
            {!say && <button type="button" className={primary} onClick={() => go(current)}>{current.later ? "הראו לי איפה" : "קחו אותי לשם"}</button>}
            <button type="button" className={say ? `${secondary} mr-auto` : secondary} onClick={() => skip(current)}>
                {current.later ? "אעשה את זה בפעם הבאה" : "דילוג על השלב"}
            </button>
        </>;
    }

    const r = shown?.rect;
    return (
        <TourContext.Provider value={api}>
            {children}
            {showGuide && tour && r && !minimized && (
                <div aria-hidden className="fixed z-[1090] pointer-events-none rounded-xl"
                    style={{ top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12,
                             boxShadow: "0 0 0 3px #38bdf8, 0 0 0 9999px rgba(15, 23, 42, 0.38)" }} />
            )}
            {showGuide && tour && minimized && (
                <button type="button" onClick={() => setMinimized(false)} aria-label="פתיחת המדריך"
                    className="fixed z-[1100] right-4 bottom-[calc(140px+env(safe-area-inset-bottom,0px))] md:right-auto md:left-6 md:bottom-6 w-14 h-14 rounded-full bg-sky-600 text-white shadow-xl flex items-center justify-center">
                    <GraduationCap className="w-6 h-6" aria-hidden />
                    <span className="absolute -top-1 -left-1 min-w-6 h-6 px-1 rounded-full bg-white text-sky-700 text-[11px] font-black flex items-center justify-center border border-sky-200">
                        {doneCount}/{steps.length}
                    </span>
                </button>
            )}
            {showGuide && !minimized && body && (
                <div role="dialog" aria-label="המדריך" dir="rtl"
                    className={`fixed z-[1100] inset-x-3 md:inset-x-auto md:left-6 md:w-[380px] bg-white rounded-3xl shadow-2xl border border-slate-200 p-4 ${
                        panelOnTop || barBelow ? "top-[calc(12px+env(safe-area-inset-top,0px))] md:top-6" : "bottom-[calc(76px+env(safe-area-inset-bottom,0px))] md:bottom-6"}`}>
                    <div className="flex items-center gap-3">
                        <span className="w-10 h-10 shrink-0 rounded-full bg-sky-600 text-white flex items-center justify-center">
                            <GraduationCap className="w-5 h-5" aria-hidden />
                        </span>
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-black text-slate-800">המדריך שלך</div>
                            <div className="text-[11px] text-slate-500">
                                {picking || !tour ? "הדרכה צעד אחר צעד"
                                    : finished ? `${tour.title} · הכול הושלם`
                                    : index >= 0 && !intro ? `${tour.title} · שלב ${index + 1} מתוך ${steps.length}`
                                    : `${tour.title} · ${steps.length} צעדים`}
                            </div>
                        </div>
                        {tour && !picking && (
                            <button type="button" onClick={() => setMinimized(true)} aria-label="הקטנת המדריך" className="w-9 h-9 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100">
                                <ChevronDown className="w-5 h-5" aria-hidden />
                            </button>
                        )}
                        <button type="button" onClick={close} aria-label="סגירת ההדרכה" className="w-9 h-9 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100">
                            <X className="w-5 h-5" aria-hidden />
                        </button>
                    </div>
                    <div aria-live="polite" className="mt-3 text-sm text-slate-700 leading-relaxed">{body}</div>
                    {buttons && <div className="mt-3 flex items-center gap-2">{buttons}</div>}
                    {tour && !picking && (
                        <div className="mt-3 flex items-center justify-center gap-1.5" aria-label={`הושלמו ${doneCount} מתוך ${steps.length}`}>
                            {steps.map(s => (
                                <span key={s.id} className={`h-1.5 rounded-full transition-all ${isDone(tour, s) ? "w-6 bg-emerald-500" : s === current ? "w-6 bg-sky-500" : "w-3 bg-slate-200"}`} />
                            ))}
                        </div>
                    )}
                </div>
            )}
            {watching?.video && (
                <VideoModal src={watching.video} poster={posterOf(watching.video)} title={watching.title} onClose={() => setWatching(null)} />
            )}
        </TourContext.Provider>
    );
}
