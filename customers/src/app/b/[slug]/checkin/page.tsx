"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, DoorOpen, Loader2, AlertCircle } from "lucide-react";
import { apiFetch, getToken } from "@/lib/api";
import { usePlatformTheme } from "@/lib/usePlatformTheme";
import LoginButton from "@/components/LoginButton";
import { ilTime } from "@/lib/classes";

// Check-in at the door: the page the business's printed QR code opens (…/b/{slug}/checkin?k=<key>).
// Signed in, the scan runs at once — a booked class starting now is marked as attended; otherwise the classes
// the client may walk into are offered (one tap books and marks them), or "go to the front desk".

type Line = { session_id: string; name: string; starts_at: string; spots_left?: number };
type Result = { studio: string; checked_in: Line[]; already?: Line[]; options?: Line[] };

const card = { background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 18 } as const;
const muted = "#94a3b8";

function Checkin() {
    const { slug } = useParams() as { slug: string };
    const key = useSearchParams().get("k") || "";
    const primary = usePlatformTheme().primary;
    const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
    const [result, setResult] = useState<Result | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    useEffect(() => { setLoggedIn(!!getToken()); }, []);

    const scan = useCallback(() => {
        if (!loggedIn || !key) return;
        apiFetch<Result>(`/api/marketplace/classes/${slug}/checkin`, { method: "POST", body: JSON.stringify({ key }) })
            .then(r => { setResult(r); setError(""); })
            .catch(e => setError(e instanceof Error ? e.message : "הסריקה נכשלה"));
    }, [slug, key, loggedIn]);
    useEffect(() => { scan(); }, [scan]);

    const walkIn = async (sessionId: string) => {
        setBusy(true);
        try {
            const r = await apiFetch<Result>(`/api/marketplace/classes/${slug}/checkin/${sessionId}`, { method: "POST", body: JSON.stringify({ key }) });
            setResult(r);
        } catch (e) {
            setError(e instanceof Error ? e.message : "ההרשמה נכשלה");
        } finally {
            setBusy(false);
        }
    };

    const body = !key ? (
        <Message icon={<AlertCircle size={40} color="#fca5a5" />} title="הקוד לא שלם" text="סרקו שוב את הקוד שבכניסה." />
    ) : loggedIn === null ? null : !loggedIn ? (
        <div style={{ ...card, padding: "1.5rem", textAlign: "center" }}>
            <DoorOpen size={40} color={primary} style={{ margin: "0 auto 0.75rem" }} />
            <p style={{ fontWeight: 800, fontSize: "1.1rem", margin: "0 0 0.4rem" }}>צ׳ק-אין לשיעור</p>
            <p style={{ color: muted, fontSize: "0.9rem", margin: "0 0 1.1rem" }}>התחברו עם מספר הטלפון שלכם — אותו מספר שרשום בעסק.</p>
            <LoginButton primary={primary} onDone={() => setLoggedIn(true)} />
        </div>
    ) : error ? (
        <Message icon={<AlertCircle size={40} color="#fca5a5" />} title="לא הצלחנו לסמן הגעה" text={error} />
    ) : !result ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}><Loader2 className="spin" size={30} color={primary} aria-label="בודקים" /></div>
    ) : result.checked_in.length > 0 ? (
        <Message icon={<CheckCircle2 size={56} color="#4ade80" />} title="נרשמה הגעה!"
            text={result.checked_in.map(x => `${x.name} · ${ilTime(x.starts_at)}`).join("\n")} />
    ) : result.already && result.already.length > 0 ? (
        <Message icon={<CheckCircle2 size={56} color="#4ade80" />} title="כבר סומנת — נתראה בשיעור!"
            text={result.already.map(x => `${x.name} · ${ilTime(x.starts_at)}`).join("\n")} />
    ) : result.options && result.options.length > 0 ? (
        <div style={{ ...card, padding: "1.25rem" }}>
            <p style={{ fontWeight: 800, fontSize: "1.05rem", margin: "0 0 0.3rem" }}>אין לך הרשמה לשיעור עכשיו</p>
            <p style={{ color: muted, fontSize: "0.88rem", margin: "0 0 1rem" }}>אפשר להירשם לשיעור שמתחיל עכשיו ולסמן הגעה:</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
                {result.options.map(o => (
                    <button key={o.session_id} type="button" disabled={busy} onClick={() => walkIn(o.session_id)}
                        style={{ ...card, borderRadius: 14, display: "flex", alignItems: "center", gap: "0.8rem", padding: "0.85rem 1rem", color: "#f1f5f9", cursor: "pointer", textAlign: "right", minHeight: 56 }}>
                        <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: "block", fontWeight: 700 }}>{o.name}</span>
                            <span dir="ltr" style={{ display: "block", fontSize: "0.82rem", color: muted, textAlign: "right" }}>{ilTime(o.starts_at)}</span>
                        </span>
                        <span style={{ background: primary, color: "#fff", borderRadius: 10, padding: "0.45rem 0.8rem", fontWeight: 800, fontSize: "0.85rem", flexShrink: 0 }}>
                            {busy ? "רגע…" : "להירשם ולסמן הגעה"}
                        </span>
                    </button>
                ))}
            </div>
        </div>
    ) : (
        <Message icon={<DoorOpen size={40} color={muted} />} title="אין לך שיעור עכשיו" text="פנו לדלפק ונשמח לעזור." />
    );

    return (
        <div dir="rtl" style={{ minHeight: "100vh", background: "#0f172a", color: "#f1f5f9", padding: "1.5rem 1rem 6rem" }}>
            <div style={{ maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", gap: "1rem" }}>
                <h1 style={{ fontSize: "1.2rem", fontWeight: 800, margin: 0, textAlign: "center" }}>{result?.studio ?? "צ׳ק-אין"}</h1>
                {body}
                {loggedIn && key && (
                    <Link href={`/b/${slug}/classes`} style={{ color: muted, textAlign: "center", fontSize: "0.88rem" }}>השיעורים שלי</Link>
                )}
            </div>
            <style>{`.spin{animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
    );
}

function Message({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
    return (
        <div role="status" style={{ ...card, padding: "2rem 1.25rem", textAlign: "center" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: "0.9rem" }}>{icon}</div>
            <p style={{ fontWeight: 800, fontSize: "1.25rem", margin: "0 0 0.5rem" }}>{title}</p>
            <p style={{ color: "#cbd5e1", margin: 0, whiteSpace: "pre-line", lineHeight: 1.7 }}>{text}</p>
        </div>
    );
}

export default function CheckinPage() {
    return <Suspense fallback={null}><Checkin /></Suspense>;
}
