"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import {
    BarChart3, CalendarCheck, CalendarDays, Check, ChevronLeft, Eye, Images, Link2, MapPin, PhoneCall, Rocket, Star,
    TrendingUp, type LucideIcon,
} from "lucide-react";
import { GLASS_CARD, PRIMARY_BTN } from "@/lib/look";

const FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
    { icon: MapPin,       title: "חשיפה ללקוחות", desc: "הופיעו בחיפוש של אלפי לקוחות שמחפשים עסקים כמו שלכם באזורכם" },
    { icon: CalendarDays, title: "הזמנות אונליין", desc: "לקוחות יכולים לקבוע תור ישירות מהפרופיל שלכם — 24/7" },
    { icon: Star,         title: "ביקורות ודירוג", desc: "בנו אמינות עם ביקורות אמיתיות שמוצגות בפרופיל הציבורי" },
    { icon: BarChart3,    title: "סטטיסטיקות", desc: "ראו כמה אנשים צפו בעמוד שלכם, חייגו ובקשו תורים" },
    { icon: Images,       title: "גלריית תמונות", desc: "העלו תמונות של עבודות, הסביבה וחווית הלקוח" },
    { icon: Link2,        title: "חיבור ל-BizControl", desc: "יש לכם מערכת ניהול? חברו אותה וקבלו את כל הכלים במקום אחד" },
];

const STEPS = [
    { n: "1", title: "צרו פרופיל", desc: "הכניסו את שם העסק, קטגוריה ותמונות" },
    { n: "2", title: "אמתו את הפרטים", desc: "נאמת שאתם הבעלים האמיתיים של העסק" },
    { n: "3", title: "קבלו לקוחות", desc: "הופיעו בחיפוש וקבלו הזמנות תורים" },
];

// The growth picture — an illustration (it says so under it), not anyone's numbers: twelve bars that rise, a line
// that draws itself over them, and a dot that keeps pulsing at the top.
const BARS = [16, 22, 20, 29, 35, 33, 44, 51, 49, 62, 73, 88];
const CW = 640, CH = 260, PT = 24, PB = 6;
const SLOT = CW / BARS.length, BW = 26;
const barTop = (h: number) => CH - PB - (h / 100) * (CH - PT - PB);
const PTS = BARS.map((h, i) => [i * SLOT + SLOT / 2, barTop(h) - 16] as const);
const LINE = (() => {                                     // a smooth line through the points (Catmull-Rom → Bézier)
    let d = `M${PTS[0][0].toFixed(1)},${PTS[0][1].toFixed(1)}`;
    for (let i = 0; i < PTS.length - 1; i++) {
        const p0 = PTS[i - 1] || PTS[i], p1 = PTS[i], p2 = PTS[i + 1], p3 = PTS[i + 2] || p2;
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
        const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
        d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
})();
const AREA = `${LINE} L${PTS[PTS.length - 1][0].toFixed(1)},${CH - PB} L${PTS[0][0].toFixed(1)},${CH - PB} Z`;
const END = PTS[PTS.length - 1];

const METRICS: { icon: LucideIcon; label: string; fill: number }[] = [
    { icon: Eye,           label: "צפיות בעמוד", fill: 0.86 },
    { icon: PhoneCall,     label: "פניות וחיוגים", fill: 0.7 },
    { icon: CalendarCheck, label: "תורים אונליין", fill: 0.78 },
];

// The motion (owner, 2026-11-09: "animations like Apple's site, and a growth animation with a rising graph").
// Everything is visible by default — a part below the screen is hidden ("wait") only once the page runs, and comes in
// ("in") as it's scrolled to. Without motion (the phone's reduce-motion setting) nothing moves.
const MOTION_CSS = `
.bfx-rise { animation: bfx-rise 1s cubic-bezier(.2,.7,.2,1) both; animation-delay: var(--delay, 0ms); }
@keyframes bfx-rise { from { opacity: 0; transform: translateY(28px); filter: blur(6px); } to { opacity: 1; transform: none; filter: none; } }
.bfx-glow { position: absolute; left: 50%; top: -140px; width: min(900px, 140vw); height: 560px; margin-left: calc(min(900px, 140vw) / -2);
  background: radial-gradient(closest-side, rgb(var(--bf-accent-rgb) / .22), transparent 72%); filter: blur(24px);
  animation: bfx-drift 14s ease-in-out infinite alternate; pointer-events: none; }
@keyframes bfx-drift { from { transform: translate3d(-5%, -3%, 0) scale(1); } to { transform: translate3d(5%, 4%, 0) scale(1.12); } }
.bfx-shine { background: linear-gradient(to left, var(--bf-text) 0%, var(--bf-text) 30%, var(--bf-accent) 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent; }

[data-reveal] { transition: opacity 1s cubic-bezier(.2,.7,.2,1), transform 1s cubic-bezier(.2,.7,.2,1); transition-delay: var(--d, 0ms); }
[data-reveal="wait"] { opacity: 0; transform: translateY(48px); }
[data-reveal="wait"].bfx-zoom { transform: scale(.9); }

.bfx-bar { transform-box: fill-box; transform-origin: 50% 100%; }
[data-reveal="wait"] .bfx-bar { transform: scaleY(0); }
[data-reveal="in"] .bfx-bar { animation: bfx-grow 1.1s cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(250ms + var(--i) * 70ms); }
@keyframes bfx-grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
.bfx-line { stroke-dasharray: 1; stroke-dashoffset: 0; }
[data-reveal="wait"] .bfx-line { stroke-dashoffset: 1; }
[data-reveal="in"] .bfx-line { animation: bfx-draw 1.9s cubic-bezier(.65,0,.25,1) 500ms both; }
@keyframes bfx-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
[data-reveal="wait"] .bfx-area, [data-reveal="wait"] .bfx-dot, [data-reveal="wait"] .bfx-chip { opacity: 0; }
[data-reveal="in"] .bfx-area { animation: bfx-fade 1.2s ease 1.4s both; }
.bfx-dot { transform-box: fill-box; transform-origin: center; }
[data-reveal="in"] .bfx-dot { animation: bfx-pop .6s cubic-bezier(.3,1.6,.5,1) 2.2s both; }
.bfx-ring { transform-box: fill-box; transform-origin: center; animation: bfx-ping 2.4s ease-out 2.6s infinite both; }
[data-reveal="wait"] .bfx-ring { animation: none; opacity: 0; }
[data-reveal="in"] .bfx-chip { animation: bfx-pop .6s cubic-bezier(.3,1.6,.5,1) 2.4s both; }
@keyframes bfx-ping { 0% { transform: scale(.5); opacity: .6; } 80%, 100% { transform: scale(2.6); opacity: 0; } }
@keyframes bfx-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes bfx-pop { from { opacity: 0; transform: scale(0); } to { opacity: 1; transform: scale(1); } }

.bfx-meter { transform-origin: 100% 50%; }
[data-reveal="wait"] .bfx-meter { transform: scaleX(0); }
[data-reveal="in"] .bfx-meter { animation: bfx-meter 1.4s cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(350ms + var(--d, 0ms)); }
@keyframes bfx-meter { from { transform: scaleX(0); } to { transform: scaleX(1); } }

.bfx-card { height: 100%; box-sizing: border-box; transition: transform .35s ease, box-shadow .35s ease; }
.bfx-card:hover { transform: translateY(-4px); box-shadow: 0 18px 40px rgb(var(--bf-text-rgb) / .08); }

.bfx-steps { position: relative; }
.bfx-steps[data-reveal] { opacity: 1; transform: none; }
.bfx-steps::before { content: ""; position: absolute; inset-inline-start: 23px; top: 24px; bottom: 24px; width: 2px;
  background: rgb(var(--bf-accent-rgb) / .4); transform-origin: top; transition: transform 1.6s cubic-bezier(.65,0,.25,1) .3s; }
.bfx-steps[data-reveal="wait"]::before { transform: scaleY(0); }

@media (prefers-reduced-motion: reduce) {
  .bfx-rise, .bfx-glow, .bfx-ring, .bfx-bar, .bfx-line, .bfx-area, .bfx-dot, .bfx-chip, .bfx-meter { animation: none !important; }
  [data-reveal], .bfx-steps::before, .bfx-card { transition: none !important; }
}
`;

export default function ForBusinessPage() {
    const root = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const page = root.current;
        if (!page || !("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const io = new IntersectionObserver(entries => {
            for (const e of entries) {
                if (!e.isIntersecting) continue;
                (e.target as HTMLElement).dataset.reveal = "in";
                io.unobserve(e.target);
            }
        }, { threshold: 0.15, rootMargin: "0px 0px -6% 0px" });
        page.querySelectorAll<HTMLElement>("[data-reveal]").forEach(el => {
            if (el.getBoundingClientRect().top < window.innerHeight * 0.9) { el.dataset.reveal = "in"; return; }  // already on the screen
            el.dataset.reveal = "wait";
            io.observe(el);
        });
        return () => io.disconnect();
    }, []);

    const h2: React.CSSProperties = { textAlign: "center", fontSize: "clamp(1.8rem,4.2vw,2.8rem)", fontWeight: 900, letterSpacing: "-0.01em", lineHeight: 1.2, marginBottom: "0.75rem", textWrap: "balance" as never };

    return (
        <div ref={root} dir="rtl" style={{ color: "var(--bf-text)", background: "var(--bf-bg)", overflowX: "clip" }}>
            <style dangerouslySetInnerHTML={{ __html: MOTION_CSS }} />

            {/* Header */}
            <header style={{ background: "rgb(var(--bf-bg-rgb) / .85)", backdropFilter: "blur(14px)", borderBottom: "1px solid var(--bf-line)", padding: "0 1.5rem", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50 }}>
                <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <img src="/logo.png" alt="" style={{ width: 32, height: 32, objectFit: "contain" }} />
                    <span style={{ fontWeight: 800, fontSize: "1.1rem", color: "var(--bf-text)" }}>BizFind</span>
                </Link>
                <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                    <Link href="/studio/login" style={{ color: "var(--bf-muted)", fontWeight: 600, fontSize: "0.9rem", textDecoration: "none" }}>כניסה לעסקים</Link>
                    <Link href="/for-business/register?plan=trial" style={{ background: "var(--bf-accent)", color: "var(--bf-on-accent)", padding: "0.5rem 1.1rem", borderRadius: 10, fontWeight: 700, fontSize: "0.88rem", textDecoration: "none" }}>
                        הצטרפו בחינם
                    </Link>
                </div>
            </header>

            {/* Hero — comes in line after line as the page opens */}
            <section style={{ position: "relative", overflow: "hidden", padding: "6rem 1.5rem 4.5rem", textAlign: "center" }}>
                <div className="bfx-glow" aria-hidden />
                <div style={{ position: "relative", maxWidth: 760, margin: "0 auto" }}>
                    <div className="bfx-rise" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", background: "var(--bf-glass)", color: "var(--bf-text)", fontWeight: 700, fontSize: "0.82rem", padding: "0.35rem 0.9rem", borderRadius: 20, marginBottom: "1.5rem", border: "1px solid var(--bf-line)" }}>
                        <Rocket size={14} aria-hidden /> הפלטפורמה לעסקים של ישראל
                    </div>
                    <h1 style={{ fontSize: "clamp(2.4rem,7vw,4.6rem)", fontWeight: 900, lineHeight: 1.12, letterSpacing: "-0.02em", marginBottom: "1.5rem" }}>
                        <span className="bfx-rise" style={{ display: "block", color: "rgb(var(--bf-text-rgb) / .72)", ["--delay" as string]: "120ms" }}>הגדילו את העסק שלכם.</span>
                        <span className="bfx-rise bfx-shine" style={{ display: "block", ["--delay" as string]: "260ms" }}>לקוחות חדשים כל יום.</span>
                    </h1>
                    <p className="bfx-rise" style={{ fontSize: "clamp(1rem,2.2vw,1.2rem)", color: "var(--bf-muted)", lineHeight: 1.7, marginBottom: "2.25rem", maxWidth: 600, marginInline: "auto", ["--delay" as string]: "420ms" }}>
                        הציגו את העסק שלכם לאלפי לקוחות שמחפשים, קבלו הזמנות תורים אונליין,
                        ונהלו את הפרופיל שלכם בקלות — ללא עלות.
                    </p>
                    <div className="bfx-rise" style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap", ["--delay" as string]: "560ms" }}>
                        <Link href="/for-business/register?plan=trial" style={{ ...PRIMARY_BTN, padding: "0.9rem 2.1rem", fontSize: "1rem" }}>
                            הצטרפו בחינם <ChevronLeft size={18} aria-hidden />
                        </Link>
                        <a href="#how" style={{ display: "flex", alignItems: "center", background: "var(--bf-glass)", color: "var(--bf-text)", padding: "0.9rem 2.1rem", borderRadius: 14, fontWeight: 700, fontSize: "1rem", textDecoration: "none", border: "1px solid var(--bf-line)" }}>
                            איך זה עובד?
                        </a>
                    </div>
                    <p className="bfx-rise" style={{ color: "var(--bf-faint)", fontSize: "0.82rem", marginTop: "1.1rem", display: "flex", gap: "0.9rem", justifyContent: "center", flexWrap: "wrap", ["--delay" as string]: "680ms" }}>
                        {["חינמי לחלוטין", "ללא כרטיס אשראי", "מתחילים תוך דקות"].map(t => (
                            <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}><Check size={13} aria-hidden /> {t}</span>
                        ))}
                    </p>
                </div>
            </section>

            {/* Stats bar */}
            <div style={{ borderTop: "1px solid var(--bf-line)", borderBottom: "1px solid var(--bf-line)", padding: "1.5rem", display: "flex", justifyContent: "center", gap: "3rem", flexWrap: "wrap" }}>
                {[
                    { n: "500+", l: "עסקים בפלטפורמה" },
                    { n: "10K+", l: "חיפושים בחודש" },
                    { n: "∞", l: "צמיחה אפשרית" },
                ].map((s, i) => (
                    <div key={s.l} data-reveal="" style={{ textAlign: "center", ["--d" as string]: `${i * 120}ms` }}>
                        <div style={{ fontSize: "1.8rem", fontWeight: 900 }}>{s.n}</div>
                        <div style={{ fontSize: "0.82rem", color: "var(--bf-muted)" }}>{s.l}</div>
                    </div>
                ))}
            </div>

            {/* Growth — the bars rise and the line draws itself as it comes into view */}
            <section style={{ padding: "6rem 1.5rem 5rem" }}>
                <div style={{ maxWidth: 900, margin: "0 auto" }}>
                    <div data-reveal="">
                        <h2 style={h2}>ככה נראית צמיחה.</h2>
                        <p style={{ textAlign: "center", color: "var(--bf-muted)", marginBottom: "2.75rem", fontSize: "1.05rem", lineHeight: 1.7, maxWidth: 560, marginInline: "auto" }}>
                            יותר אנשים מוצאים אתכם — יותר פניות — יותר תורים. ובעמוד הסטטיסטיקות תראו את זה קורה אצלכם.
                        </p>
                    </div>

                    <div data-reveal="" style={{ ...GLASS_CARD, borderRadius: 28, padding: "clamp(1rem,3vw,2rem)", boxShadow: "0 30px 80px rgb(var(--bf-text-rgb) / .07)" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", marginBottom: "1rem" }}>
                            <div style={{ fontWeight: 800, fontSize: "1rem" }}>העסק שלכם ב-BizFind</div>
                            <span className="bfx-chip" style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", background: "rgb(var(--bf-accent-rgb) / .14)", color: "var(--bf-text)", fontWeight: 800, fontSize: "0.8rem", padding: "0.3rem 0.75rem", borderRadius: 20 }}>
                                <TrendingUp size={15} aria-hidden style={{ color: "var(--bf-accent)" }} /> במגמת עלייה
                            </span>
                        </div>
                        <svg viewBox={`0 0 ${CW} ${CH}`} role="img" aria-label="איור: גרף צמיחה עולה" style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}>
                            <defs>
                                <linearGradient id="bfx-area" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" style={{ stopColor: "var(--bf-accent)", stopOpacity: 0.28 }} />
                                    <stop offset="100%" style={{ stopColor: "var(--bf-accent)", stopOpacity: 0 }} />
                                </linearGradient>
                            </defs>
                            {[0.25, 0.5, 0.75].map(f => (
                                <line key={f} x1={0} x2={CW} y1={PT + (CH - PT - PB) * f} y2={PT + (CH - PT - PB) * f} style={{ stroke: "var(--bf-line)" }} strokeDasharray="4 6" />
                            ))}
                            {BARS.map((h, i) => (
                                <rect key={i} className="bfx-bar" x={i * SLOT + (SLOT - BW) / 2} y={barTop(h)} width={BW} height={CH - PB - barTop(h)} rx={7}
                                      style={{ fill: `rgb(var(--bf-accent-rgb) / ${(0.14 + i * 0.035).toFixed(2)})`, ["--i" as string]: i }} />
                            ))}
                            <path className="bfx-area" d={AREA} fill="url(#bfx-area)" />
                            <path className="bfx-line" d={LINE} pathLength={1} fill="none" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" style={{ stroke: "var(--bf-accent)" }} />
                            <circle className="bfx-ring" cx={END[0]} cy={END[1]} r={8} fill="none" strokeWidth={2} style={{ stroke: "var(--bf-accent)" }} />
                            <circle className="bfx-dot" cx={END[0]} cy={END[1]} r={7} strokeWidth={3} style={{ fill: "var(--bf-accent)", stroke: "var(--bf-bg)" }} />
                        </svg>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: "1rem", marginTop: "1rem" }}>
                        {METRICS.map((m, i) => {
                            const Icon = m.icon;
                            return (
                                <div key={m.label} data-reveal="" style={{ ...GLASS_CARD, padding: "1.1rem 1.25rem", ["--d" as string]: `${i * 120}ms` }}>
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.8rem" }}>
                                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", fontWeight: 800, fontSize: "0.92rem" }}>
                                            <Icon size={17} aria-hidden /> {m.label}
                                        </span>
                                        <TrendingUp size={17} aria-hidden style={{ color: "var(--bf-accent)" }} />
                                    </div>
                                    <div style={{ height: 8, borderRadius: 8, background: "rgb(var(--bf-text-rgb) / .08)", overflow: "hidden" }}>
                                        <div className="bfx-meter" style={{ width: `${m.fill * 100}%`, height: "100%", borderRadius: 8, background: "var(--bf-accent)" }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <p style={{ textAlign: "center", color: "var(--bf-faint)", fontSize: "0.75rem", marginTop: "1rem" }}>האיור להמחשה בלבד</p>
                </div>
            </section>

            {/* Features */}
            <section style={{ padding: "5rem 1.5rem", borderTop: "1px solid var(--bf-line)" }}>
                <div style={{ maxWidth: 960, margin: "0 auto" }}>
                    <div data-reveal="">
                        <h2 style={h2}>כל מה שהעסק שלכם צריך</h2>
                        <p style={{ textAlign: "center", color: "var(--bf-muted)", marginBottom: "3rem", fontSize: "1.05rem" }}>
                            פרופיל מלא, הזמנות, ביקורות וסטטיסטיקות — במקום אחד
                        </p>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: "1.25rem" }}>
                        {FEATURES.map((f, i) => {
                            const Icon = f.icon;
                            return (
                                <div key={f.title} data-reveal="" style={{ ["--d" as string]: `${(i % 3) * 110}ms` }}>
                                    <div className="bfx-card" style={{ ...GLASS_CARD, padding: "1.5rem" }}>
                                        <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--bf-accent)", color: "var(--bf-on-accent)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "0.9rem" }}><Icon size={22} aria-hidden /></div>
                                        <div style={{ fontWeight: 800, fontSize: "1.05rem", marginBottom: "0.4rem" }}>{f.title}</div>
                                        <div style={{ color: "var(--bf-muted)", fontSize: "0.88rem", lineHeight: 1.6 }}>{f.desc}</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* How it works — the steps come in one by one, the line between them draws down */}
            <section id="how" style={{ padding: "5rem 1.5rem", borderTop: "1px solid var(--bf-line)" }}>
                <div style={{ maxWidth: 780, margin: "0 auto" }}>
                    <div data-reveal="">
                        <h2 style={h2}>מתחילים תוך 3 דקות</h2>
                        <p style={{ textAlign: "center", color: "var(--bf-muted)", marginBottom: "3rem", fontSize: "1.05rem" }}>פשוט ומהיר, ללא ביורוקרטיה</p>
                    </div>
                    <div className="bfx-steps" data-reveal="" style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
                        {STEPS.map((s, i) => (
                            <div key={s.n} data-reveal="" style={{ display: "flex", gap: "1.25rem", alignItems: "flex-start", ["--d" as string]: `${i * 220}ms` }}>
                                <div style={{ position: "relative", zIndex: 1, width: 48, height: 48, borderRadius: "50%", background: "var(--bf-accent)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--bf-on-accent)", fontWeight: 900, fontSize: "1.1rem", flexShrink: 0, boxShadow: "0 0 0 6px var(--bf-bg)" }}>
                                    {s.n}
                                </div>
                                <div style={{ paddingTop: "0.6rem" }}>
                                    <div style={{ fontWeight: 800, fontSize: "1.1rem" }}>{s.title}</div>
                                    <div style={{ color: "var(--bf-muted)", fontSize: "0.9rem", marginTop: "0.2rem" }}>{s.desc}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* BizControl upgrade banner — grows into place */}
            <section style={{ padding: "4rem 1.5rem" }}>
                <div className="bfx-zoom" data-reveal="" style={{ ...GLASS_CARD, borderRadius: 28, maxWidth: 760, margin: "0 auto", textAlign: "center", padding: "3rem 1.5rem" }}>
                    <Rocket size={40} strokeWidth={1.5} aria-hidden style={{ marginBottom: "1rem" }} />
                    <h2 style={{ fontSize: "clamp(1.6rem,3.5vw,2.1rem)", fontWeight: 900, marginBottom: "0.75rem" }}>
                        כבר יש לכם BizControl?
                    </h2>
                    <p style={{ color: "var(--bf-muted)", fontSize: "1rem", lineHeight: 1.7, marginBottom: "2rem" }}>
                        חברו את המערכת וקבלו: ניהול יומן מלא, תשלומים, WhatsApp אוטומטי,
                        מועדון לקוחות, AI ועוד — הכל מסונכרן עם הפרופיל הציבורי שלכם.
                    </p>
                    <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
                        <a href="https://www.biz-control.com" target="_blank" rel="noopener" style={{ ...PRIMARY_BTN, padding: "0.85rem 2rem", fontSize: "0.95rem" }}>
                            גלה את BizControl <ChevronLeft size={17} aria-hidden />
                        </a>
                        <Link href="/studio/login" style={{ display: "flex", alignItems: "center", background: "transparent", color: "var(--bf-text)", padding: "0.85rem 2rem", borderRadius: 14, fontWeight: 700, fontSize: "0.95rem", textDecoration: "none", border: "1px solid rgb(var(--bf-text-rgb) / .3)" }}>
                            כניסה עם חשבון קיים
                        </Link>
                    </div>
                </div>
            </section>

            {/* Final CTA */}
            <section style={{ padding: "4rem 1.5rem 6rem", textAlign: "center" }}>
                <div data-reveal="" style={{ maxWidth: 560, margin: "0 auto" }}>
                    <h2 style={{ ...h2, fontSize: "clamp(2rem,5vw,3rem)", marginBottom: "1rem" }}>מוכנים להתחיל?</h2>
                    <p style={{ color: "var(--bf-muted)", marginBottom: "2rem", fontSize: "1.05rem" }}>הצטרפו לעסקים שכבר נמצאים על המפה</p>
                    <Link href="/for-business/register?plan=trial" style={{ ...PRIMARY_BTN, display: "inline-flex", padding: "0.95rem 2.5rem", fontSize: "1.05rem" }}>
                        הצטרפו בחינם <ChevronLeft size={18} aria-hidden />
                    </Link>
                </div>
            </section>

            {/* Footer */}
            <footer style={{ borderTop: "1px solid var(--bf-line)", padding: "2rem 1.5rem", textAlign: "center", color: "var(--bf-faint)", fontSize: "0.82rem" }}>
                <div style={{ marginBottom: "0.5rem", fontWeight: 700, color: "var(--bf-text)" }}>BizFind by BizControl</div>
                <div>© {new Date().getFullYear()} · <a href="https://www.biz-control.com" style={{ color: "var(--bf-muted)", textDecoration: "none" }}>biz-control.com</a></div>
            </footer>
        </div>
    );
}
