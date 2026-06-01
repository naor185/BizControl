"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

const API = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE || "").replace(/^http:\/\//, "https://");

interface Service { id: string; name: string; duration_minutes: number; price_ils: number; color: string; description?: string; requires_consultation: boolean; }
interface Artist { id: string; name: string; }
interface Slot { starts_at: string; ends_at: string; label: string; }
interface BookingInfo { studio_id: string; studio_name: string; logo_url?: string; primary_color: string; timezone: string; services: Service[]; artists: Artist[]; }

type Step = "service" | "artist" | "date" | "time" | "details" | "success";

const HE_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
const HE_DAYS_SHORT = ["א׳","ב׳","ג׳","ד׳","ה׳","ו׳","ש׳"];

function isoDate(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }

export default function BookingPage() {
    const params = useParams();
    const slug = params.slug as string;
    const [info, setInfo] = useState<BookingInfo | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [step, setStep] = useState<Step>("service");
    const [service, setService] = useState<Service | null>(null);
    const [artist, setArtist] = useState<Artist | null>(null);
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [calMonth, setCalMonth] = useState(() => new Date());
    const [slots, setSlots] = useState<Slot[]>([]);
    const [loadingSlots, setLoadingSlots] = useState(false);
    const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
    const [form, setForm] = useState({ name: "", phone: "", email: "", notes: "" });
    const [booking, setBooking] = useState(false);
    const [bookErr, setBookErr] = useState<string | null>(null);
    const [confirmation, setConfirmation] = useState<any>(null);

    useEffect(() => {
        fetch(`${API}/api/book/${slug}/info`)
            .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.detail || "שגיאה")))
            .then(setInfo)
            .catch(e => setError(typeof e === "string" ? e : "קביעת תורים אינה זמינה כרגע"));
    }, [slug]);

    const loadSlots = useCallback(async (date: Date) => {
        if (!service) return;
        setLoadingSlots(true);
        setSlots([]);
        try {
            const params = new URLSearchParams({
                service_id: service.id,
                booking_date: isoDate(date),
                ...(artist ? { artist_id: artist.id } : {}),
            });
            const r = await fetch(`${API}/api/book/${slug}/slots?${params}`);
            const data = await r.json();
            setSlots(data.slots || []);
        } catch { setSlots([]); }
        finally { setLoadingSlots(false); }
    }, [service, artist, slug]);

    useEffect(() => { if (selectedDate) loadSlots(selectedDate); }, [selectedDate, loadSlots]);

    const handleBook = async () => {
        if (!service || !selectedSlot || !form.name || !form.phone) { setBookErr("נא למלא את כל השדות"); return; }
        setBooking(true); setBookErr(null);
        try {
            const r = await fetch(`${API}/api/book/${slug}/book`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    service_id: service.id,
                    artist_id: artist?.id || null,
                    starts_at: selectedSlot.starts_at,
                    ends_at: selectedSlot.ends_at,
                    client_name: form.name,
                    client_phone: form.phone,
                    client_email: form.email || null,
                    notes: form.notes || null,
                }),
            });
            if (!r.ok) { const e = await r.json(); throw new Error(e.detail || "שגיאה"); }
            const data = await r.json();
            setConfirmation(data);
            setStep("success");
        } catch (e: any) { setBookErr(e.message); }
        finally { setBooking(false); }
    };

    const primary = info?.primary_color || "#7c3aed";

    // Calendar helpers
    const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
    const firstDayOfMonth = (y: number, m: number) => { const d = new Date(y, m, 1).getDay(); return d; };
    const isToday = (d: Date) => { const t = new Date(); return d.getDate() === t.getDate() && d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear(); };
    const isPast = (d: Date) => { const t = new Date(); t.setHours(0,0,0,0); return d < t; };

    if (!info && !error) return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", color: "#fff", fontSize: "1.5rem" }}>
            ⏳
        </div>
    );

    if (error) return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", color: "#f87171", fontSize: "1.1rem", textAlign: "center", padding: "2rem" }} dir="rtl">
            <div>
                <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🚫</div>
                <div>{error}</div>
            </div>
        </div>
    );

    return (
        <div dir="rtl" style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0f0c29,#1e1b4b)", color: "#fff", fontFamily: "sans-serif" }}>
            {/* Header */}
            <div style={{ background: `${primary}22`, borderBottom: `1px solid ${primary}44`, padding: "1rem 1.5rem", display: "flex", alignItems: "center", gap: "1rem" }}>
                {info?.logo_url && <img src={info.logo_url} alt="" style={{ width: 40, height: 40, borderRadius: 10, objectFit: "cover" }} />}
                <div>
                    <div style={{ fontWeight: 800, fontSize: "1.1rem" }}>{info?.studio_name}</div>
                    <div style={{ color: "#94a3b8", fontSize: "0.8rem" }}>קביעת תור אונליין</div>
                </div>
            </div>

            {/* Progress */}
            {step !== "success" && (
                <div style={{ display: "flex", justifyContent: "center", gap: "0.5rem", padding: "1rem", flexWrap: "wrap" }}>
                    {[
                        { key: "service", label: "שירות" },
                        { key: "artist", label: "מטפל" },
                        { key: "date", label: "תאריך" },
                        { key: "time", label: "שעה" },
                        { key: "details", label: "פרטים" },
                    ].map((s, i) => {
                        const steps: Step[] = ["service", "artist", "date", "time", "details"];
                        const idx = steps.indexOf(step);
                        const si = steps.indexOf(s.key as Step);
                        return (
                            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                                <div style={{
                                    width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                                    fontSize: "0.8rem", fontWeight: 700,
                                    background: si <= idx ? primary : "rgba(255,255,255,.1)",
                                    color: si <= idx ? "#fff" : "#64748b",
                                }}>{i + 1}</div>
                                <span style={{ fontSize: "0.75rem", color: si === idx ? "#fff" : "#64748b" }}>{s.label}</span>
                                {i < 4 && <div style={{ width: 20, height: 1, background: "rgba(255,255,255,.15)", margin: "0 0.25rem" }} />}
                            </div>
                        );
                    })}
                </div>
            )}

            <div style={{ maxWidth: 560, margin: "0 auto", padding: "1.5rem" }}>

                {/* Step: Service */}
                {step === "service" && (
                    <div>
                        <h2 style={{ fontWeight: 800, marginBottom: "1.25rem" }}>בחר שירות</h2>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                            {info?.services.map(s => (
                                <button key={s.id} onClick={() => { setService(s); setStep(info.artists.length > 1 ? "artist" : "date"); }}
                                    style={{ background: service?.id === s.id ? `${s.color}22` : "rgba(255,255,255,.05)", border: `1px solid ${service?.id === s.id ? s.color : "rgba(255,255,255,.1)"}`, borderRadius: 14, padding: "1rem 1.25rem", cursor: "pointer", textAlign: "right", display: "flex", alignItems: "center", gap: "1rem" }}>
                                    <div style={{ width: 12, height: 12, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                                    <div style={{ flex: 1 }}>
                                        <div style={{ color: "#fff", fontWeight: 700, fontSize: "1rem" }}>{s.name}</div>
                                        {s.description && <div style={{ color: "#94a3b8", fontSize: "0.8rem", marginTop: "0.2rem" }}>{s.description}</div>}
                                        {s.requires_consultation && <div style={{ color: "#fbbf24", fontSize: "0.75rem", marginTop: "0.2rem" }}>📋 דורש ייעוץ קודם</div>}
                                    </div>
                                    <div style={{ textAlign: "left", flexShrink: 0 }}>
                                        <div style={{ color: "#a78bfa", fontWeight: 600 }}>{s.duration_minutes < 60 ? `${s.duration_minutes} דק׳` : `${s.duration_minutes/60} שע׳`}</div>
                                        {s.price_ils > 0 && <div style={{ color: "#4ade80", fontSize: "0.9rem" }}>₪{s.price_ils}</div>}
                                    </div>
                                </button>
                            ))}
                            {info?.services.length === 0 && <div style={{ color: "#64748b", textAlign: "center", padding: "2rem" }}>אין שירותים זמינים לקביעה אונליין</div>}
                        </div>
                    </div>
                )}

                {/* Step: Artist */}
                {step === "artist" && (
                    <div>
                        <h2 style={{ fontWeight: 800, marginBottom: "1.25rem" }}>בחר מטפל</h2>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                            <button onClick={() => { setArtist(null); setStep("date"); }}
                                style={{ background: !artist ? `${primary}22` : "rgba(255,255,255,.05)", border: `1px solid ${!artist ? primary : "rgba(255,255,255,.1)"}`, borderRadius: 14, padding: "1rem 1.25rem", cursor: "pointer", color: "#fff", fontWeight: 600, textAlign: "right" }}>
                                🎲 כלשהו (הראשון הזמין)
                            </button>
                            {info?.artists.map(a => (
                                <button key={a.id} onClick={() => { setArtist(a); setStep("date"); }}
                                    style={{ background: artist?.id === a.id ? `${primary}22` : "rgba(255,255,255,.05)", border: `1px solid ${artist?.id === a.id ? primary : "rgba(255,255,255,.1)"}`, borderRadius: 14, padding: "1rem 1.25rem", cursor: "pointer", textAlign: "right" }}>
                                    <span style={{ color: "#fff", fontWeight: 600 }}>👤 {a.name}</span>
                                </button>
                            ))}
                        </div>
                        <button onClick={() => setStep("service")} style={backBtn}>← חזור</button>
                    </div>
                )}

                {/* Step: Date */}
                {step === "date" && (
                    <div>
                        <h2 style={{ fontWeight: 800, marginBottom: "1.25rem" }}>בחר תאריך</h2>
                        <div style={{ background: "rgba(255,255,255,.05)", borderRadius: 16, padding: "1.25rem" }}>
                            {/* Month nav */}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                                <button onClick={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() - 1))} style={navBtn}>‹</button>
                                <span style={{ fontWeight: 700 }}>{HE_MONTHS[calMonth.getMonth()]} {calMonth.getFullYear()}</span>
                                <button onClick={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() + 1))} style={navBtn}>›</button>
                            </div>
                            {/* Day headers */}
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, marginBottom: "0.5rem" }}>
                                {HE_DAYS_SHORT.map(d => <div key={d} style={{ textAlign: "center", fontSize: "0.75rem", color: "#64748b", fontWeight: 600 }}>{d}</div>)}
                            </div>
                            {/* Days grid */}
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
                                {Array.from({ length: firstDayOfMonth(calMonth.getFullYear(), calMonth.getMonth()) }).map((_, i) => (
                                    <div key={`empty-${i}`} />
                                ))}
                                {Array.from({ length: daysInMonth(calMonth.getFullYear(), calMonth.getMonth()) }).map((_, i) => {
                                    const d = new Date(calMonth.getFullYear(), calMonth.getMonth(), i + 1);
                                    const past = isPast(d);
                                    const today = isToday(d);
                                    const selected = selectedDate && isoDate(d) === isoDate(selectedDate);
                                    return (
                                        <button key={i} disabled={past} onClick={() => { setSelectedDate(d); setStep("time"); }}
                                            style={{
                                                padding: "0.5rem 0", borderRadius: 10, border: "none", cursor: past ? "default" : "pointer",
                                                background: selected ? primary : today ? `${primary}33` : "transparent",
                                                color: past ? "#334155" : selected ? "#fff" : "#e2e8f0",
                                                fontWeight: today ? 700 : 400, fontSize: "0.9rem",
                                            }}>
                                            {i + 1}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <button onClick={() => setStep(info?.artists.length && info.artists.length > 1 ? "artist" : "service")} style={backBtn}>← חזור</button>
                    </div>
                )}

                {/* Step: Time */}
                {step === "time" && (
                    <div>
                        <h2 style={{ fontWeight: 800, marginBottom: "0.5rem" }}>בחר שעה</h2>
                        <div style={{ color: "#94a3b8", fontSize: "0.85rem", marginBottom: "1.25rem" }}>
                            {selectedDate && `${selectedDate.getDate()} ${HE_MONTHS[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`}
                        </div>
                        {loadingSlots ? (
                            <div style={{ textAlign: "center", padding: "2rem", color: "#64748b" }}>⏳ טוען זמנים...</div>
                        ) : slots.length === 0 ? (
                            <div style={{ textAlign: "center", padding: "2rem", color: "#64748b" }}>
                                <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>😔</div>
                                <div>אין זמנים פנויים ביום זה</div>
                                <button onClick={() => setStep("date")} style={{ marginTop: "1rem", ...navBtn }}>בחר תאריך אחר</button>
                            </div>
                        ) : (
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(80px,1fr))", gap: "0.5rem", marginBottom: "1.5rem" }}>
                                {slots.map(slot => (
                                    <button key={slot.starts_at} onClick={() => { setSelectedSlot(slot); setStep("details"); }}
                                        style={{
                                            padding: "0.75rem 0", borderRadius: 12, border: `1px solid ${selectedSlot?.starts_at === slot.starts_at ? primary : "rgba(255,255,255,.15)"}`,
                                            background: selectedSlot?.starts_at === slot.starts_at ? `${primary}33` : "rgba(255,255,255,.04)",
                                            color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: "0.9rem",
                                        }}>
                                        {slot.label}
                                    </button>
                                ))}
                            </div>
                        )}
                        <button onClick={() => setStep("date")} style={backBtn}>← חזור</button>
                    </div>
                )}

                {/* Step: Details */}
                {step === "details" && (
                    <div>
                        <h2 style={{ fontWeight: 800, marginBottom: "1.25rem" }}>פרטי הקביעה</h2>
                        <div style={{ background: `${primary}11`, border: `1px solid ${primary}33`, borderRadius: 14, padding: "1rem", marginBottom: "1.5rem", fontSize: "0.9rem" }}>
                            <div>🛎️ <strong>{service?.name}</strong></div>
                            {artist && <div style={{ marginTop: "0.25rem" }}>👤 {artist.name}</div>}
                            {selectedDate && <div style={{ marginTop: "0.25rem" }}>📅 {selectedDate.getDate()} {HE_MONTHS[selectedDate.getMonth()]} · {selectedSlot?.label}</div>}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
                            {[
                                { key: "name", label: "שם מלא *", type: "text", placeholder: "ישראל ישראלי" },
                                { key: "phone", label: "טלפון *", type: "tel", placeholder: "050-0000000" },
                                { key: "email", label: "אימייל", type: "email", placeholder: "you@example.com" },
                                { key: "notes", label: "הערות", type: "text", placeholder: "משהו שצריך לדעת..." },
                            ].map(f => (
                                <div key={f.key}>
                                    <label style={{ color: "#94a3b8", fontSize: "0.82rem", fontWeight: 600, display: "block", marginBottom: "0.35rem" }}>{f.label}</label>
                                    <input type={f.type} value={(form as any)[f.key]} onChange={e => setForm(v => ({ ...v, [f.key]: e.target.value }))}
                                        style={{ background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 10, padding: "0.65rem 0.9rem", color: "#fff", fontSize: "0.9rem", width: "100%", boxSizing: "border-box" as const }}
                                        placeholder={f.placeholder} />
                                </div>
                            ))}
                        </div>
                        {bookErr && <div style={{ background: "rgba(239,68,68,.15)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 10, padding: "0.75rem", color: "#fca5a5", marginBottom: "1rem", fontSize: "0.85rem" }}>{bookErr}</div>}
                        <button onClick={handleBook} disabled={booking} style={{ width: "100%", background: `linear-gradient(135deg,${primary},#4c1d95)`, border: "none", borderRadius: 14, color: "#fff", padding: "0.85rem", fontWeight: 700, fontSize: "1rem", cursor: booking ? "default" : "pointer", opacity: booking ? 0.7 : 1 }}>
                            {booking ? "⏳ שולח..." : "✅ אשר קביעת תור"}
                        </button>
                        <button onClick={() => setStep("time")} style={backBtn}>← חזור</button>
                    </div>
                )}

                {/* Step: Success */}
                {step === "success" && (
                    <div style={{ textAlign: "center", padding: "2rem 0" }}>
                        <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>✅</div>
                        <h2 style={{ color: "#4ade80", fontWeight: 800, fontSize: "1.5rem", marginBottom: "0.5rem" }}>התור נקבע!</h2>
                        <p style={{ color: "#94a3b8" }}>תקבל/י אישור ב-WhatsApp בקרוב</p>
                        <div style={{ background: "rgba(74,222,128,.08)", border: "1px solid rgba(74,222,128,.2)", borderRadius: 16, padding: "1.25rem", marginTop: "1.5rem", fontSize: "0.95rem" }}>
                            <div>🛎️ <strong>{service?.name}</strong></div>
                            {selectedDate && <div style={{ marginTop: "0.5rem" }}>📅 {selectedDate.getDate()} {HE_MONTHS[selectedDate.getMonth()]} · {selectedSlot?.label}</div>}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

const backBtn: React.CSSProperties = { background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer", marginTop: "1.5rem", fontSize: "0.9rem" };
const navBtn: React.CSSProperties = { background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 8, color: "#fff", padding: "0.4rem 0.75rem", cursor: "pointer", fontSize: "1rem" };
