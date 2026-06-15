"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { API } from "@/lib/api";

interface Service { id: string; name: string; duration_minutes: number; price_ils: number; color: string; is_bookable_online: boolean; }
interface Artist { id: string; name: string; }

type Step = "service" | "artist" | "date" | "time" | "details";

export default function BookPage() {
    const { slug } = useParams() as { slug: string };
    const [studioName, setStudioName] = useState("");
    const [primary, setPrimary] = useState("#7c3aed");
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
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [notes, setNotes] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [done, setDone] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [showWaitlist, setShowWaitlist] = useState(false);
    const [waitlistDone, setWaitlistDone] = useState(false);
    const [wlName, setWlName] = useState("");
    const [wlPhone, setWlPhone] = useState("");

    useEffect(() => {
        fetch(`${API}/api/marketplace/${slug}`)
            .then(r => r.json())
            .then(d => {
                setStudioName(d.name);
                setPrimary(d.primary_color || "#7c3aed");
                setBookingEnabled(!!d.self_booking_enabled);
                setServices(d.services.filter((s: Service) => s.is_bookable_online));
                setArtists(d.artists);
                // Auto-select only artist
                if (d.artists.length === 1) setArtist(d.artists[0]);
            }).catch(() => setErr("שגיאה בטעינה"));
    }, [slug]);

    // Load slots when date + artist are ready
    useEffect(() => {
        if (step !== "time" || !date || !artist) return;
        setSlotsLoading(true);
        fetch(`${API}/api/public/book/${slug}/slots?date=${date}&artist_id=${artist.id}`)
            .then(r => r.json())
            .then(d => setSlots(Array.isArray(d) ? d : []))
            .catch(() => setSlots([]))
            .finally(() => setSlotsLoading(false));
    }, [step, date, artist, slug]);

    const submit = async () => {
        if (!name || !phone || !artist || !date || !time) return;
        setSubmitting(true);
        try {
            const serviceLabel = service ? `[שירות: ${service.name}] ` : "";
            const res = await fetch(`${API}/api/public/book/${slug}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ artist_id: artist.id, date, time, name, phone, notes: `${serviceLabel}${notes}`.trim() }),
            });
            if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "שגיאה"); }
            setDone(true);
        } catch (e: any) { setErr(e.message); }
        finally { setSubmitting(false); }
    };

    const today = new Date().toISOString().split("T")[0];
    const steps: Step[] = ["service", "artist", "date", "time", "details"];
    const stepIdx = steps.indexOf(step);

    if (bookingEnabled === false) return (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", padding: "2rem", textAlign: "center" }}>
            <div style={{ fontSize: "3.5rem" }}>🔒</div>
            <h2 style={{ fontSize: "1.4rem", fontWeight: 900, color: "#e2e8f0" }}>קביעת תורים אונליין סגורה</h2>
            <p style={{ color: "#64748b", fontSize: "0.9rem", lineHeight: 1.7 }}>
                {studioName || "העסק"} אינו מקבל תורים אונליין כרגע.<br />
                ניתן ליצור קשר ישירות עם העסק לקביעת תור.
            </p>
            <Link href={`/b/${slug}`} style={{ background: "linear-gradient(135deg,#7c3aed,#4c1d95)", color: "#fff", textDecoration: "none", padding: "0.8rem 1.8rem", borderRadius: 14, fontWeight: 700 }}>
                חזרה לפרופיל
            </Link>
        </div>
    );

    if (done) return (
        <div style={{ height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1.5rem", padding: "2rem", textAlign: "center" }}>
            <div style={{ fontSize: "4rem" }}>🎉</div>
            <h2 style={{ fontSize: "1.6rem", fontWeight: 900, color: "#4ade80" }}>הבקשה נשלחה!</h2>
            <p style={{ color: "#94a3b8", lineHeight: 1.7 }}>
                {service?.name} ב-{studioName}<br />
                {date} בשעה {time}<br />
                <span style={{ fontSize: "0.85rem" }}>העסק יאשר את התור בהקדם</span>
            </p>
            <Link href={`/b/${slug}`} style={{ background: `linear-gradient(135deg,${primary},#4c1d95)`, color: "#fff", textDecoration: "none", padding: "0.8rem 1.8rem", borderRadius: 14, fontWeight: 700 }}>
                חזרה לפרופיל
            </Link>
        </div>
    );

    if (err) return (
        <div style={{ height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem" }}>
            <div style={{ color: "#f87171" }}>{err}</div>
            <Link href={`/b/${slug}`} style={{ color: "#a78bfa", textDecoration: "none" }}>← חזרה</Link>
        </div>
    );

    return (
        <div style={{ minHeight: "100vh", paddingBottom: "4rem" }}>
            {/* Header */}
            <div style={{ background: `linear-gradient(135deg,${primary}55,#1e1b4b)`, padding: "1.5rem 1.25rem" }}>
                <Link href={`/b/${slug}`} style={{ color: "#a78bfa", textDecoration: "none", fontSize: "0.85rem" }}>← {studioName}</Link>
                <h1 style={{ fontSize: "1.5rem", fontWeight: 900, marginTop: "0.5rem" }}>📅 קביעת תור</h1>
            </div>

            {/* Progress bar */}
            <div style={{ display: "flex", padding: "1rem 1.25rem", gap: "0.3rem" }}>
                {steps.map((s, i) => (
                    <div key={s} style={{ flex: 1, height: 4, borderRadius: 4, background: stepIdx >= i ? primary : "rgba(255,255,255,.1)", transition: "background .3s" }} />
                ))}
            </div>

            <div style={{ maxWidth: 540, margin: "0 auto", padding: "0.5rem 1.25rem" }}>

                {/* STEP: Service */}
                {step === "service" && (
                    <Card title="בחר שירות">
                        {services.length === 0 ? (
                            <div style={{ color: "#64748b", textAlign: "center", padding: "2rem" }}>אין שירותים זמינים להזמנה אונליין</div>
                        ) : services.map(s => (
                            <OptionBtn key={s.id} onClick={() => { setService(s); setStep(artists.length > 1 ? "artist" : "date"); }}>
                                <div style={{ borderRight: `3px solid ${s.color}`, paddingRight: "0.75rem" }}>
                                    <div style={{ fontWeight: 700 }}>{s.name}</div>
                                    <div style={{ color: "#64748b", fontSize: "0.78rem" }}>
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
                                👤 {a.name}
                            </OptionBtn>
                        ))}
                    </Card>
                )}

                {/* STEP: Date */}
                {step === "date" && (
                    <Card title="בחר תאריך" onBack={() => setStep(artists.length > 1 ? "artist" : "service")}>
                        {service && (
                            <div style={{ background: "rgba(255,255,255,.04)", borderRadius: 12, padding: "0.75rem", marginBottom: "1rem", color: "#a78bfa", fontSize: "0.88rem" }}>
                                🛎️ {service.name}{artist ? ` · ${artist.name}` : ""}
                            </div>
                        )}
                        <input type="date" value={date} onChange={e => setDate(e.target.value)} min={today}
                            style={{ width: "100%", background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 14, padding: "0.85rem 1rem", color: "#fff", fontSize: "1rem", outline: "none" }} />
                        <PrimaryBtn disabled={!date} onClick={() => setStep("time")} label="המשך ←" primary={primary} />
                    </Card>
                )}

                {/* STEP: Time */}
                {step === "time" && (
                    <Card title={`שעות פנויות — ${date}`} onBack={() => setStep("date")}>
                        {slotsLoading ? (
                            <div style={{ textAlign: "center", padding: "2rem", color: "#64748b" }}>⏳ בודק זמינות...</div>
                        ) : slots.length === 0 ? (
                            <div style={{ textAlign: "center", padding: "2rem", color: "#64748b" }}>
                                <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>😕</div>
                                <div style={{ marginBottom: "1.25rem" }}>אין שעות פנויות לתאריך זה.</div>
                                {!waitlistDone && !showWaitlist && (
                                    <button type="button" onClick={() => setShowWaitlist(true)}
                                        style={{ background: "rgba(124,58,237,.15)", border: "1px solid #7c3aed", color: "#a78bfa", borderRadius: 14, padding: "0.7rem 1.5rem", cursor: "pointer", fontWeight: 700, fontSize: "0.9rem" }}>
                                        📋 הצטרף לרשימת המתנה
                                    </button>
                                )}
                                {showWaitlist && !waitlistDone && (
                                    <div style={{ textAlign: "right", marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                                        <input value={wlName} onChange={e => setWlName(e.target.value)} placeholder="שם מלא *"
                                            style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 12, padding: "0.75rem", color: "#fff", fontSize: "0.95rem", outline: "none" }} />
                                        <input value={wlPhone} onChange={e => setWlPhone(e.target.value)} placeholder="טלפון *" type="tel"
                                            style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 12, padding: "0.75rem", color: "#fff", fontSize: "0.95rem", outline: "none" }} />
                                        <button type="button" disabled={!wlName || !wlPhone}
                                            onClick={async () => {
                                                const res = await fetch(`${API}/api/public/waitlist/${slug}`, {
                                                    method: "POST", headers: { "Content-Type": "application/json" },
                                                    body: JSON.stringify({ name: wlName, phone: wlPhone, artist_id: artist?.id, service_note: service?.name }),
                                                });
                                                if (res.ok) setWaitlistDone(true);
                                            }}
                                            style={{ background: primary, color: "#fff", borderRadius: 12, padding: "0.75rem", cursor: "pointer", fontWeight: 700, border: "none", opacity: (!wlName || !wlPhone) ? 0.5 : 1 }}>
                                            אשר רישום לרשימת המתנה
                                        </button>
                                    </div>
                                )}
                                {waitlistDone && (
                                    <div style={{ background: "rgba(74,222,128,.1)", border: "1px solid #4ade80", borderRadius: 14, padding: "1rem", color: "#4ade80", marginTop: "0.5rem" }}>
                                        ✅ נרשמת לרשימת המתנה! תקבל הודעה בוואטסאפ כשיתפנה מקום.
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(85px,1fr))", gap: "0.55rem" }}>
                                {slots.map(sl => (
                                    <button key={sl} type="button" onClick={() => { setTime(sl); setStep("details"); }}
                                        style={{ background: "rgba(255,255,255,.06)", border: `1px solid ${primary}55`, borderRadius: 12, padding: "0.65rem", cursor: "pointer", color: "#e2e8f0", fontWeight: 700, fontSize: "0.95rem" }}>
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
                        <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, padding: "1rem", marginBottom: "1.25rem" }}>
                            <div style={{ color: "#a78bfa", fontWeight: 700, marginBottom: "0.3rem" }}>{service?.name}</div>
                            <div style={{ color: "#64748b", fontSize: "0.84rem" }}>
                                {date} · {time}{artist ? ` · ${artist.name}` : ""}
                            </div>
                        </div>

                        {[
                            { label: "שם מלא *", val: name, set: setName, type: "text", ph: "ישראל ישראלי" },
                            { label: "טלפון *", val: phone, set: setPhone, type: "tel", ph: "050-0000000" },
                        ].map(f => (
                            <div key={f.label} style={{ marginBottom: "0.75rem" }}>
                                <div style={{ color: "#94a3b8", fontSize: "0.78rem", marginBottom: "0.3rem" }}>{f.label}</div>
                                <input type={f.type} value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.ph}
                                    style={{ width: "100%", background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 12, padding: "0.7rem 0.9rem", color: "#fff", fontSize: "0.95rem", outline: "none" }} />
                            </div>
                        ))}
                        <div style={{ marginBottom: "1.25rem" }}>
                            <div style={{ color: "#94a3b8", fontSize: "0.78rem", marginBottom: "0.3rem" }}>הערות (אופציונלי)</div>
                            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="רצון מיוחד, סגנון..."
                                style={{ width: "100%", background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 12, padding: "0.7rem 0.9rem", color: "#fff", fontSize: "0.95rem", outline: "none", resize: "vertical" }} />
                        </div>
                        <PrimaryBtn disabled={submitting || !name || !phone} onClick={submit} label={submitting ? "שולח..." : "✅ שלח בקשת תור"} primary={primary} />
                        <p style={{ color: "#475569", fontSize: "0.75rem", textAlign: "center", marginTop: "0.75rem" }}>
                            הבקשה תאושר ע"י העסק ותקבל אישור
                        </p>
                    </Card>
                )}
            </div>
        </div>
    );
}

function Card({ title, children, onBack }: { title: string; children: React.ReactNode; onBack?: () => void }) {
    return (
        <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem" }}>
                {onBack && (
                    <button type="button" onClick={onBack} style={{ background: "rgba(255,255,255,.07)", border: "none", borderRadius: 10, color: "#94a3b8", padding: "0.4rem 0.8rem", cursor: "pointer", fontSize: "0.9rem" }}>←</button>
                )}
                <h2 style={{ fontWeight: 800, fontSize: "1.1rem", color: "#e2e8f0" }}>{title}</h2>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>{children}</div>
        </div>
    );
}

function OptionBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 14, padding: "0.9rem 1rem", cursor: "pointer", textAlign: "right", color: "#e2e8f0", fontWeight: 600, fontSize: "0.92rem", transition: "background .2s" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,.09)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,.05)")}
        >
            {children}
        </button>
    );
}

function PrimaryBtn({ disabled, onClick, label, primary }: { disabled: boolean; onClick: () => void; label: string; primary: string }) {
    return (
        <button type="button" onClick={onClick} disabled={disabled}
            style={{ width: "100%", marginTop: "0.75rem", background: disabled ? "rgba(255,255,255,.08)" : `linear-gradient(135deg,${primary},#4c1d95)`, border: "none", borderRadius: 14, color: "#fff", padding: "0.9rem", fontWeight: 800, fontSize: "1rem", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1, transition: "opacity .2s" }}>
            {label}
        </button>
    );
}
