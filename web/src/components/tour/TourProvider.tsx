"use client";

// The guide — "המדריך שלך" (the owner, 2026-10-15): a new business owner learns the first steps inside the system.
// One step at a time (lib/tours): it says what to do, takes you to the screen, highlights the thing to press there, and
// moves on only when the server confirms the step really happened (the setup checklist) — with praise. It can be
// shrunk, skipped step by step, closed, and opened again from the "?" button; its state is kept per user on the server
// (api/tutorial_routes), so the phone, the computer and the app agree. It never blocks the screen: the highlight lets
// every click through. Stage 1: the owner's first path.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, CircleHelp, GraduationCap, PlayCircle, X } from "lucide-react";
import { apiFetch, getCurrentUserRole, type SetupProgress } from "@/lib/api";
import { toast } from "@/lib/toast";
import { OWNER_START, OWNER_START_ID, posterOf, type TourMove, type TourStep } from "@/lib/tours";
import VideoModal from "./VideoModal";

type TourState = { state: "active" | "dismissed" | "done"; skipped: string[] };
type TourApi = { available: boolean; open: () => void; startAt: (stepId: string) => void; stepFor: (itemId: string) => string | null };

const TourContext = createContext<TourApi>({ available: false, open: () => {}, startAt: () => {}, stepFor: () => null });
export const useTour = () => useContext(TourContext);

const MIN_KEY = "bc_tour_minimized";
const AVOID = ["settings-save", "plan-bar"];   // fixed bars at the bottom the guide mustn't cover
const pathOf = (href: string) => href.split("?")[0];
const hasTab = (href: string) => href.includes("tab=");
const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function onScreen(name: string): HTMLElement | null {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return el;
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
    const [isOwner] = useState(() => getCurrentUserRole() === "owner");
    const [tour, setTour] = useState<TourState | null | undefined>(undefined);   // undefined: not known; null: never started
    const [progress, setProgress] = useState<SetupProgress | null>(null);
    const [intro, setIntro] = useState(false);
    const [focus, setFocus] = useState<string | null>(null);
    const [praise, setPraise] = useState<TourStep | null>(null);
    const [minimized, setMinimizedState] = useState(() => { try { return localStorage.getItem(MIN_KEY) === "1"; } catch { return false; } });
    const [shown, setShown] = useState<{ move: TourMove; rect: DOMRect } | null>(null);
    const [panelOnTop, setPanelOnTop] = useState(false);      // the thing to press is low on the screen
    const [barBelow, setBarBelow] = useState(false);          // a bar at the bottom the guide would cover
    const [watching, setWatching] = useState<TourStep | null>(null);   // a step's video, open
    const doneBefore = useRef<Set<string> | null>(null);
    const scrolledTo = useRef("");

    const setMinimized = (v: boolean) => { setMinimizedState(v); try { localStorage.setItem(MIN_KEY, v ? "1" : "0"); } catch { /* fine */ } };
    const save = useCallback((patch: Partial<TourState>) => {
        setTour(t => ({ state: "active", skipped: [], ...(t ?? {}), ...patch }));
        apiFetch(`/api/tutorial/${OWNER_START_ID}`, { method: "PUT", body: JSON.stringify(patch) }).catch(() => { /* next time */ });
    }, []);
    const loadProgress = useCallback(() => {
        apiFetch<SetupProgress>("/api/dashboard/setup-progress").then(setProgress).catch(() => { /* next time */ });
    }, []);

    useEffect(() => {
        if (!isOwner) return;
        apiFetch<Record<string, TourState>>("/api/tutorial").then(all => setTour(all[OWNER_START_ID] ?? null)).catch(() => { /* off */ });
        loadProgress();
    }, [isOwner, loadProgress]);

    const items = useMemo(() => new Map((progress?.items ?? []).map(i => [i.id, i])), [progress]);
    // a step is in the path only when its items are in the checklist (in the plan, not marked "not relevant")
    const steps = useMemo(() => OWNER_START.filter(s => s.confirms.every(id => items.has(id))), [items]);
    const isDone = useCallback((s: TourStep) => s.confirms.every(id => items.get(id)?.done), [items]);
    const skipped = tour?.skipped ?? [];
    const pending = steps.filter(s => !isDone(s) && !skipped.includes(s.id));
    const current = (focus ? pending.find(s => s.id === focus) : undefined) ?? pending[0] ?? null;
    const active = tour?.state === "active";
    const onStepPage = !!current && pathname === pathOf(current.href);

    // a new owner with steps to do — the guide opens by itself, once (not for the superadmin inside a business)
    useEffect(() => {
        if (tour !== null || !progress || !isOwner) return;
        let impersonating = false;
        try { impersonating = !!sessionStorage.getItem("admin_return"); } catch { /* fine */ }
        if (impersonating || !steps.some(s => !isDone(s))) return;
        setIntro(true);
        setMinimized(false);
        save({ state: "active" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tour, progress]);

    // a step that just became done — praise
    useEffect(() => {
        if (!progress) return;
        const nowDone = new Set(steps.filter(isDone).map(s => s.id));
        const before = doneBefore.current;
        doneBefore.current = nowDone;
        if (!before || !active) return;
        const fresh = steps.find(s => nowDone.has(s.id) && !before.has(s.id));
        if (fresh) {
            setPraise(fresh);
            setMinimized(false);
            celebrate();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [progress]);

    // checking: on moving between screens, and every few seconds on the step's own screen
    useEffect(() => {
        if (!active || !current) return;
        loadProgress();
        if (!onStepPage) return;
        const t = setInterval(loadProgress, 3000);
        return () => clearInterval(t);
    }, [active, current, onStepPage, pathname, loadProgress]);

    // the thing to press now — the first move that applies and is on the screen
    useEffect(() => {
        scrolledTo.current = "";
    }, [current]);
    useEffect(() => {
        if (!active || !current || !onStepPage || minimized || praise || intro) { setShown(null); setPanelOnTop(false); return; }
        const tick = () => {
            let found: { move: TourMove; el: HTMLElement } | null = null;
            for (const move of current.moves) {
                if (move.unless && items.get(move.unless)?.done) continue;
                const el = onScreen(move.target);
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
    }, [active, current, onStepPage, minimized, praise, intro, items]);

    // the bars at the bottom — on every screen the guide is open on
    useEffect(() => {
        if (!active || minimized) { setBarBelow(false); return; }
        const check = () => setBarBelow(AVOID.some(name => !!onScreen(name)));
        check();
        const t = setInterval(check, 800);
        return () => clearInterval(t);
    }, [active, minimized, pathname]);

    const go = useCallback((step: TourStep) => {
        setIntro(false);
        setFocus(step.id);
        // a settings tab — the page reads it when it opens
        if (pathname === pathOf(step.href) && hasTab(step.href)) window.location.assign(step.href);
        else router.push(step.href);
    }, [pathname, router]);

    const api: TourApi = useMemo(() => ({
        available: isOwner,
        open: () => {
            setMinimized(false);
            if (tour?.state !== "active") { save({ state: "active", skipped: [] }); setIntro(true); }
        },
        startAt: (stepId: string) => {
            const step = OWNER_START.find(s => s.id === stepId);
            if (!step) return;
            setMinimized(false);
            setPraise(null);
            save({ state: "active", skipped: (tour?.skipped ?? []).filter(s => s !== stepId) });
            go(step);
        },
        stepFor: (itemId: string) => (isOwner ? OWNER_START.find(s => s.confirms.includes(itemId))?.id ?? null : null),
    }), [isOwner, tour, go, save]);

    useEffect(() => {
        if (!active || minimized || watching) return;          // Esc over a video closes the video only
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMinimized(true); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [active, minimized, watching]);

    const close = () => {
        save({ state: "dismissed" });
        toast.info("אפשר לפתוח את המדריך שוב בכל רגע מהכפתור ? למעלה");
    };
    const skip = (step: TourStep) => { setFocus(null); save({ skipped: [...skipped, step.id] }); };
    const afterPraise = () => {
        setPraise(null);
        setFocus(null);
        const next = pending[0];
        if (next) go(next);
    };

    const showGuide = isOwner && active && !!progress && steps.length > 0;
    const finished = showGuide && !praise && !intro && pending.length === 0;
    const doneCount = steps.filter(isDone).length;
    const index = current ? steps.indexOf(current) : -1;
    const name = progress?.owner_first_name;

    let body: React.ReactNode = null;
    let buttons: React.ReactNode = null;
    const primary = "flex-1 min-h-11 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold transition";
    const secondary = "min-h-11 px-4 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 transition";
    if (intro) {
        body = <>
            <p className="font-bold text-slate-900">היי{name ? ` ${name}` : ""}! אני המדריך שלך ב-BizControl.</p>
            <p className="mt-1">נעבור יחד על הצעדים הראשונים: {steps.map(s => s.title).join(", ")}. כל צעד לוקח דקה או שתיים, ואני בודק שהוא באמת הצליח.</p>
        </>;
        buttons = <>
            <button type="button" className={primary} onClick={() => (pending[0] ? go(pending[0]) : setIntro(false))}>בואו נתחיל</button>
            <button type="button" className={secondary} onClick={() => { setIntro(false); setMinimized(true); }}>לא עכשיו</button>
        </>;
    } else if (praise) {
        body = <p><span className="font-black text-emerald-700">מעולה!</span> {praise.done}</p>;
        buttons = <button type="button" className={primary} onClick={afterPraise}>{pending.length ? "לשלב הבא" : "סיום"}</button>;
    } else if (finished) {
        body = <>
            <p className="font-black text-emerald-700">כל הכבוד, סיימת את הצעדים הראשונים!</p>
            <p className="mt-1">עוד צעדים מומלצים מחכים ברשימת &quot;הקמת העסק&quot; במסך הסקירה, ובמרכז העזרה יש מדריך לכל מסך.</p>
        </>;
        buttons = <button type="button" className={primary} onClick={() => save({ state: "done" })}>סגירה</button>;
    } else if (current) {
        const say = onStepPage && shown ? shown.move.say : null;
        body = <>
            <p className="font-bold text-slate-900">{current.title}</p>
            <p className="mt-1">{say ?? current.intro}</p>
            <button type="button" onClick={() => setWatching(current)}
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-bold text-sky-700 hover:text-sky-900">
                <PlayCircle className="w-4 h-4" aria-hidden /> צפו בסרטון קצר
            </button>
        </>;
        buttons = <>
            {!say && <button type="button" className={primary} onClick={() => go(current)}>קחו אותי לשם</button>}
            <button type="button" className={say ? `${secondary} mr-auto` : secondary} onClick={() => skip(current)}>דילוג על השלב</button>
        </>;
    }

    const r = shown?.rect;
    return (
        <TourContext.Provider value={api}>
            {children}
            {showGuide && r && !minimized && (
                <div aria-hidden className="fixed z-[1090] pointer-events-none rounded-xl"
                    style={{ top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12,
                             boxShadow: "0 0 0 3px #38bdf8, 0 0 0 9999px rgba(15, 23, 42, 0.38)" }} />
            )}
            {showGuide && minimized && (
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
                                {finished ? "הכול הושלם" : index >= 0 && !intro ? `שלב ${index + 1} מתוך ${steps.length}` : `${steps.length} צעדים ראשונים`}
                            </div>
                        </div>
                        <button type="button" onClick={() => setMinimized(true)} aria-label="הקטנת המדריך" className="w-9 h-9 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100">
                            <ChevronDown className="w-5 h-5" aria-hidden />
                        </button>
                        <button type="button" onClick={close} aria-label="סגירת ההדרכה" className="w-9 h-9 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100">
                            <X className="w-5 h-5" aria-hidden />
                        </button>
                    </div>
                    <div aria-live="polite" className="mt-3 text-sm text-slate-700 leading-relaxed">{body}</div>
                    <div className="mt-3 flex items-center gap-2">{buttons}</div>
                    <div className="mt-3 flex items-center justify-center gap-1.5" aria-label={`הושלמו ${doneCount} מתוך ${steps.length}`}>
                        {steps.map(s => (
                            <span key={s.id} className={`h-1.5 rounded-full transition-all ${isDone(s) ? "w-6 bg-emerald-500" : s === current ? "w-6 bg-sky-500" : "w-3 bg-slate-200"}`} />
                        ))}
                    </div>
                </div>
            )}
            {watching && (
                <VideoModal src={watching.video} poster={posterOf(watching.video)} title={watching.title} onClose={() => setWatching(null)} />
            )}
        </TourContext.Provider>
    );
}
