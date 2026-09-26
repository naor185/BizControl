"use client";
import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { API, apiFetch } from "@/lib/api";
import { getCustomer, type Customer } from "@/lib/auth";
import { ArrowRight, CalendarDays, Check, ChevronLeft, ClipboardList, Frown, Lock, LogIn, Send, User } from "lucide-react";
import AuthModal from "@/components/AuthModal";
import { GLASS_BTN, GLASS_CARD, PRIMARY_BTN } from "@/lib/look";

interface Service { id: string; name: string; duration_minutes: number; price_ils: number; color: string; is_bookable_online: boolean; }
interface Artist { id: string; name: string; }

type Step = "service" | "artist" | "date" | "time" | "details";

export default function BookPage() {
    const { slug } = useParams() as { slug: string };
    const [studioName, setStudioName] = useState("");
    const [services, setServices] = useState<Service[]>([]);
    const [artists, setArtists] = useState<Artist[]>([]);

    const [bookingEnabled, setBookingEnabled] = useState<boolean | null>(null);
    const [step, setStep] = useState<Step>("service");
    const [service, setService] = useState<Service | null>(null);
    const [artist, setArtist] = useState<Artist | null>(null);
    const [date, setDate] = useState("");
    const [time, setTime] = useState("");
    const [slots, setSlots] = useState<string[]>([]);
    const [slotsLoading, setSlotsLoading] = useState(false);
    const [notes, setNotes] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [done, setDone] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [showWaitlist, setShowWaitlist] = useState(false);
    const [waitlistDone, setWaitlistDone] = useState(false);
    const [waitlistSubmitting, setWaitlistSubmitting] = useState(false);

    // Booking/waitlist requires a logged-in BizFind customer — resolved once
    // right before submission so browsing stays friction-free.
    const [customer, setCustomer] = useState<Customer | null>(null);
    const [showAuth, setShowAuth] = useState(false);
    const pendingActionRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        setCustomer(getCustomer());
    }, []);

    const requireAuth = (action: () => void) => {
        if (customer) { action(); return; }
        pendingActionRef.current = action;
        setShowAuth(true);
    };

    useEffect(() => {
        fetch(`${API}/api/marketplace/${slug}`)
            .then(r => {
                if (r.status === 410) throw new Error("archived");
                return r.json();
            })
            .then(d => {
                setStudioName(d.name);
                setBookingEnabled(!!d.self_booking_enabled);
                setServices(d.services.filter((s: Service) => s.is_bookable_online));
                setArtists(d.artists);
                // Auto-select only artist
                if (d.artists.length === 1) setArtist(d.artists[0]);
            }).catch((e: Error) => setErr(e.message === "archived"
                ? "העסק אינו זמין להזמנות כרגע — האתר שלו בארכיון. הוא יחזור לפעול ברגע שהעסק יחדש את המנוי."
                : "שגיאה בטעינה"));
    }, [slug]);

    // Load slots when date + artist are ready — sized to the chosen
    // service's real duration, not a generic one-size-fits-all block.
    useEffect(() => {
        if (step !== "time" || !date || !artist) return;
        setSlotsLoading(true);
        const serviceParam = service ? `&service_id=${service.id}` : "";
        fetch(`${API}/api/public/book/${slug}/slots?date=${date}&artist_id=${artist.id}${serviceParam}`)
            .then(r => r.json())
            .then(d => setSlots(Array.isArray(d) ? d : []))
            .catch(() => setSlots([]))
            .finally(() => setSlotsLoading(false));
    }, [step, date, artist, service, slug]);

    const submit = async () => {
        if (!artist || !date || !time) return;
        if (!customer) { requireAuth(submit); return; }
        setSubmitting(true);
        try {
            await apiFetch(`/api/public/book/${slug}`, {
                method: "POST",
                body: JSON.stringify({ artist_id: artist.id, date, time, service_id: service?.id, notes: notes.trim() }),
            });
            setDone(true);
        } catch (e: any) { setErr(e.message); }
        finally { setSubmitting(false); }
    };

    const today = new Date().toISOString().split("T")[0];
    const steps: Step[] = ["service", "artist", "date", "time", "details"];
    const stepIdx = steps.indexOf(step);

    if (bookingEnabled === false) return (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", padding: "2rem", textAlign: "center", background: "var(--bf-bg)", color: "var(--bf-text)" }}>
            <div style={{ width: 76, height: 76, borderRadius: "50%", ...GLASS_CARD, display: "flex", alignItems: "center", justifyContent: "center" }}><Lock size={32} strokeWidth={1.6} aria-hidden /></div>
            <h2 style={{ fontSize: "1.4rem", fontWeight: 800 }}>קביעת תורים אונליין סגורה</h2>
            <p style={{ color: "var(--bf-muted)", fontSize: "0.9rem", lineHeight: 1.7 }}>
                {studioName || "העסק"} אינו מקבל תורים אונליין כרגע.<br />
                ניתן ליצור קשר ישירות עם העסק לקביעת תור.
            </p>
            <Link href={`/b/${slug}`} style={{ ...PRIMARY_BTN, padding: "0.8rem 1.8rem" }}>
                חזרה לפרופיל
            </Link>
        </div>
    );

    if (done) return (
        <div style={{ height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1.5rem", padding: "2rem", textAlign: "center", background: "var(--bf-bg)", color: "var(--bf-text)" }}>
            <div style={{ width: 76, height: 76, borderRadius: "50%", background: "#fff", color: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}><Check size={38} aria-hidden /></div>
            <h2 style={{ fontSize: "1.6rem", fontWeight: 800 }}>הבקשה נשלחה!</h2>
            <p style={{ color: "var(--bf-muted)", lineHeight: 1.7 }}>
                {service?.name} ב-{studioName}<br />
                {date} בשעה {time}<br />
                <span style={{ fontSize: "0.85rem" }}>העסק יאשר את התור בהקדם</span>
            </p>
            <Link href={`/b/${slug}`} style={{ ...PRIMARY_BTN, padding: "0.8rem 1.8rem" }}>
                חזרה לפרופיל
            </Link>
        </div>
    );

    if (err) return (
        <div style={{ height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", padding: "0 1.5rem", textAlign: "center", background: "var(--bf-bg)", color: "var(--bf-text)" }}>
            <div style={{ maxWidth: 420, lineHeight: 1.6, fontWeight: 700 }}>{err}</div>
            <Link href={`/b/${slug}`} style={GLASS_BTN}><ArrowRight size={15} aria-hidden /> חזרה</Link>
        </div>
    );

    return (
        <div style={{ minHeight: "100vh", paddingBottom: "4rem", background: "var(--bf-bg)", color: "var(--bf-text)" }}>
            {/* Header */}
            <div style={{ background: "linear-gradient(180deg,#161616 0%,#000 100%)", borderBottom: "1px solid var(--bf-line)", padding: "1.5rem 1.25rem" }}>
                <Link href={`/b/${slug}`} style={{ color: "var(--bf-muted)", textDecoration: "none", fontSize: "0.85rem", display: "inline-flex", alignItems: "center", gap: "0.25rem" }}><ArrowRight size={14} aria-hidden /> {studioName}</Link>
                <h1 style={{ fontSize: "1.5rem", fontWeight: 800, marginTop: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}><CalendarDays size={22} aria-hidden /> קביעת תור</h1>
            </div>

            {/* Progress bar */}
            <div style={{ display: "flex", padding: "1rem 1.25rem", gap: "0.3rem" }}>
                {steps.map((s, i) => (
                    <div key={s} style={{ flex: 1, height: 4, borderRadius: 4, background: stepIdx >= i ? "#fff" : "rgba(255,255,255,.12)", transition: "background .3s" }} />
                ))}
            </div>

            <div style={{ maxWidth: 540, margin: "0 auto", padding: "0.5rem 1.25rem" }}>

                {/* STEP: Service */}
                {step === "service" && (
                    <Card title="בחר שירות">
                        {services.length === 0 ? (
                            <div style={{ color: "var(--bf-muted)", textAlign: "center", padding: "2rem" }}>אין שירותים זמינים להזמנה אונליין</div>
                        ) : services.map(s => (
                            <OptionBtn key={s.id} onClick={() => { setService(s); setStep(artists.length > 1 ? "artist" : "date"); }}>
                                <div style={{ borderRight: `3px solid ${s.color}`, paddingRight: "0.75rem" }}>
                                    <div style={{ fontWeight: 700 }}>{s.name}</div>
                                    <div style={{ color: "var(--bf-muted)", fontSize: "0.78rem" }}>
                                        {s.duration_minutes < 60 ? `${s.duration_minutes} דק׳` : `${s.duration_minutes / 60} שע׳`}
                                        {s.price_ils > 0 ? ` · ₪${s.price_ils}` : ""}
                                    </div>
                                </div>
                            </OptionBtn>
                        ))}
                    </Card>
                )}

                {/* STEP: Artist */}
                {step === "artist" && artists.length > 1 && (
                    <Card title="בחר מטפל" onBack={() => setStep("service")}>
                        {artists.map(a => (
                            <OptionBtn key={a.id} onClick={() => { setArtist(a); setStep("date"); }}>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}><User size={16} aria-hidden /> {a.name}</span>
                            </OptionBtn>
                        ))}
                    </Card>
                )}

                {/* STEP: Date */}
                {step === "date" && (
                    <Card title="בחר תאריך" onBack={() => setStep(artists.length > 1 ? "artist" : "service")}>
                        {service && (
                            <div style={{ ...GLASS_CARD, borderRadius: 12, padding: "0.75rem", marginBottom: "1rem", color: "var(--bf-text)", fontSize: "0.88rem", fontWeight: 600 }}>
                                {service.name}{artist ? ` · ${artist.name}` : ""}
                            </div>
                        )}
                        <input type="date" value={date} onChange={e => setDate(e.target.value)} min={today}
                            style={{ width: "100%", background: "rgba(255,255,255,.07)", border: "1px solid var(--bf-line)", borderRadius: 14, padding: "0.85rem 1rem", color: "#fff", fontSize: "1rem", outline: "none", colorScheme: "dark" }} />
                        <PrimaryBtn disabled={!date} onClick={() => setStep("time")} label={<>המשך <ChevronLeft size={18} aria-hidden /></>} />
                    </Card>
                )}

                {/* STEP: Time */}
                {step === "time" && (
                    <Card title={`שעות פנויות — ${date}`} onBack={() => setStep("date")}>
                        {slotsLoading ? (
                            <div style={{ textAlign: "center", padding: "2rem", color: "var(--bf-muted)" }}>בודק זמינות...</div>
                        ) : slots.length === 0 ? (
                            <div style={{ textAlign: "center", padding: "2rem", color: "var(--bf-muted)" }}>
                                <Frown size={34} strokeWidth={1.5} aria-hidden style={{ marginBottom: "0.5rem" }} />
                                <div style={{ marginBottom: "1.25rem" }}>אין שעות פנויות לתאריך זה.</div>
                                {!waitlistDone && !showWaitlist && (
                                    <button type="button" onClick={() => requireAuth(() => setShowWaitlist(true))}
                                        style={{ ...GLASS_BTN, display: "inline-flex", cursor: "pointer" }}>
                                        <ClipboardList size={16} aria-hidden /> הצטרף לרשימת המתנה
                                    </button>
                                )}
                                {showWaitlist && !waitlistDone && (
                                    <div style={{ textAlign: "right", marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                                        {customer && (
                                            <div style={{ color: "var(--bf-muted)", fontSize: "0.82rem" }}>
                                                נרשם/ת בתור {customer.full_name} · {customer.phone}
                                            </div>
                                        )}
                                        <button type="button" disabled={waitlistSubmitting}
                                            onClick={async () => {
                                                setWaitlistSubmitting(true);
                                                try {
                                                    await apiFetch(`/api/public/waitlist/${slug}`, {
                                                        method: "POST",
                                                        body: JSON.stringify({ artist_id: artist?.id, service_note: service?.name }),
                                                    });
                                                    setWaitlistDone(true);
                                                } catch { /* silent — keep form open to retry */ }
                                                finally { setWaitlistSubmitting(false); }
                                            }}
                                            style={{ ...PRIMARY_BTN, justifyContent: "center", borderRadius: 12, padding: "0.75rem", opacity: waitlistSubmitting ? 0.5 : 1 }}>
                                            {waitlistSubmitting ? "שולח..." : "אשר רישום לרשימת המתנה"}
                                        </button>
                                    </div>
                                )}
                                {waitlistDone && (
                                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", ...GLASS_CARD, borderRadius: 14, padding: "1rem", color: "var(--bf-text)", marginTop: "0.5rem", textAlign: "right" }}>
                                        <Check size={18} color="#4ade80" style={{ flexShrink: 0 }} aria-hidden /> נרשמת לרשימת המתנה! תקבל הודעה בוואטסאפ כשיתפנה מקום.
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(85px,1fr))", gap: "0.55rem" }}>
                                {slots.map(sl => (
                                    <button key={sl} type="button" onClick={() => { setTime(sl); setStep("details"); }}
                                        style={{ background: "var(--bf-glass)", border: "1px solid var(--bf-line)", borderRadius: 12, padding: "0.65rem", cursor: "pointer", color: "var(--bf-text)", fontWeight: 700, fontSize: "0.95rem", fontVariantNumeric: "tabular-nums" }}>
                                        {sl}
                                    </button>
                                ))}
                            </div>
                        )}
                    </Card>
                )}

                {/* STEP: Details */}
                {step === "details" && (
                    <Card title="פרטי הזמנה" onBack={() => setStep("time")}>
                        {/* Summary */}
                        <div style={{ ...GLASS_CARD, borderRadius: 14, padding: "1rem", marginBottom: "1.25rem" }}>
                            <div style={{ color: "var(--bf-text)", fontWeight: 700, marginBottom: "0.3rem" }}>{service?.name}</div>
                            <div style={{ color: "var(--bf-muted)", fontSize: "0.84rem" }}>
                                {date} · {time}{artist ? ` · ${artist.name}` : ""}
                            </div>
                        </div>

                        {customer && (
                            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: "var(--bf-glass)", border: "1px solid var(--bf-line)", borderRadius: 12, padding: "0.75rem 1rem", marginBottom: "1rem", color: "var(--bf-muted)", fontSize: "0.85rem" }}>
                                <User size={15} aria-hidden /> מזמין/ה: {customer.full_name} · {customer.phone}
                            </div>
                        )}

                        <div style={{ marginBottom: "1.25rem" }}>
                            <div style={{ color: "var(--bf-muted)", fontSize: "0.78rem", marginBottom: "0.3rem" }}>הערות (אופציונלי)</div>
                            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="רצון מיוחד, סגנון..."
                                style={{ width: "100%", background: "rgba(255,255,255,.07)", border: "1px solid var(--bf-line)", borderRadius: 12, padding: "0.7rem 0.9rem", color: "#fff", fontSize: "0.95rem", outline: "none", resize: "vertical", colorScheme: "dark" }} />
                        </div>
                        {customer ? (
                            <PrimaryBtn disabled={submitting} onClick={submit} label={submitting ? "שולח..." : <><Send size={17} aria-hidden /> שלח בקשת תור</>} />
                        ) : (
                            <PrimaryBtn disabled={false} onClick={() => requireAuth(submit)} label={<><LogIn size={17} aria-hidden /> התחבר כדי לשלוח בקשה</>} />
                        )}
                        <p style={{ color: "var(--bf-faint)", fontSize: "0.75rem", textAlign: "center", marginTop: "0.75rem" }}>
                            הבקשה תאושר ע"י העסק ותקבל אישור
                        </p>
                    </Card>
                )}
            </div>

            {showAuth && (
                <AuthModal
                    onClose={() => { setShowAuth(false); pendingActionRef.current = null; }}
                    onSuccess={(c) => {
                        setCustomer(c);
                        setShowAuth(false);
                        const action = pendingActionRef.current;
                        pendingActionRef.current = null;
                        if (action) action();
                    }}
                />
            )}
        </div>
    );
}

function Card({ title, children, onBack }: { title: string; children: React.ReactNode; onBack?: () => void }) {
    return (
        <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem" }}>
                {onBack && (
                    <button type="button" onClick={onBack} aria-label="חזרה" style={{ background: "var(--bf-glass)", border: "1px solid var(--bf-line)", borderRadius: 10, color: "var(--bf-muted)", padding: "0.4rem 0.6rem", cursor: "pointer", display: "flex" }}><ArrowRight size={16} /></button>
                )}
                <h2 style={{ fontWeight: 800, fontSize: "1.1rem", color: "var(--bf-text)" }}>{title}</h2>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>{children}</div>
        </div>
    );
}

function OptionBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} style={{ background: "var(--bf-glass)", border: "1px solid var(--bf-line)", borderRadius: 14, padding: "0.9rem 1rem", cursor: "pointer", textAlign: "right", color: "var(--bf-text)", fontWeight: 600, fontSize: "0.92rem", transition: "background .2s" }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--bf-glass-strong)")}
            onMouseLeave={e => (e.currentTarget.style.background = "var(--bf-glass)")}
        >
            {children}
        </button>
    );
}

function PrimaryBtn({ disabled, onClick, label }: { disabled: boolean; onClick: () => void; label: React.ReactNode }) {
    return (
        <button type="button" onClick={onClick} disabled={disabled}
            style={{ ...PRIMARY_BTN, width: "100%", justifyContent: "center", marginTop: "0.75rem", padding: "0.9rem", fontSize: "1rem", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1, transition: "opacity .2s" }}>
            {label}
        </button>
    );
}
