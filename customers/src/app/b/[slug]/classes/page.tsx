"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ChevronRight, ChevronLeft, Users, MapPin, UserRound, CalendarCheck, Ticket, Loader2, Hourglass, ArrowLeftRight, PauseCircle, GraduationCap } from "lucide-react";
import { apiFetch, getToken } from "@/lib/api";
import LoginButton from "@/components/LoginButton";
import {
    type Mine, type MineItem, type MyCourse, type MyMembership, type MyWaitItem, type Schedule, type ScheduleItem, type SwapOptions,
    DAY_LONG, dayLabel, fullDate, ilDay, ilTime, shiftDay, weekdayOf, whenText,
} from "@/lib/classes";

// A client's group classes at one business: the week's schedule (how many spots are left — never who is
// booked), booking, "my classes" with cancel and a move to another class, "my membership" with a freeze
// request, and a course — registered for as a whole (its own waitlist too); the payment is at the business. Open to a client of the business with
// a membership that covers the class; the server decides everything and says why when it says no.

type Tab = "schedule" | "mine";
type Confirm = { kind: "book"; item: ScheduleItem; forId?: string | null } | { kind: "course"; item: ScheduleItem }
    | { kind: "cancel"; id: string; name: string; startsAt: string; late: boolean };

const card = { background: "var(--bf-glass)", border: "1px solid var(--bf-line)", borderRadius: 16 } as const;
const muted = "rgba(255,255,255,.68)";
const STATUS_TEXT: Record<string, string> = {
    booked: "רשום/ה", attended: "הגעת", no_show: "לא הגעת", late_canceled: "ביטול מאוחר",
};

export default function ClassesPage() {
    const { slug } = useParams() as { slug: string };
    const primary = "#ffffff";          // the main action — BizFind is black and white (app/layout.tsx --bf-*)
    const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
    const [tab, setTab] = useState<Tab>("schedule");
    const [week, setWeek] = useState<string | null>(null);
    const [data, setData] = useState<Schedule | null>(null);
    const [mine, setMine] = useState<Mine | null>(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
    const [confirm, setConfirm] = useState<Confirm | null>(null);
    const [busy, setBusy] = useState(false);
    const [moving, setMoving] = useState<{ b: MineItem; options: SwapOptions | null } | null>(null);
    const [freezing, setFreezing] = useState<MyMembership | null>(null);

    useEffect(() => { setLoggedIn(!!getToken()); }, []);

    const load = useCallback(() => {
        if (!loggedIn) return;
        apiFetch<Schedule>(`/api/marketplace/classes/${slug}/schedule${week ? `?week=${week}` : ""}`)
            .then(d => { setData(d); setError(""); })
            .catch(e => setError(e instanceof Error ? e.message : "שגיאה בטעינה"));
        apiFetch<Mine>(`/api/marketplace/classes/${slug}/mine`).then(setMine).catch(() => {});
    }, [slug, week, loggedIn]);
    useEffect(() => { load(); }, [load]);

    const act = async () => {
        if (!confirm) return;
        setBusy(true);
        try {
            if (confirm.kind === "book") {
                const r = await apiFetch<{ message: string }>(`/api/marketplace/classes/${slug}/sessions/${confirm.item.id}/book`,
                    { method: "POST", body: JSON.stringify({ for_client_id: confirm.forId ?? null }) });
                setNotice({ text: r.message, ok: true });
            } else if (confirm.kind === "course") {
                const r = await apiFetch<{ message: string }>(`/api/marketplace/classes/${slug}/courses/${confirm.item.course!.template_id}/enroll`, { method: "POST" });
                setNotice({ text: r.message, ok: true });
            } else {
                const r = await apiFetch<{ late: boolean }>(`/api/marketplace/classes/${slug}/bookings/${confirm.id}/cancel`, { method: "POST" });
                setNotice({ text: r.late ? "ההרשמה בוטלה (ביטול מאוחר — לפי מדיניות העסק)." : "ההרשמה בוטלה.", ok: true });
            }
            setConfirm(null);
            load();
        } catch (e) {
            setNotice({ text: e instanceof Error ? e.message : "הפעולה נכשלה", ok: false });
            setConfirm(null);
        } finally {
            setBusy(false);
        }
    };

    const waitAction = async (path: string, ok: string) => {
        setBusy(true);
        try {
            const r = await apiFetch<{ message?: string }>(`/api/marketplace/classes/${slug}/${path}`, { method: "POST" });
            setNotice({ text: r.message || ok, ok: true });
            load();
        } catch (e) {
            setNotice({ text: e instanceof Error ? e.message : "הפעולה נכשלה", ok: false });
        } finally {
            setBusy(false);
        }
    };

    const openMove = (b: MineItem) => {
        setMoving({ b, options: null });
        apiFetch<SwapOptions>(`/api/marketplace/classes/${slug}/bookings/${b.id}/swap-options`)
            .then(options => setMoving(m => (m && m.b.id === b.id ? { b, options } : m)))
            .catch(e => { setMoving(null); setNotice({ text: e instanceof Error ? e.message : "הטעינה נכשלה", ok: false }); });
    };

    const moveTo = async (sessionId: string) => {
        if (!moving) return;
        setBusy(true);
        try {
            const r = await apiFetch<{ message: string }>(`/api/marketplace/classes/${slug}/bookings/${moving.b.id}/swap`,
                { method: "POST", body: JSON.stringify({ session_id: sessionId }) });
            setNotice({ text: r.message, ok: true });
            setMoving(null);
            load();
        } catch (e) {
            setNotice({ text: e instanceof Error ? e.message : "ההעברה נכשלה", ok: false });
            setMoving(null);
        } finally {
            setBusy(false);
        }
    };

    const askFreeze = async (m: MyMembership, body: { from_on: string; until_on: string; note: string }) => {
        setBusy(true);
        try {
            const r = await apiFetch<{ message: string }>(`/api/marketplace/classes/${slug}/memberships/${m.id}/freeze-request`,
                { method: "POST", body: JSON.stringify({ ...body, note: body.note.trim() || null }) });
            setNotice({ text: r.message, ok: true });
            setFreezing(null);
            load();
        } catch (e) {
            setNotice({ text: e instanceof Error ? e.message : "הבקשה לא נשלחה", ok: false });   // the sheet stays — fix and send again
        } finally {
            setBusy(false);
        }
    };

    const shell = (children: React.ReactNode) => (
        <div dir="rtl" style={{ minHeight: "100vh", background: "var(--bf-bg)", color: "var(--bf-text)", padding: "1.25rem 1rem 6rem" }}>
            <div style={{ maxWidth: 720, margin: "0 auto" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1.25rem" }}>
                    <Link href={`/b/${slug}`} aria-label="חזרה לעמוד העסק" style={{ color: muted, display: "flex", padding: 8, margin: -8 }}>
                        <ChevronRight size={22} />
                    </Link>
                    <h1 style={{ fontSize: "1.2rem", fontWeight: 800, margin: 0 }}>שיעורים{data ? ` · ${data.studio.name}` : ""}</h1>
                </div>
                {children}
            </div>
        </div>
    );

    if (loggedIn === null) return shell(null);
    if (!loggedIn) {
        return shell(
            <div style={{ ...card, padding: "1.5rem", textAlign: "center" }}>
                <CalendarCheck size={32} color={primary} style={{ margin: "0 auto 0.75rem" }} />
                <p style={{ fontWeight: 700, margin: "0 0 0.4rem" }}>הרשמה לשיעורים</p>
                <p style={{ color: muted, fontSize: "0.88rem", margin: "0 0 1rem" }}>התחברו עם מספר הטלפון שלכם כדי לראות את הלוח ולהירשם.</p>
                <LoginButton onDone={() => setLoggedIn(true)} />
            </div>
        );
    }
    if (error) return shell(<div style={{ ...card, padding: "1.5rem", textAlign: "center", color: "#fca5a5" }}>{error}</div>);
    if (!data) return shell(<div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}><Loader2 className="spin" size={28} color={primary} /></div>);

    const days = Array.from({ length: 7 }, (_, i) => shiftDay(data.week, i)).filter(d => data.sessions.some(s => ilDay(s.starts_at) === d));

    return shell(
        <>
            <Memberships list={data.memberships} isClient={data.is_client} primary={primary} studio={data.studio.name} busy={busy}
                openCourse={data.sessions.some(x => x.course?.can_enroll && !x.course.covered_by_membership)}
                onAsk={m => setFreezing(m)}
                onWithdraw={id => waitAction(`freeze-requests/${id}/withdraw`, "הבקשה בוטלה")} />
            {freezing && <FreezeSheet m={freezing} primary={primary} busy={busy} onClose={() => setFreezing(null)} onSend={b => askFreeze(freezing, b)} />}

            {notice && (
                <div role="status" style={{ ...card, padding: "0.75rem 1rem", marginBottom: "1rem", borderColor: notice.ok ? "rgba(74,222,128,.35)" : "rgba(248,113,113,.35)",
                    color: notice.ok ? "#bbf7d0" : "#fecaca", display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                    <span>{notice.text}</span>
                    <button type="button" onClick={() => setNotice(null)} aria-label="סגירה" style={{ background: "none", border: "none", color: "inherit", cursor: "pointer" }}>✕</button>
                </div>
            )}

            <div role="tablist" style={{ display: "flex", gap: "0.4rem", marginBottom: "1rem" }}>
                {([["schedule", "לוח השבוע"], ["mine", "השיעורים שלי"]] as const).map(([id, label]) => (
                    <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                        style={{ flex: 1, minHeight: 44, borderRadius: 12, border: "1px solid", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer",
                            background: tab === id ? primary : "transparent", borderColor: tab === id ? primary : "rgba(255,255,255,.12)",
                            color: tab === id ? "#000" : "var(--bf-muted)" }}>
                        {label}{id === "mine" && mine && mine.upcoming.length > 0 ? ` (${mine.upcoming.length})` : ""}
                    </button>
                ))}
            </div>

            {tab === "schedule" ? (
                <>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.9rem" }}>
                        <button type="button" onClick={() => setWeek(shiftDay(data.week, -7))} aria-label="השבוע הקודם"
                            style={{ width: 44, height: 44, borderRadius: 12, border: "1px solid rgba(255,255,255,.12)", background: "transparent", color: "var(--bf-text)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <ChevronRight size={20} />
                        </button>
                        <span dir="ltr" style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{dayLabel(data.week)} – {dayLabel(shiftDay(data.week, 6))}</span>
                        <button type="button" onClick={() => setWeek(shiftDay(data.week, 7))} aria-label="השבוע הבא"
                            style={{ width: 44, height: 44, borderRadius: 12, border: "1px solid rgba(255,255,255,.12)", background: "transparent", color: "var(--bf-text)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <ChevronLeft size={20} />
                        </button>
                    </div>
                    {days.length === 0 && <p style={{ ...card, padding: "1.5rem", textAlign: "center", color: muted, margin: 0 }}>אין שיעורים בשבוע הזה.</p>}
                    {days.map(day => (
                        <section key={day} style={{ marginBottom: "1.1rem" }}>
                            <h2 style={{ fontSize: "0.85rem", color: muted, fontWeight: 700, margin: "0 0 0.5rem" }}>
                                יום {DAY_LONG[weekdayOf(day)]} <span style={{ fontVariantNumeric: "tabular-nums" }}>{dayLabel(day)}</span>
                            </h2>
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
                                {data.sessions.filter(s => ilDay(s.starts_at) === day).map(s => (
                                    <SessionCard key={s.id} s={s} primary={primary} busy={busy}
                                        onEnrollCourse={() => setConfirm({ kind: "course", item: s })}
                                        onCourseAction={path => waitAction(path, "בוצע")}
                                        onWait={() => waitAction(`sessions/${s.id}/waitlist`, "נכנסת לרשימת ההמתנה")}
                                        onLeave={id => waitAction(`waitlist/${id}/leave`, "יצאת מרשימת ההמתנה")}
                                        onTake={id => waitAction(`waitlist/${id}/confirm`, "נרשמת!")}
                                        onBook={() => setConfirm({ kind: "book", item: s, forId: s.can_book ? null : s.book_for.find(p => p.can_book)?.client_id ?? null })}
                                        onCancel={() => s.my_booking && setConfirm({ kind: "cancel", id: s.my_booking.id, name: s.name, startsAt: s.starts_at, late: s.late_if_cancel_now })} />
                                ))}
                            </div>
                        </section>
                    ))}
                </>
            ) : (
                <MyClasses mine={mine} primary={primary} busy={busy}
                    onCourseAction={path => waitAction(path, "בוצע")}
                    onLeave={id => waitAction(`waitlist/${id}/leave`, "יצאת מרשימת ההמתנה")}
                    onTake={id => waitAction(`waitlist/${id}/confirm`, "נרשמת!")}
                    onMove={openMove}
                    onCancel={(b: MineItem) => setConfirm({ kind: "cancel", id: b.id, name: b.name, startsAt: b.starts_at, late: !!b.late_if_cancel_now })} />
            )}

            {moving && (
                <div role="dialog" aria-modal="true" aria-label="העברה לשיעור אחר" onClick={e => e.target === e.currentTarget && !busy && setMoving(null)}
                    style={{ position: "fixed", inset: 0, zIndex: 200 /* above the app's bottom nav (100) */, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                    <div style={{ background: "#0c0c0c", border: "1px solid var(--bf-line)", borderBottom: "none", width: "100%", maxWidth: 520, maxHeight: "85vh", display: "flex", flexDirection: "column", borderRadius: "20px 20px 0 0", padding: "1.25rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom))" }}>
                        <p style={{ fontWeight: 800, fontSize: "1.05rem", margin: "0 0 0.3rem" }}>העברה לשיעור אחר</p>
                        <p style={{ color: muted, fontSize: "0.85rem", margin: "0 0 0.9rem", lineHeight: 1.6 }}>
                            במקום {moving.b.name} · {whenText(moving.b.starts_at)}. בלי חיוב — הכניסה עוברת לשיעור החדש.
                        </p>
                        <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.45rem", marginBottom: "0.9rem" }}>
                            {!moving.options ? (
                                <div style={{ display: "flex", justifyContent: "center", padding: "1.5rem" }}><Loader2 className="spin" size={24} color={primary} /></div>
                            ) : !moving.options.allowed ? (
                                <p style={{ color: "#fcd34d", margin: 0 }}>{moving.options.reason}</p>
                            ) : moving.options.sessions.length === 0 ? (
                                <p style={{ color: muted, margin: 0 }}>אין שיעורים בשבועיים הקרובים.</p>
                            ) : moving.options.sessions.map(o => (
                                <button key={o.id} type="button" disabled={busy || !o.can_swap} onClick={() => moveTo(o.id)}
                                    style={{ ...card, display: "flex", alignItems: "center", gap: "0.7rem", padding: "0.75rem 0.9rem", textAlign: "right",
                                        color: o.can_swap ? "var(--bf-text)" : "var(--bf-faint)", cursor: o.can_swap ? "pointer" : "not-allowed", minHeight: 52 }}>
                                    <span style={{ flex: 1, minWidth: 0 }}>
                                        <span style={{ display: "block", fontWeight: 700 }}>{o.name}</span>
                                        <span style={{ display: "block", fontSize: "0.8rem", color: muted, marginTop: 2 }}>{whenText(o.starts_at)}</span>
                                    </span>
                                    <span style={{ fontSize: "0.75rem", fontWeight: 700, color: o.can_swap ? "#86efac" : "var(--bf-faint)", flexShrink: 0 }}>
                                        {o.can_swap ? `${o.spots_left} מקומות` : o.why_not}
                                    </span>
                                </button>
                            ))}
                        </div>
                        <button type="button" disabled={busy} onClick={() => setMoving(null)}
                            style={{ minHeight: 48, borderRadius: 14, border: "1px solid rgba(255,255,255,.15)", background: "transparent", color: "var(--bf-text)", cursor: "pointer" }}>
                            {busy ? "רגע…" : "חזרה"}
                        </button>
                    </div>
                </div>
            )}

            {confirm && (
                <div role="dialog" aria-modal="true" onClick={e => e.target === e.currentTarget && !busy && setConfirm(null)}
                    style={{ position: "fixed", inset: 0, zIndex: 200 /* above the app's bottom nav (100) */, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                    <div style={{ background: "#0c0c0c", border: "1px solid var(--bf-line)", borderBottom: "none", width: "100%", maxWidth: 520, borderRadius: "20px 20px 0 0", padding: "1.25rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom))" }}>
                        {confirm.kind === "course" ? (confirm.item.course && (
                            <>
                                <p style={{ fontWeight: 800, fontSize: "1.05rem", margin: "0 0 0.3rem" }}>הרשמה ל{confirm.item.course.name}</p>
                                <p style={{ color: "var(--bf-muted)", margin: "0 0 0.8rem" }}>
                                    קורס · {confirm.item.course.sessions_left} מפגשים — כל המפגשים שנשארו בו
                                </p>
                                <p style={{ color: muted, fontSize: "0.85rem", margin: "0 0 1.1rem", lineHeight: 1.6 }}>
                                    {confirm.item.course.covered_by_membership ? "במסגרת המנוי — כל מפגש מנצל כניסה." : confirm.item.course.price_cents
                                        ? `המחיר: ₪${(confirm.item.course.price_cents / 100).toLocaleString("he-IL")} לכל הקורס — התשלום בעסק.` : "התשלום בעסק."}
                                    {" "}אפשר לבטל מפגש בודד בלי חיוב; ביטול ההרשמה לכל הקורס — דרך העסק.
                                </p>
                            </>
                        )) : confirm.kind === "book" ? (
                            <>
                                <p style={{ fontWeight: 800, fontSize: "1.05rem", margin: "0 0 0.3rem" }}>הרשמה ל{confirm.item.name}</p>
                                <p style={{ color: "var(--bf-muted)", margin: "0 0 0.8rem" }}>{whenText(confirm.item.starts_at)}</p>
                                {confirm.item.book_for.some(p => p.can_book) && (
                                    <div role="radiogroup" aria-label="למי ההרשמה" style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", margin: "0 0 0.9rem" }}>
                                        {[...(confirm.item.can_book ? [{ client_id: null as string | null, name: "לי" }] : []),
                                          ...confirm.item.book_for.filter(p => p.can_book)].map(p => {
                                            const on = (confirm.forId ?? null) === p.client_id;
                                            return (
                                                <button key={p.client_id ?? "me"} type="button" role="radio" aria-checked={on}
                                                    onClick={() => setConfirm({ ...confirm, forId: p.client_id })}
                                                    style={{ minHeight: 40, padding: "0 0.9rem", borderRadius: 999, fontWeight: 700, fontSize: "0.85rem", cursor: "pointer",
                                                        border: `1px solid ${on ? primary : "rgba(255,255,255,.15)"}`, background: on ? `${primary}33` : "transparent", color: "var(--bf-text)" }}>
                                                    {p.name}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                                <p style={{ color: muted, fontSize: "0.85rem", margin: "0 0 1.1rem", lineHeight: 1.6 }}>
                                    ביטול בחינם עד {whenText(confirm.item.free_cancel_until)}. אחרי זה — לפי מדיניות הביטולים של {data.studio.name}.
                                </p>
                            </>
                        ) : (
                            <>
                                <p style={{ fontWeight: 800, fontSize: "1.05rem", margin: "0 0 0.3rem" }}>ביטול ההרשמה ל{confirm.name}</p>
                                <p style={{ color: "var(--bf-muted)", margin: "0 0 0.8rem" }}>{whenText(confirm.startsAt)}</p>
                                {confirm.late && (
                                    <p style={{ color: "#fcd34d", fontSize: "0.85rem", margin: "0 0 1.1rem", lineHeight: 1.6 }}>
                                        זה כבר ביטול מאוחר — לפי מדיניות העסק ייתכן שהכניסה תנוצל או שיירשם חיוב.
                                    </p>
                                )}
                            </>
                        )}
                        <div style={{ display: "flex", gap: "0.6rem" }}>
                            <button type="button" disabled={busy} onClick={act}
                                style={{ flex: 1, minHeight: 48, borderRadius: 14, border: "none", fontWeight: 800, fontSize: "0.95rem", cursor: "pointer", color: confirm.kind === "cancel" ? "#fff" : "#000",
                                    background: confirm.kind === "cancel" ? "#dc2626" : primary, opacity: busy ? 0.6 : 1 }}>
                                {busy ? "רגע…" : confirm.kind === "cancel" ? "לבטל את ההרשמה" : confirm.kind === "course" ? "הרשמה לכל הקורס" : "אישור ההרשמה"}
                            </button>
                            <button type="button" disabled={busy} onClick={() => setConfirm(null)}
                                style={{ minHeight: 48, padding: "0 1.1rem", borderRadius: 14, border: "1px solid rgba(255,255,255,.15)", background: "transparent", color: "var(--bf-text)", cursor: "pointer" }}>
                                חזרה
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <style>{`.spin{animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </>
    );
}

function Memberships({ list, isClient, primary, studio, busy, openCourse, onAsk, onWithdraw }: {
    list: MyMembership[]; isClient: boolean; primary: string; studio: string; busy: boolean; openCourse: boolean;
    onAsk: (m: MyMembership) => void; onWithdraw: (requestId: string) => void;
}) {
    if (!isClient || list.length === 0) {
        return (
            <div style={{ ...card, padding: "1rem", marginBottom: "1rem", display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                <Ticket size={22} color={muted} style={{ flexShrink: 0, marginTop: 2 }} />
                <p style={{ margin: 0, color: "var(--bf-muted)", fontSize: "0.88rem", lineHeight: 1.6 }}>
                    {isClient ? `אין לך מנוי פעיל ב${studio}.${openCourse ? " לקורס אפשר להירשם כאן בלי מנוי; לשיעורים הקבועים" : " כדי להירשם לשיעורים"} — פנו לעסק לרכישת מנוי.`
                        : `ההרשמה לשיעורים פתוחה ללקוחות ${studio} עם מנוי. כבר לקוח/ה? ודאו שמספר הטלפון שלכם בעסק זהה לזה שהתחברתם איתו.`}
                </p>
            </div>
        );
    }
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1rem" }}>
            {list.map(m => (
                <div key={m.id} style={{ ...card, padding: "0.9rem 1rem", borderColor: `${primary}55` }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
                    <Ticket size={22} color={primary} style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800 }}>{m.family && !m.family.holder ? "המנוי המשפחתי" : "המנוי שלי"} · {m.name}</div>
                        {m.family && (
                            <div style={{ color: "var(--bf-muted)", fontSize: "0.78rem", marginTop: 2 }}>
                                {m.family.holder ? `משפחתי · עם ${m.family.others.join(", ")}` : `במנוי של ${m.family.holder_name}`}
                                {!m.family.holder && m.family.booking_by === "holder" ? ` · ההרשמות דרך ${m.family.holder_name}` : ""}
                            </div>
                        )}
                        <div style={{ color: muted, fontSize: "0.8rem", marginTop: 2 }}>
                            {m.status === "frozen" && m.freeze_until ? `מוקפא · חוזר לפעילות ב-${fullDate(m.freeze_until)}`
                                : m.status === "pending" ? `מתחיל ב-${fullDate(m.starts_on)}` : m.ends_on ? `בתוקף עד ${fullDate(m.ends_on)}` : "ללא תאריך סיום"}
                            {m.status === "ending" ? " · לא יתחדש" : ""}
                        </div>
                    </div>
                    {m.kind === "punch" && m.entries_left !== null && (
                        <div style={{ textAlign: "center" }}>
                            <div style={{ fontWeight: 800, fontSize: "1.3rem", color: primary, fontVariantNumeric: "tabular-nums" }}>{m.entries_left}</div>
                            <div style={{ fontSize: "0.7rem", color: muted }}>כניסות</div>
                        </div>
                    )}
                    {m.kind === "weekly" && <div style={{ fontSize: "0.8rem", color: "var(--bf-muted)" }}>{m.weekly_limit} בשבוע</div>}
                </div>
                {m.freeze && (m.freeze.request ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginTop: "0.7rem", paddingTop: "0.7rem", borderTop: "1px solid rgba(255,255,255,.06)" }}>
                        <span style={{ flex: 1, fontSize: "0.82rem", color: "var(--bf-muted)" }}>
                            בקשת הקפאה נשלחה: מ-{fullDate(m.freeze.request.from_on)} עד {fullDate(m.freeze.request.until_on)} · מחכה לתשובה
                        </span>
                        <button type="button" disabled={busy} onClick={() => onWithdraw(m.freeze!.request!.id)}
                            style={{ minHeight: 36, padding: "0 0.7rem", borderRadius: 10, border: "1px solid rgba(255,255,255,.15)", background: "transparent", color: "var(--bf-muted)", cursor: "pointer", fontSize: "0.8rem" }}>
                            ביטול הבקשה
                        </button>
                    </div>
                ) : m.freeze.can_ask ? (
                    <button type="button" onClick={() => onAsk(m)}
                        style={{ marginTop: "0.7rem", minHeight: 38, padding: "0 0.8rem", borderRadius: 10, border: "1px solid rgba(255,255,255,.15)", background: "transparent", color: "var(--bf-text)", cursor: "pointer", fontSize: "0.85rem", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <PauseCircle size={16} aria-hidden /> בקשת הקפאה
                    </button>
                ) : m.freeze.why_not ? (
                    <p style={{ margin: "0.6rem 0 0", fontSize: "0.78rem", color: muted }}>{m.freeze.why_not}</p>
                ) : null)}
                </div>
            ))}
        </div>
    );
}

function SessionCard({ s, primary, busy, onBook, onCancel, onWait, onLeave, onTake, onEnrollCourse, onCourseAction }: {
    s: ScheduleItem; primary: string; busy: boolean; onBook: () => void; onCancel: () => void;
    onWait: () => void; onLeave: (id: string) => void; onTake: (id: string) => void;
    onEnrollCourse: () => void; onCourseAction: (path: string) => void;
}) {
    const booked = s.my_booking?.status === "booked";
    const wait = s.waitlist?.mine;
    return (
        <div style={{ ...card, padding: "0.85rem 1rem", ...(booked ? { borderColor: `${primary}88` } : {}) }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
                    <span dir="ltr" style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{ilTime(s.starts_at)}–{ilTime(s.ends_at)}</span>
                    <span style={{ fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span aria-hidden style={{ width: 8, height: 8, borderRadius: 8, background: s.color }} />{s.name}
                    </span>
                </div>
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", color: muted, fontSize: "0.78rem", marginTop: 4 }}>
                    {s.instructor_name && <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><UserRound size={13} />{s.instructor_name}</span>}
                    {s.room_name && <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><MapPin size={13} />{s.room_name}</span>}
                    <span style={{ display: "inline-flex", gap: 4, alignItems: "center", color: s.spots_left === 0 ? "#fca5a5" : muted }}>
                        <Users size={13} />{s.spots_left === 0 ? "מלא" : s.spots_left === 1 ? "נשאר מקום אחד" : s.spots_left <= 3 ? `נשארו ${s.spots_left} מקומות` : `${s.spots_left} מקומות פנויים`}
                    </span>
                </div>
                {!s.can_book && !s.my_booking && !wait && !s.waitlist?.can_join && s.why_not && !(s.course && !s.course.single_ok) && <div style={{ color: "var(--bf-muted)", fontSize: "0.76rem", marginTop: 4 }}>{s.why_not}</div>}
                {s.book_for.some(p => p.booked) && (
                    <div style={{ color: "#86efac", fontSize: "0.76rem", marginTop: 4 }}>רשומים מהמשפחה: {s.book_for.filter(p => p.booked).map(p => p.name).join(", ")}</div>
                )}
                {wait?.status === "waiting" && (
                    <div style={{ color: "#fcd34d", fontSize: "0.78rem", marginTop: 4, display: "inline-flex", gap: 4, alignItems: "center" }}>
                        <Hourglass size={13} />ברשימת ההמתנה · מקום {wait.position}
                    </div>
                )}
                {wait?.status === "notified" && wait.offer_expires_at && (
                    <div style={{ color: "#86efac", fontSize: "0.8rem", fontWeight: 700, marginTop: 4 }}>
                        התפנה מקום! שמור לך עד <span dir="ltr">{ilTime(wait.offer_expires_at)}</span>
                    </div>
                )}
            </div>
            {booked ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "#86efac" }}>רשום/ה</span>
                    <button type="button" onClick={onCancel}
                        style={{ minHeight: 36, padding: "0 0.8rem", borderRadius: 10, border: "1px solid rgba(248,113,113,.4)", background: "transparent", color: "#fca5a5", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" }}>
                        ביטול
                    </button>
                </div>
            ) : s.my_booking ? (
                <span style={{ fontSize: "0.75rem", color: muted }}>{STATUS_TEXT[s.my_booking.status]}</span>
            ) : wait?.status === "notified" ? (
                <button type="button" disabled={busy} onClick={() => onTake(wait.id)}
                    style={{ minHeight: 44, padding: "0 1.1rem", borderRadius: 12, border: "none", background: "#fff", color: "#000", fontWeight: 800, cursor: "pointer", flexShrink: 0 }}>
                    אישור
                </button>
            ) : wait ? (
                <button type="button" disabled={busy} onClick={() => onLeave(wait.id)}
                    style={{ minHeight: 36, padding: "0 0.8rem", borderRadius: 10, border: "1px solid rgba(255,255,255,.15)", background: "transparent", color: "var(--bf-muted)", fontSize: "0.8rem", cursor: "pointer" }}>
                    יציאה
                </button>
            ) : s.waitlist?.can_join ? (
                <button type="button" disabled={busy} onClick={onWait}
                    style={{ minHeight: 44, padding: "0 0.9rem", borderRadius: 12, border: `1px solid ${primary}`, background: "transparent", color: "var(--bf-text)", fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
                    רשימת המתנה
                </button>
            ) : s.can_book || s.book_for.some(p => p.can_book) ? (
                <button type="button" onClick={onBook}
                    style={{ minHeight: 44, padding: "0 1.1rem", borderRadius: 12, border: "none", background: primary, color: "#000", fontWeight: 800, cursor: "pointer", flexShrink: 0 }}>
                    הרשמה
                </button>
            ) : null}
        </div>
        {s.course && <CourseStrip c={s.course} booked={!!s.my_booking} primary={primary} busy={busy} onEnroll={onEnrollCourse} onAction={onCourseAction} />}
        </div>
    );
}

/** Under a course session: part of a course — register for all of it, wait for it, or take a held spot. */
function CourseStrip({ c, booked, primary, busy, onEnroll, onAction }: {
    c: NonNullable<ScheduleItem["course"]>; booked: boolean; primary: string; busy: boolean;
    onEnroll: () => void; onAction: (path: string) => void;
}) {
    const e = c.enrollment;
    const small = { minHeight: 38, padding: "0 0.8rem", borderRadius: 10, fontSize: "0.82rem", fontWeight: 700, cursor: "pointer" } as const;
    return (
        <div style={{ marginTop: "0.65rem", paddingTop: "0.65rem", borderTop: "1px solid rgba(255,255,255,.06)", display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: "0.8rem", color: "var(--bf-muted)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <GraduationCap size={15} aria-hidden />
                {e?.status === "active" ? "רשום/ה לקורס" : e?.status === "waiting" ? `ברשימת ההמתנה לקורס · מקום ${e.position}`
                    : e?.status === "offered" && e.offer_expires_at ? `התפנה מקום בקורס! שמור לך עד ${ilTime(e.offer_expires_at)}`
                    : `חלק מקורס · ${c.sessions_left} מפגשים${c.covered_by_membership ? " · במנוי" : c.price_cents ? ` · ₪${(c.price_cents / 100).toLocaleString("he-IL")}` : ""}`}
            </span>
            {e?.status === "offered" && (
                <button type="button" disabled={busy} onClick={() => onAction(`course-waits/${e.id}/take`)} style={{ ...small, border: "none", background: "#fff", color: "#000" }}>אישור</button>
            )}
            {e && e.status !== "active" && (
                <button type="button" disabled={busy} onClick={() => onAction(`course-waits/${e.id}/leave`)}
                    style={{ ...small, border: "1px solid rgba(255,255,255,.15)", background: "transparent", color: "var(--bf-muted)" }}>יציאה</button>
            )}
            {!e && !booked && c.can_enroll && (
                <button type="button" onClick={onEnroll} style={{ ...small, border: "none", background: primary, color: "#000" }}>הרשמה לקורס</button>
            )}
            {!e && !booked && !c.can_enroll && c.can_wait && (
                <button type="button" disabled={busy} onClick={() => onAction(`courses/${c.template_id}/waitlist`)}
                    style={{ ...small, border: `1px solid ${primary}`, background: "transparent", color: "var(--bf-text)" }}>רשימת המתנה לקורס</button>
            )}
            {!e && !booked && !c.can_enroll && !c.can_wait && c.why_not && (
                <span style={{ width: "100%", fontSize: "0.76rem", color: "var(--bf-muted)" }}>{c.why_not}</span>
            )}
        </div>
    );
}

function MyClasses({ mine, primary, busy, onCancel, onMove, onLeave, onTake, onCourseAction }: {
    mine: Mine | null; primary: string; busy: boolean; onCancel: (b: MineItem) => void; onMove: (b: MineItem) => void;
    onCourseAction: (path: string) => void;
    onLeave: (id: string) => void; onTake: (id: string) => void;
}) {
    if (!mine) return <div style={{ display: "flex", justifyContent: "center", padding: "2rem" }}><Loader2 className="spin" size={24} color={primary} /></div>;
    return (
        <>
            {mine.courses && mine.courses.length > 0 && (
                <>
                    <h2 style={{ fontSize: "0.85rem", color: muted, fontWeight: 700, margin: "0 0 0.5rem" }}>הקורסים שלי</h2>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.4rem" }}>
                        {mine.courses.map((c: MyCourse) => (
                            <div key={c.id} style={{ ...card, padding: "0.85rem 1rem", display: "flex", alignItems: "center", gap: "0.8rem" }}>
                                <GraduationCap size={20} color="var(--bf-muted)" style={{ flexShrink: 0 }} aria-hidden />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 700 }}>{c.name}</div>
                                    <div style={{ color: muted, fontSize: "0.8rem", marginTop: 2, lineHeight: 1.5 }}>
                                        {c.status === "active"
                                            ? `נשארו ${c.sessions_left} מתוך ${c.sessions_total} מפגשים${c.next_starts_at ? ` · הבא: ${whenText(c.next_starts_at)}` : ""}`
                                            : c.status === "waiting" ? `ברשימת ההמתנה · מקום ${c.position}`
                                            : c.offer_expires_at ? `התפנה מקום! שמור לך עד ${ilTime(c.offer_expires_at)}` : ""}
                                        {c.status === "active" && c.price_cents > 0 && (
                                            <span> · ₪{(c.price_cents / 100).toLocaleString("he-IL")}{c.paid_cents > 0 ? ` (שולם ₪${(c.paid_cents / 100).toLocaleString("he-IL")})` : ""}</span>
                                        )}
                                    </div>
                                    {c.status === "active" && <div style={{ color: "var(--bf-faint)", fontSize: "0.74rem", marginTop: 2 }}>לביטול ההרשמה לכל הקורס — דרך העסק.</div>}
                                </div>
                                {c.status === "offered" && (
                                    <button type="button" disabled={busy} onClick={() => onCourseAction(`course-waits/${c.id}/take`)}
                                        style={{ minHeight: 40, padding: "0 0.9rem", borderRadius: 10, border: "none", background: "#fff", color: "#000", fontWeight: 800, cursor: "pointer" }}>
                                        אישור
                                    </button>
                                )}
                                {c.status !== "active" && (
                                    <button type="button" disabled={busy} onClick={() => onCourseAction(`course-waits/${c.id}/leave`)}
                                        style={{ minHeight: 40, padding: "0 0.9rem", borderRadius: 10, border: "1px solid rgba(255,255,255,.15)", background: "transparent", color: "var(--bf-muted)", cursor: "pointer" }}>
                                        יציאה
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </>
            )}
            {mine.waitlist && mine.waitlist.length > 0 && (
                <>
                    <h2 style={{ fontSize: "0.85rem", color: muted, fontWeight: 700, margin: "0 0 0.5rem" }}>ברשימת ההמתנה</h2>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.4rem" }}>
                        {mine.waitlist.map((w: MyWaitItem) => (
                            <div key={w.id} style={{ ...card, padding: "0.85rem 1rem", display: "flex", alignItems: "center", gap: "0.8rem" }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 700 }}>{w.name}</div>
                                    <div style={{ color: w.status === "notified" ? "#86efac" : muted, fontSize: "0.8rem", marginTop: 2 }}>
                                        {w.status === "notified" && w.offer_expires_at ? `התפנה מקום! שמור לך עד ${ilTime(w.offer_expires_at)}` : `${whenText(w.starts_at)} · מקום ${w.position} בתור`}
                                    </div>
                                </div>
                                {w.status === "notified" ? (
                                    <button type="button" disabled={busy} onClick={() => onTake(w.id)}
                                        style={{ minHeight: 40, padding: "0 0.9rem", borderRadius: 10, border: "none", background: "#fff", color: "#000", fontWeight: 800, cursor: "pointer" }}>
                                        אישור
                                    </button>
                                ) : (
                                    <button type="button" disabled={busy} onClick={() => onLeave(w.id)}
                                        style={{ minHeight: 40, padding: "0 0.9rem", borderRadius: 10, border: "1px solid rgba(255,255,255,.15)", background: "transparent", color: "var(--bf-muted)", cursor: "pointer" }}>
                                        יציאה
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </>
            )}
            <h2 style={{ fontSize: "0.85rem", color: muted, fontWeight: 700, margin: "0 0 0.5rem" }}>הקרובים</h2>
            {mine.upcoming.length === 0 ? <p style={{ color: muted, fontSize: "0.88rem", margin: "0 0 1.2rem" }}>אין שיעורים קרובים.</p> : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.4rem" }}>
                    {mine.upcoming.map(b => (
                        <div key={b.id} style={{ ...card, padding: "0.85rem 1rem", display: "flex", alignItems: "center", gap: "0.8rem" }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 700 }}>{b.name}</div>
                                <div style={{ color: muted, fontSize: "0.8rem", marginTop: 2 }}>{whenText(b.starts_at)}{b.room_name ? ` · ${b.room_name}` : ""}{b.enrollment_id ? " · קורס" : ""}{b.for_name ? ` · ${b.for_name}` : ""}</div>
                            </div>
                            {b.can_swap && (
                                <button type="button" onClick={() => onMove(b)} aria-label={`העברת ${b.name} לשיעור אחר`}
                                    style={{ minHeight: 40, padding: "0 0.75rem", borderRadius: 10, border: "1px solid rgba(255,255,255,.15)", background: "transparent", color: "var(--bf-text)", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                                    <ArrowLeftRight size={15} aria-hidden /> החלפה
                                </button>
                            )}
                            <button type="button" onClick={() => onCancel(b)}
                                style={{ minHeight: 40, padding: "0 0.9rem", borderRadius: 10, border: "1px solid rgba(248,113,113,.4)", background: "transparent", color: "#fca5a5", fontWeight: 700, cursor: "pointer" }}>
                                ביטול
                            </button>
                        </div>
                    ))}
                </div>
            )}
            {mine.history.length > 0 && (
                <>
                    <h2 style={{ fontSize: "0.85rem", color: muted, fontWeight: 700, margin: "0 0 0.5rem" }}>היסטוריה</h2>
                    <div style={{ ...card, padding: "0.25rem 1rem" }}>
                        {mine.history.map((b, i) => (
                            <div key={b.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", padding: "0.65rem 0", borderTop: i ? "1px solid rgba(255,255,255,.06)" : "none" }}>
                                <span style={{ fontSize: "0.88rem" }}>{b.name} <span style={{ color: muted, fontVariantNumeric: "tabular-nums" }}>{dayLabel(ilDay(b.starts_at))}</span></span>
                                <span style={{ fontSize: "0.78rem", color: b.status === "attended" ? "#86efac" : b.status === "booked" ? muted : "#fcd34d" }}>{STATUS_TEXT[b.status]}</span>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </>
    );
}

/** Ask to freeze a membership: from a date to a return date, and why. The server checks the membership's
 *  rules and answers at once when it cannot be — the sheet stays open to fix the dates. */
function FreezeSheet({ m, primary, busy, onClose, onSend }: {
    m: MyMembership; primary: string; busy: boolean; onClose: () => void;
    onSend: (b: { from_on: string; until_on: string; note: string }) => void;
}) {
    const [fromOn, setFromOn] = useState("");
    const [untilOn, setUntilOn] = useState("");
    const [note, setNote] = useState("");
    const f = m.freeze!;
    const rules = [
        f.min_days ? `לפחות ${f.min_days} ימים` : null,
        f.days_left !== null ? `נשארו ${f.days_left} ימי הקפאה` : null,
        f.fee_cents > 0 ? `דמי הקפאה ₪${(f.fee_cents / 100).toLocaleString("he-IL")}` : null,
    ].filter(Boolean).join(" · ");
    const field = { width: "100%", minHeight: 46, borderRadius: 12, border: "1px solid rgba(255,255,255,.15)", background: "rgba(0,0,0,.25)",
        color: "var(--bf-text)", padding: "0 0.8rem", fontSize: "0.95rem", colorScheme: "dark" as const, boxSizing: "border-box" as const };
    return (
        <div role="dialog" aria-modal="true" aria-label="בקשת הקפאה" onClick={e => e.target === e.currentTarget && !busy && onClose()}
            style={{ position: "fixed", inset: 0, zIndex: 200 /* above the app's bottom nav (100) */, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
            <div style={{ background: "#0c0c0c", border: "1px solid var(--bf-line)", borderBottom: "none", width: "100%", maxWidth: 520, borderRadius: "20px 20px 0 0", padding: "1.25rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom))" }}>
                <p style={{ fontWeight: 800, fontSize: "1.05rem", margin: "0 0 0.3rem" }}>בקשת הקפאה · {m.name}</p>
                <p style={{ color: muted, fontSize: "0.85rem", margin: "0 0 1rem", lineHeight: 1.6 }}>
                    תוקף המנוי יוארך בימי ההקפאה. הרשמות לשיעורים בתקופה הזו יבוטלו והכניסות יחזרו.{rules ? ` ${rules}.` : ""}
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem", marginBottom: "0.7rem" }}>
                    <label style={{ fontSize: "0.8rem", color: "var(--bf-muted)" }}>מתאריך
                        <input type="date" value={fromOn} onChange={e => setFromOn(e.target.value)} style={{ ...field, marginTop: 4 }} />
                    </label>
                    <label style={{ fontSize: "0.8rem", color: "var(--bf-muted)" }}>חוזר/ת בתאריך
                        <input type="date" value={untilOn} min={fromOn || undefined} onChange={e => setUntilOn(e.target.value)} style={{ ...field, marginTop: 4 }} />
                    </label>
                </div>
                <label style={{ display: "block", fontSize: "0.8rem", color: "var(--bf-muted)", marginBottom: "1rem" }}>סיבה (לא חובה)
                    <input value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="למשל: נסיעה לחו״ל" style={{ ...field, marginTop: 4 }} />
                </label>
                <div style={{ display: "flex", gap: "0.6rem" }}>
                    <button type="button" disabled={busy || !fromOn || !untilOn} onClick={() => onSend({ from_on: fromOn, until_on: untilOn, note })}
                        style={{ flex: 1, minHeight: 48, borderRadius: 14, border: "none", fontWeight: 800, fontSize: "0.95rem", cursor: "pointer", color: "#000",
                            background: primary, opacity: busy || !fromOn || !untilOn ? 0.5 : 1 }}>
                        {busy ? "רגע…" : "שליחת הבקשה"}
                    </button>
                    <button type="button" disabled={busy} onClick={onClose}
                        style={{ minHeight: 48, padding: "0 1.1rem", borderRadius: 14, border: "1px solid rgba(255,255,255,.15)", background: "transparent", color: "var(--bf-text)", cursor: "pointer" }}>
                        חזרה
                    </button>
                </div>
            </div>
        </div>
    );
}
