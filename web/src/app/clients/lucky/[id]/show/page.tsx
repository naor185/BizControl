"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronRight, Maximize, Minimize, Music2, RotateCcw, Trophy, Volume2, VolumeX } from "lucide-react";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import PlanLock from "@/components/PlanLock";
import Wheel, { WheelHandle } from "@/components/lucky/Wheel";
import Confetti, { ConfettiHandle } from "@/components/lucky/Confetti";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";
import { intl, tx } from "@/lib/i18n";
import { audio, fanfare, Music, tick } from "@/lib/luckySound";
import { Draw, placeLabel, Winner } from "@/lib/luckyClub";

// Lucky Club's draw screen (the owner's spec, 2026-11-04) — for the studio's screen or a TV: full screen, the wheel with
// the names, bulbs, sound, confetti, and the winners revealed one after another — the first place first, then the
// second (the owner, 2026-11-04). The winners are picked on the server the moment the host starts (POST …/run, once);
// the wheel only shows them. Every participant is on the wheel, and a winner leaves it before the next spin. A draw
// already done can be shown again — marked as a replay of the saved result.

type Phase = "ready" | "spinning" | "reveal" | "finished";

function shuffle<T>(xs: T[]): T[] {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

const STAGE_CSS = `
@keyframes lucky-beam { 0% { transform: rotate(-14deg); } 50% { transform: rotate(14deg); } 100% { transform: rotate(-14deg); } }
@keyframes lucky-pop { 0% { transform: scale(.6); opacity: 0; } 60% { transform: scale(1.06); opacity: 1; } 100% { transform: scale(1); } }
@keyframes lucky-glow { 0%,100% { text-shadow: 0 0 18px rgba(251,191,36,.55), 0 0 2px #fff; } 50% { text-shadow: 0 0 42px rgba(251,191,36,.95), 0 0 4px #fff; } }
@keyframes lucky-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.lucky-beam { animation: lucky-beam 9s ease-in-out infinite; transform-origin: top center; }
.lucky-pop { animation: lucky-pop .7s cubic-bezier(.2,.9,.3,1.2) both; }
.lucky-glow { animation: lucky-glow 1.6s ease-in-out infinite; }
.lucky-marquee { animation: lucky-marquee var(--lucky-speed, 60s) linear infinite; }
@media (prefers-reduced-motion: reduce) { .lucky-beam, .lucky-glow, .lucky-marquee { animation: none; } .lucky-pop { animation-duration: .01s; } }
`;

function Stage({ initial }: { initial: Draw }) {
    const [draw, setDraw] = useState(initial);
    const [phase, setPhase] = useState<Phase>("ready");
    const [order, setOrder] = useState<Winner[]>([]);            // the reveal order: the first place first
    const [current, setCurrent] = useState(-1);
    const [revealed, setRevealed] = useState<Winner[]>(initial.status === "done" ? initial.winners : []);
    const [replay, setReplay] = useState(false);
    const [sound, setSound] = useState(true);
    const [music, setMusic] = useState(false);
    const [full, setFull] = useState(false);
    // the signed-in screens render in the browser only (RequireAuth), so this is read once, at the start
    const [reduced] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const people = useMemo(() => draw.participants || [], [draw.participants]);
    // every participant on the wheel, mixed once — the same order on every spin
    const [mixed] = useState(() => shuffle(initial.participants || []));
    const [labels, setLabels] = useState<string[]>(() => mixed.map(p => p.full_name));
    const stage = useRef<HTMLDivElement>(null);
    const wheel = useRef<WheelHandle>(null);
    const confetti = useRef<ConfettiHandle>(null);
    const musicPlayer = useRef<Music | null>(null);
    const soundRef = useRef(sound);
    useEffect(() => { soundRef.current = sound; }, [sound]);

    useEffect(() => {
        const onFs = () => setFull(document.fullscreenElement === stage.current);
        document.addEventListener("fullscreenchange", onFs);
        return () => { document.removeEventListener("fullscreenchange", onFs); musicPlayer.current?.stop(); };
    }, []);

    useEffect(() => {
        if (!musicPlayer.current) musicPlayer.current = new Music();
        if (music) musicPlayer.current.start(); else musicPlayer.current.stop();
    }, [music]);

    const toggleFull = async () => {
        try {
            if (document.fullscreenElement) await document.exitFullscreen();
            else await stage.current?.requestFullscreen();
        } catch { /* the browser refused — the screen stays as it is */ }
    };

    // spin to one winner: every participant but the winners already shown, then the reveal
    const spinFor = useCallback(async (w: Winner, before: Winner[]) => {
        const out = new Set(before.map(b => b.participant_id));
        const names: { id: string; full_name: string }[] = mixed.filter(p => !out.has(p.id));
        if (!names.some(p => p.id === w.participant_id)) names.push({ id: w.participant_id, full_name: w.full_name });
        const index = Math.max(0, names.findIndex(p => p.id === w.participant_id));
        setLabels(names.map(p => p.full_name));
        setPhase("spinning");
        await new Promise(r => setTimeout(r, 80));               // the new names drawn before it turns
        await wheel.current?.spinTo(index);
        setRevealed(prev => [...prev.filter(x => x.id !== w.id), w]);
        setPhase("reveal");
        confetti.current?.burst();
        if (soundRef.current) fanfare();
    }, [mixed]);

    const begin = async () => {
        audio();                                                  // sound is allowed from this click on
        let winners = draw.winners;
        if (draw.status === "locked") {
            setPhase("spinning");
            try {
                const r = await apiFetch<Draw & { already: boolean }>(`/api/lucky-club/draws/${draw.id}/run`, { method: "POST" });
                setDraw(r);
                winners = r.winners;
                if (r.already) toast.info(tx("ההגרלה כבר בוצעה — אלה הזוכים שנבחרו"));
            } catch (e) {
                toast.error((e as Error)?.message || tx("ההגרלה נכשלה"));
                setPhase("ready");
                return;
            }
        } else {
            setReplay(true);
        }
        const seq = [...winners].sort((a, b) => a.place - b.place);
        setOrder(seq);
        setRevealed([]);
        setCurrent(0);
        await spinFor(seq[0], []);
    };

    const next = async () => {
        const i = current + 1;
        if (i >= order.length) { setPhase("finished"); return; }
        setCurrent(i);
        await spinFor(order[i], order.slice(0, i));
    };

    // a keyboard at the TV: space or enter is the main button
    const main = phase === "ready" ? begin : phase === "reveal" ? next : null;
    const mainRef = useRef(main);
    useEffect(() => { mainRef.current = main; });
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.key === " " || e.key === "Enter") && mainRef.current && !(e.target instanceof HTMLButtonElement)) {
                e.preventDefault();
                void mainRef.current();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    const shown = current >= 0 ? order[current] : null;
    const prizes = [...draw.prizes].sort((a, b) => a.place - b.place);
    const byPlace = useMemo(() => Object.fromEntries(revealed.map(w => [w.place, w])), [revealed]);
    const marquee = people.map(p => p.full_name);
    const drawnOn = draw.drawn_at ? new Date(draw.drawn_at).toLocaleString(intl(), { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

    const iconBtn = "flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300";

    return (
        <div ref={stage} className={`relative isolate flex w-full min-w-0 flex-col overflow-hidden text-white ${full ? "h-screen" : "min-h-[calc(100dvh-4rem)]"}`}
            style={{ background: "radial-gradient(1100px 620px at 50% -12%, #5b21b6 0%, transparent 62%), radial-gradient(900px 520px at 105% 110%, #1d4ed8 0%, transparent 60%), radial-gradient(700px 480px at -10% 100%, #be185d 0%, transparent 55%), #0b0820" }}>
            <style>{STAGE_CSS}</style>
            {/* spotlights */}
            <div className="pointer-events-none absolute -top-10 left-[18%] -z-10 h-[120%] w-48 bg-gradient-to-b from-amber-200/25 to-transparent blur-2xl lucky-beam" />
            <div className="pointer-events-none absolute -top-10 right-[18%] -z-10 h-[120%] w-48 bg-gradient-to-b from-fuchsia-200/20 to-transparent blur-2xl lucky-beam" style={{ animationDelay: "-4.5s" }} />
            <Confetti ref={confetti} reducedMotion={reduced} />

            {/* the top: the draw and the controls */}
            <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 sm:px-8">
                <div className="flex min-w-0 items-center gap-3">
                    {!full && (
                        <Link href={`/clients/lucky/${draw.id}`} aria-label={tx("חזרה להגרלה")} className={iconBtn}>
                            <ChevronRight className="h-5 w-5 ltr:-scale-x-100" aria-hidden />
                        </Link>
                    )}
                    {draw.image_url && <img src={draw.image_url} alt="" className="h-12 w-12 rounded-xl object-cover ring-2 ring-amber-300/60" />}
                    <div className="min-w-0">
                        <div className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">Lucky Club</div>
                        <h1 className="truncate text-xl font-black sm:text-3xl">{draw.name}</h1>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setSound(s => !s)} aria-pressed={sound} aria-label={sound ? tx("השתקת הצלילים") : tx("הפעלת הצלילים")} className={iconBtn}>
                        {sound ? <Volume2 className="h-5 w-5" aria-hidden /> : <VolumeX className="h-5 w-5" aria-hidden />}
                    </button>
                    <button type="button" onClick={() => { audio(); setMusic(m => !m); }} aria-pressed={music} aria-label={music ? tx("כיבוי מוזיקה") : tx("הפעלת מוזיקה")}
                        className={`${iconBtn} ${music ? "bg-amber-400/90 text-indigo-950 hover:bg-amber-300" : ""}`}>
                        <Music2 className="h-5 w-5" aria-hidden />
                    </button>
                    <button type="button" onClick={toggleFull} aria-label={full ? tx("יציאה ממסך מלא") : tx("מסך מלא")} className={iconBtn}>
                        {full ? <Minimize className="h-5 w-5" aria-hidden /> : <Maximize className="h-5 w-5" aria-hidden />}
                    </button>
                </div>
            </header>
            {draw.description && <p className="px-5 pt-1 text-sm text-white/70 sm:px-8 sm:text-base">{draw.description}</p>}
            {replay && <p className="mx-5 mt-2 w-fit rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-amber-200 sm:mx-8">{tx("הצגה חוזרת — הזוכים נבחרו ב-{0}", { 0: drawnOn })}</p>}

            {/* the wheel and the prizes */}
            <main className="grid flex-1 items-center gap-6 px-5 py-4 sm:px-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <div className="flex flex-col items-center gap-5">
                    <div className="w-full" style={{ maxWidth: full ? "min(74vh, 900px)" : "min(60vh, 600px)" }}>
                        <Wheel ref={wheel} labels={labels} reducedMotion={reduced} onTick={() => { if (soundRef.current) tick(); }} />
                    </div>
                    {phase === "ready" && (
                        <button type="button" onClick={begin}
                            className="min-h-14 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-10 text-lg font-black text-indigo-950 shadow-[0_0_40px_rgba(251,191,36,0.55)] transition hover:scale-[1.03] focus-visible:outline focus-visible:outline-4 focus-visible:outline-white/60">
                            {draw.status === "locked" ? tx("מתחילים את ההגרלה!") : tx("הצגה חוזרת")}
                        </button>
                    )}
                    {phase === "ready" && draw.status === "done" && !replay && (
                        <p className="text-sm text-white/70">{tx("ההגרלה בוצעה ב-{0} — אפשר להציג שוב את החשיפה.", { 0: drawnOn })}</p>
                    )}
                    {phase === "spinning" && <p className="text-lg font-bold text-amber-200">{tx("מגרילים...")}</p>}
                    {phase === "finished" && draw.status === "done" && !shown && (
                        <button type="button" onClick={() => { setPhase("ready"); }}
                            className="inline-flex min-h-12 items-center gap-2 rounded-full bg-white/10 px-6 font-bold text-white hover:bg-white/20">
                            <RotateCcw className="h-4 w-4" aria-hidden /> {tx("הצגה חוזרת")}
                        </button>
                    )}
                </div>

                <aside className="space-y-3">
                    <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-amber-300">
                        <Trophy className="h-4 w-4" aria-hidden /> {tx("הפרסים")}
                    </h2>
                    <ol className="space-y-2.5">
                        {prizes.map(p => {
                            const w = byPlace[p.place];
                            return (
                                <li key={p.place} className={`rounded-2xl border p-4 backdrop-blur transition ${w ? "border-amber-300/70 bg-amber-300/15" : "border-white/15 bg-white/5"}`}>
                                    <div className="flex items-center gap-3">
                                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-black ${p.place === 1 ? "bg-amber-400 text-indigo-950" : p.place === 2 ? "bg-slate-200 text-indigo-950" : "bg-orange-300 text-indigo-950"}`}>{p.place}</span>
                                        <div className="min-w-0">
                                            <div className="font-bold">{p.title}</div>
                                            <div className={`truncate text-lg font-black ${w ? "text-amber-200" : "text-white/35"}`}>{w ? w.full_name : "?"}</div>
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ol>
                    <p className="text-sm text-white/60">{tx("{0} משתתפים", { 0: draw.participants_count })}</p>
                </aside>
            </main>

            {/* every name, running along the bottom */}
            {marquee.length > 0 && (
                <div className="relative h-10 overflow-hidden border-t border-white/10 bg-black/25" dir="ltr">
                    <div className="lucky-marquee absolute start-0 top-0 flex h-10 w-max items-center gap-8 whitespace-nowrap text-sm font-semibold text-white/70"
                        style={{ "--lucky-speed": `${Math.max(30, marquee.length * 2)}s` } as React.CSSProperties}>
                        {[...marquee, ...marquee].map((n, i) => <span key={i} dir="auto">{n}</span>)}
                    </div>
                </div>
            )}

            {draw.terms && (
                <details className="px-5 pb-3 pt-2 text-xs text-white/60 sm:px-8">
                    <summary className="cursor-pointer font-semibold">{tx("תקנון")}</summary>
                    <p className="mt-1 whitespace-pre-line">{draw.terms}</p>
                </details>
            )}

            {/* the reveal */}
            {phase === "reveal" && shown && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-indigo-950/70 p-6 backdrop-blur-sm" role="dialog" aria-live="assertive" aria-label={tx("הזוכה")}>
                    <div className="lucky-pop w-full max-w-2xl rounded-[2rem] border border-amber-300/60 bg-gradient-to-b from-indigo-900/95 to-violet-950/95 p-8 text-center shadow-[0_0_80px_rgba(251,191,36,0.35)] sm:p-12">
                        <div className="mx-auto mb-4 w-fit rounded-full bg-amber-400 px-4 py-1 text-sm font-black text-indigo-950">{placeLabel(shown.place)}</div>
                        <div className="text-sm font-bold uppercase tracking-[0.3em] text-amber-200">{tx("הזוכה")}</div>
                        <div className="lucky-glow mt-2 break-words text-5xl font-black leading-tight text-amber-100 sm:text-7xl">{shown.full_name}</div>
                        <div className="mt-5 text-lg text-white/80 sm:text-2xl">{tx("הפרס:")} <span className="font-black text-white">{shown.prize_title}</span></div>
                        <button type="button" onClick={next} autoFocus
                            className="mt-8 min-h-12 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-8 text-base font-black text-indigo-950 transition hover:scale-[1.03]">
                            {current + 1 < order.length ? tx("לזוכה הבא") : tx("לסיכום")}
                        </button>
                    </div>
                </div>
            )}

            {/* all the winners */}
            {phase === "finished" && shown && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-indigo-950/75 p-6 backdrop-blur-sm" role="dialog" aria-label={tx("הזוכים")}>
                    <div className="lucky-pop w-full max-w-xl rounded-[2rem] border border-amber-300/60 bg-gradient-to-b from-indigo-900/95 to-violet-950/95 p-8 text-center sm:p-10">
                        <Trophy className="mx-auto h-12 w-12 text-amber-300" aria-hidden />
                        <h2 className="mt-3 text-3xl font-black sm:text-4xl">{tx("מזל טוב לזוכים!")}</h2>
                        <ol className="mt-6 space-y-3 text-start">
                            {[...order].sort((a, b) => a.place - b.place).map(w => (
                                <li key={w.id} className="flex items-center gap-3 rounded-2xl bg-white/10 p-3">
                                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-400 font-black text-indigo-950">{w.place}</span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-lg font-black">{w.full_name}</span>
                                        <span className="block truncate text-sm text-white/70">{w.prize_title}</span>
                                    </span>
                                </li>
                            ))}
                        </ol>
                        <div className="mt-7 flex flex-wrap justify-center gap-3">
                            <button type="button" onClick={() => { setCurrent(-1); setReplay(false); }}
                                className="min-h-11 rounded-full bg-white/10 px-6 font-bold hover:bg-white/20">{tx("סגירה")}</button>
                            {!full && (
                                <Link href={`/clients/lucky/${draw.id}`} className="inline-flex min-h-11 items-center rounded-full bg-amber-400 px-6 font-black text-indigo-950 hover:bg-amber-300">
                                    {tx("לפרטי ההגרלה")}
                                </Link>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function ShowPage() {
    const { id } = useParams<{ id: string }>();
    const [draw, setDraw] = useState<Draw | null>(null);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        apiFetch<Draw>(`/api/lucky-club/draws/${id}`).then(setDraw).catch(e => setErr(e?.message || tx("הטעינה נכשלה")));
    }, [id]);

    const note = (text: string) => (
        <div className="mx-auto max-w-md space-y-4 p-6 text-center">
            <p className="font-bold text-slate-800">{text}</p>
            <Link href={`/clients/lucky/${id}`} className="inline-flex min-h-11 items-center rounded-xl bg-amber-500 px-5 text-sm font-bold text-white hover:bg-amber-600">
                {tx("לפרטי ההגרלה")}
            </Link>
        </div>
    );

    if (err) return note(err);
    if (!draw) return <div className="flex h-60 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-amber-500" /></div>;
    if (draw.status === "draft") return note(tx("ההגרלה עוד לא נעולה — נועלים אותה ואז מגרילים."));
    if (draw.status === "canceled") return note(tx("ההגרלה בוטלה."));
    return <Stage initial={draw} />;
}

export default function LuckyShowPage() {
    return (
        <RequireAuth>
            <AppShell title={tx("Lucky Club")} fullBleed>
                <PlanLock module="lucky_club" feature={tx("Lucky Club — הגרלות ופרסים")}>
                    <ShowPage />
                </PlanLock>
            </AppShell>
        </RequireAuth>
    );
}
