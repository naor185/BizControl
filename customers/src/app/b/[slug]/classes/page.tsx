"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ChevronRight, ChevronLeft, Users, MapPin, UserRound, CalendarCheck, Ticket, Loader2 } from "lucide-react";
import { apiFetch, getToken } from "@/lib/api";
import { usePlatformTheme } from "@/lib/usePlatformTheme";
import AuthModal from "@/components/AuthModal";
import {
    type Mine, type MineItem, type MyMembership, type Schedule, type ScheduleItem,
    DAY_LONG, dayLabel, fullDate, ilDay, ilTime, shiftDay, weekdayOf, whenText,
} from "@/lib/classes";

// A client's group classes at one business: the week's schedule (how many spots are left — never who is
// booked), booking, "my classes" with cancel, and "my membership". Open to a client of the business with
// a membership that covers the class; the server decides everything and says why when it says no.

type Tab = "schedule" | "mine";
type Confirm = { kind: "book"; item: ScheduleItem } | { kind: "cancel"; id: string; name: string; startsAt: string; late: boolean };

const card = { background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 16 } as const;
const muted = "#94a3b8";
const STATUS_TEXT: Record<string, string> = {
    booked: "רשום/ה", attended: "הגעת", no_show: "לא הגעת", late_canceled: "ביטול מאוחר",
};

export default function ClassesPage() {
    const { slug } = useParams() as { slug: string };
    const theme = usePlatformTheme();
    const primary = theme.primary;
    const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
    const [tab, setTab] = useState<Tab>("schedule");
    const [week, setWeek] = useState<string | null>(null);
    const [data, setData] = useState<Schedule | null>(null);
    const [mine, setMine] = useState<Mine | null>(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
    const [confirm, setConfirm] = useState<Confirm | null>(null);
    const [busy, setBusy] = useState(false);

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
                const r = await apiFetch<{ message: string }>(`/api/marketplace/classes/${slug}/sessions/${confirm.item.id}/book`, { method: "POST" });
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

    const shell = (children: React.ReactNode) => (
        <div dir="rtl" style={{ minHeight: "100vh", background: "#0f172a", color: "#f1f5f9", padding: "1.25rem 1rem 6rem" }}>
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
                <AuthGate primary={primary} onDone={() => setLoggedIn(true)} />
            </div>
        );
    }
    if (error) return shell(<div style={{ ...card, padding: "1.5rem", textAlign: "center", color: "#fca5a5" }}>{error}</div>);
    if (!data) return shell(<div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}><Loader2 className="spin" size={28} color={primary} /></div>);

    const days = Array.from({ length: 7 }, (_, i) => shiftDay(data.week, i)).filter(d => data.sessions.some(s => ilDay(s.starts_at) === d));

    return shell(
        <>
            <Memberships list={data.memberships} isClient={data.is_client} primary={primary} studio={data.studio.name} />

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
                            color: tab === id ? "#fff" : "#cbd5e1" }}>
                        {label}{id === "mine" && mine && mine.upcoming.length > 0 ? ` (${mine.upcoming.length})` : ""}
                    </button>
                ))}
            </div>

            {tab === "schedule" ? (
                <>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.9rem" }}>
                        <button type="button" onClick={() => setWeek(shiftDay(data.week, -7))} aria-label="השבוע הקודם"
                            style={{ width: 44, height: 44, borderRadius: 12, border: "1px solid rgba(255,255,255,.12)", background: "transparent", color: "#e2e8f0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <ChevronRight size={20} />
                        </button>
                        <span dir="ltr" style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{dayLabel(data.week)} – {dayLabel(shiftDay(data.week, 6))}</span>
                        <button type="button" onClick={() => setWeek(shiftDay(data.week, 7))} aria-label="השבוע הבא"
                            style={{ width: 44, height: 44, borderRadius: 12, border: "1px solid rgba(255,255,255,.12)", background: "transparent", color: "#e2e8f0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
                                    <SessionCard key={s.id} s={s} primary={primary}
                                        onBook={() => setConfirm({ kind: "book", item: s })}
                                        onCancel={() => s.my_booking && setConfirm({ kind: "cancel", id: s.my_booking.id, name: s.name, startsAt: s.starts_at, late: s.late_if_cancel_now })} />
                                ))}
                            </div>
                        </section>
                    ))}
                </>
            ) : (
                <MyClasses mine={mine} primary={primary}
                    onCancel={(b: MineItem) => setConfirm({ kind: "cancel", id: b.id, name: b.name, startsAt: b.starts_at, late: !!b.late_if_cancel_now })} />
            )}

            {confirm && (
                <div role="dialog" aria-modal="true" onClick={e => e.target === e.currentTarget && !busy && setConfirm(null)}
                    style={{ position: "fixed", inset: 0, zIndex: 200 /* above the app's bottom nav (100) */, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                    <div style={{ background: "#1e293b", width: "100%", maxWidth: 520, borderRadius: "20px 20px 0 0", padding: "1.25rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom))" }}>
                        {confirm.kind === "book" ? (
                            <>
                                <p style={{ fontWeight: 800, fontSize: "1.05rem", margin: "0 0 0.3rem" }}>הרשמה ל{confirm.item.name}</p>
                                <p style={{ color: "#cbd5e1", margin: "0 0 0.8rem" }}>{whenText(confirm.item.starts_at)}</p>
                                <p style={{ color: muted, fontSize: "0.85rem", margin: "0 0 1.1rem", lineHeight: 1.6 }}>
                                    ביטול בחינם עד {whenText(confirm.item.free_cancel_until)}. אחרי זה — לפי מדיניות הביטולים של {data.studio.name}.
                                </p>
                            </>
                        ) : (
                            <>
                                <p style={{ fontWeight: 800, fontSize: "1.05rem", margin: "0 0 0.3rem" }}>ביטול ההרשמה ל{confirm.name}</p>
                                <p style={{ color: "#cbd5e1", margin: "0 0 0.8rem" }}>{whenText(confirm.startsAt)}</p>
                                {confirm.late && (
                                    <p style={{ color: "#fcd34d", fontSize: "0.85rem", margin: "0 0 1.1rem", lineHeight: 1.6 }}>
                                        זה כבר ביטול מאוחר — לפי מדיניות העסק ייתכן שהכניסה תנוצל או שיירשם חיוב.
                                    </p>
                                )}
                            </>
                        )}
                        <div style={{ display: "flex", gap: "0.6rem" }}>
                            <button type="button" disabled={busy} onClick={act}
                                style={{ flex: 1, minHeight: 48, borderRadius: 14, border: "none", fontWeight: 800, fontSize: "0.95rem", cursor: "pointer", color: "#fff",
                                    background: confirm.kind === "book" ? primary : "#dc2626", opacity: busy ? 0.6 : 1 }}>
                                {busy ? "רגע…" : confirm.kind === "book" ? "אישור ההרשמה" : "לבטל את ההרשמה"}
                            </button>
                            <button type="button" disabled={busy} onClick={() => setConfirm(null)}
                                style={{ minHeight: 48, padding: "0 1.1rem", borderRadius: 14, border: "1px solid rgba(255,255,255,.15)", background: "transparent", color: "#e2e8f0", cursor: "pointer" }}>
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

function AuthGate({ primary, onDone }: { primary: string; onDone: () => void }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}
                style={{ minHeight: 46, padding: "0 1.4rem", borderRadius: 14, border: "none", background: primary, color: "#fff", fontWeight: 800, cursor: "pointer" }}>
                התחברות
            </button>
            {open && <AuthModal onClose={() => setOpen(false)} onSuccess={() => { setOpen(false); onDone(); }} />}
        </>
    );
}

function Memberships({ list, isClient, primary, studio }: { list: MyMembership[]; isClient: boolean; primary: string; studio: string }) {
    if (!isClient || list.length === 0) {
        return (
            <div style={{ ...card, padding: "1rem", marginBottom: "1rem", display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                <Ticket size={22} color={muted} style={{ flexShrink: 0, marginTop: 2 }} />
                <p style={{ margin: 0, color: "#cbd5e1", fontSize: "0.88rem", lineHeight: 1.6 }}>
                    {isClient ? `אין לך מנוי פעיל ב${studio}. כדי להירשם לשיעורים — פנו לעסק לרכישת מנוי.`
                        : `ההרשמה לשיעורים פתוחה ללקוחות ${studio} עם מנוי. כבר לקוח/ה? ודאו שמספר הטלפון שלכם בעסק זהה לזה שהתחברתם איתו.`}
                </p>
            </div>
        );
    }
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1rem" }}>
            {list.map((m, i) => (
                <div key={i} style={{ ...card, padding: "0.9rem 1rem", display: "flex", alignItems: "center", gap: "0.8rem", borderColor: `${primary}55` }}>
                    <Ticket size={22} color={primary} style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800 }}>המנוי שלי · {m.name}</div>
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
                    {m.kind === "weekly" && <div style={{ fontSize: "0.8rem", color: "#cbd5e1" }}>{m.weekly_limit} בשבוע</div>}
                </div>
            ))}
        </div>
    );
}

function SessionCard({ s, primary, onBook, onCancel }: { s: ScheduleItem; primary: string; onBook: () => void; onCancel: () => void }) {
    const booked = s.my_booking?.status === "booked";
    return (
        <div style={{ ...card, padding: "0.85rem 1rem", display: "flex", alignItems: "center", gap: "0.8rem", ...(booked ? { borderColor: `${primary}88` } : {}) }}>
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
                        <Users size={13} />{s.spots_left === 0 ? "מלא" : s.spots_left <= 3 ? `נשארו ${s.spots_left} מקומות` : `${s.spots_left} מקומות פנויים`}
                    </span>
                </div>
                {!s.can_book && !s.my_booking && s.why_not && <div style={{ color: "#94a3b8", fontSize: "0.76rem", marginTop: 4 }}>{s.why_not}</div>}
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
            ) : s.can_book ? (
                <button type="button" onClick={onBook}
                    style={{ minHeight: 44, padding: "0 1.1rem", borderRadius: 12, border: "none", background: primary, color: "#fff", fontWeight: 800, cursor: "pointer", flexShrink: 0 }}>
                    הרשמה
                </button>
            ) : null}
        </div>
    );
}

function MyClasses({ mine, primary, onCancel }: { mine: Mine | null; primary: string; onCancel: (b: MineItem) => void }) {
    if (!mine) return <div style={{ display: "flex", justifyContent: "center", padding: "2rem" }}><Loader2 className="spin" size={24} color={primary} /></div>;
    return (
        <>
            <h2 style={{ fontSize: "0.85rem", color: muted, fontWeight: 700, margin: "0 0 0.5rem" }}>הקרובים</h2>
            {mine.upcoming.length === 0 ? <p style={{ color: muted, fontSize: "0.88rem", margin: "0 0 1.2rem" }}>אין שיעורים קרובים.</p> : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.4rem" }}>
                    {mine.upcoming.map(b => (
                        <div key={b.id} style={{ ...card, padding: "0.85rem 1rem", display: "flex", alignItems: "center", gap: "0.8rem" }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 700 }}>{b.name}</div>
                                <div style={{ color: muted, fontSize: "0.8rem", marginTop: 2 }}>{whenText(b.starts_at)}{b.room_name ? ` · ${b.room_name}` : ""}</div>
                            </div>
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
