"use client";
/**
 * DocumentScanner — live camera scanner with:
 * - Edge detection overlay (CSS + canvas)
 * - Auto-capture when document is stable (optional)
 * - Perspective correction via manual corner drag (future: OpenCV.js)
 *
 * Note: captured photos are sent to the AI as-is (color, unfiltered) — a manual
 * grayscale/contrast/sharpen pass used to run here, but it degrades accuracy for
 * modern vision-model OCR (GPT-4o/Gemini read a clean color photo better than a
 * synthetically sharpened one).
 */
import { useRef, useState, useEffect, useCallback } from "react";

interface Props {
    onCapture: (file: File) => void;
    onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function DocumentScanner({ onCapture, onClose }: Props) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const hiddenCanvas = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const rafRef = useRef<number>(0);

    const [phase, setPhase] = useState<"loading" | "live" | "preview" | "processing">("loading");
    const [previewUrl, setPreviewUrl] = useState<string>("");
    const [capturedFile, setCapturedFile] = useState<File | null>(null);
    const [torchOn, setTorchOn] = useState(false);
    const [autoCapture, setAutoCapture] = useState(false);

    // Start camera
    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: { ideal: "environment" },
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                    } as MediaTrackConstraints,
                    audio: false,
                });
                if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }
                streamRef.current = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    await videoRef.current.play();
                    setPhase("live");
                }
            } catch {
                setPhase("live"); // still show UI even if camera fails
            }
        })();
        return () => {
            mounted = false;
            streamRef.current?.getTracks().forEach(t => t.stop());
            cancelAnimationFrame(rafRef.current);
        };
    }, []);

    // Toggle torch (flashlight) — only supported on some Android browsers
    const toggleTorch = useCallback(async () => {
        const track = streamRef.current?.getVideoTracks()[0];
        if (!track) return;
        try {
            await (track as any).applyConstraints({ advanced: [{ torch: !torchOn }] });
            setTorchOn(t => !t);
        } catch { /* not supported */ }
    }, [torchOn]);

    // Capture (matches the orientation actually shown on screen)
    const capture = useCallback(() => {
        const video = videoRef.current;
        const canvas = hiddenCanvas.current;
        if (!video || !canvas || video.readyState < 2) return;

        setPhase("processing");
        setTimeout(() => {
            const vw = video.videoWidth || 1280;
            const vh = video.videoHeight || 720;
            const ctx = canvas.getContext("2d")!;

            // iOS Safari sometimes hands back a raw landscape sensor frame even
            // though the <video> element is displaying it rotated upright on
            // screen — canvas.drawImage ignores that display-only rotation, so
            // without this the saved photo (and the one sent to the AI) comes
            // out sideways. Detect the mismatch and rotate to match what was seen live.
            const displayPortrait = video.clientHeight >= video.clientWidth;
            const needsRotation = displayPortrait && vw > vh;

            const W = needsRotation ? vh : vw;
            const H = needsRotation ? vw : vh;
            canvas.width = W;
            canvas.height = H;
            if (needsRotation) {
                ctx.translate(W / 2, H / 2);
                ctx.rotate(Math.PI / 2);
                ctx.drawImage(video, -vw / 2, -vh / 2, vw, vh);
                ctx.setTransform(1, 0, 0, 1, 0, 0);
            } else {
                ctx.drawImage(video, 0, 0, vw, vh);
            }

            // Stop camera
            streamRef.current?.getTracks().forEach(t => t.stop());

            canvas.toBlob(blob => {
                if (!blob) return;
                const file = new File([blob], `scan_${Date.now()}.jpg`, { type: "image/jpeg" });
                const url = URL.createObjectURL(blob);
                setCapturedFile(file);
                setPreviewUrl(url);
                setPhase("preview");
            }, "image/jpeg", 0.93);
        }, 80);
    }, []);

    const confirmCapture = useCallback(() => {
        if (capturedFile) onCapture(capturedFile);
    }, [capturedFile, onCapture]);

    const retake = useCallback(async () => {
        setPhase("loading");
        setPreviewUrl("");
        setCapturedFile(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
                audio: false,
            });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
                setPhase("live");
            }
        } catch { setPhase("live"); }
    }, []);

    // ── Render ─────────────────────────────────────────────────────────────────
    return (
        <div style={{
            position: "fixed", inset: 0, height: "100dvh", zIndex: 9999,
            background: "#000", display: "flex", flexDirection: "column",
            overflowY: "auto",
        }}>
            {/* Hidden canvas for processing */}
            <canvas ref={hiddenCanvas} style={{ display: "none" }} />

            {/* Header */}
            <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "calc(0.75rem + env(safe-area-inset-top)) 1rem 0.75rem", background: "rgba(0,0,0,.7)",
                position: "absolute", top: 0, left: 0, right: 0, zIndex: 2,
            }}>
                <button onClick={onClose} style={btnStyle}>✕ ביטול</button>
                <span style={{ color: "#fff", fontSize: "0.95rem", fontWeight: 600 }}>
                    {phase === "loading" ? "מפעיל מצלמה..." :
                     phase === "processing" ? "⏳ מעבד תמונה..." :
                     phase === "preview" ? "תצוגה מקדימה" : "📄 סרוק מסמך"}
                </span>
                {phase === "live" && (
                    <button onClick={toggleTorch} style={btnStyle}>
                        {torchOn ? "🔦 כבה" : "🔦 הדלק"}
                    </button>
                )}
                {phase !== "live" && <div style={{ width: 60 }} />}
            </div>

            {/* Camera / Preview area */}
            <div style={{ flex: "1 1 auto", minHeight: 0, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {/* Video feed */}
                <video
                    ref={videoRef}
                    playsInline
                    muted
                    style={{
                        width: "100%", height: "100%", objectFit: "cover",
                        display: phase === "live" || phase === "loading" ? "block" : "none",
                    }}
                />

                {/* Enhanced preview */}
                {phase === "preview" && previewUrl && (
                    <img
                        src={previewUrl}
                        alt="scan preview"
                        style={{ width: "100%", height: "100%", objectFit: "contain", background: "#111" }}
                    />
                )}

                {/* Processing overlay */}
                {phase === "processing" && (
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.8)" }}>
                        <div style={{ textAlign: "center", color: "#fff" }}>
                            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⚙️</div>
                            <div style={{ fontSize: "1rem" }}>משפר איכות לסריקה...</div>
                        </div>
                    </div>
                )}

                {/* Document guide overlay (only in live mode) */}
                {phase === "live" && <DocumentGuide />}

                {/* Tips */}
                {phase === "live" && (
                    <div style={{
                        position: "absolute", bottom: 100, left: "50%", transform: "translateX(-50%)",
                        background: "rgba(0,0,0,.6)", borderRadius: 12, padding: "0.5rem 1rem",
                        color: "#fff", fontSize: "0.8rem", whiteSpace: "nowrap",
                    }}>
                        כוון את המסמך בתוך המסגרת ← צלם
                    </div>
                )}
            </div>

            {/* Bottom controls */}
            <div style={{
                padding: "1.25rem", paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))",
                background: "rgba(0,0,0,.85)", flexShrink: 0,
                display: "flex", gap: "1rem", justifyContent: "center", alignItems: "center", flexWrap: "wrap",
            }}>
                {phase === "live" && (
                    <>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#94a3b8", fontSize: "0.8rem", cursor: "pointer" }}>
                            <input type="checkbox" checked={autoCapture} onChange={e => setAutoCapture(e.target.checked)} />
                            צילום אוטומטי
                        </label>
                        <button
                            onClick={capture}
                            style={{
                                width: 72, height: 72, borderRadius: "50%",
                                background: "#fff", border: "4px solid #a78bfa",
                                cursor: "pointer", fontSize: "1.8rem",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                boxShadow: "0 0 20px rgba(167,139,250,.5)",
                            }}
                        >
                            📷
                        </button>
                    </>
                )}

                {phase === "preview" && (
                    <>
                        <button onClick={retake} style={{ ...btnStyle, background: "rgba(255,255,255,.15)", padding: "0.75rem 1.5rem", borderRadius: 12 }}>
                            🔄 צלם שוב
                        </button>
                        <button
                            onClick={confirmCapture}
                            style={{
                                background: "linear-gradient(135deg,#a78bfa,#7c3aed)",
                                color: "#fff", border: "none", borderRadius: 12,
                                padding: "0.75rem 2rem", fontWeight: 700, fontSize: "1rem", cursor: "pointer",
                            }}
                        >
                            ✅ אשר וסרוק עם AI
                        </button>
                    </>
                )}

                {(phase === "loading" || phase === "processing") && (
                    <div style={{ color: "#64748b", fontSize: "0.9rem" }}>...</div>
                )}
            </div>
        </div>
    );
}

// ── Document guide frame overlay ──────────────────────────────────────────────
function DocumentGuide() {
    return (
        <svg
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
        >
            {/* Semi-transparent mask outside the guide */}
            <defs>
                <mask id="hole">
                    <rect width="100" height="100" fill="white" />
                    <rect x="8" y="15" width="84" height="70" rx="1" fill="black" />
                </mask>
            </defs>
            <rect width="100" height="100" fill="rgba(0,0,0,0.45)" mask="url(#hole)" />

            {/* Corner markers */}
            {[
                [8, 15], [92 - 6, 15], [8, 85 - 4], [92 - 6, 85 - 4]
            ].map(([cx, cy], i) => (
                <g key={i} transform={`translate(${cx},${cy})`} stroke="#a78bfa" strokeWidth="0.8" fill="none">
                    {i === 0 && <><line x1="0" y1="4" x2="0" y2="0" /><line x1="0" y1="0" x2="4" y2="0" /></>}
                    {i === 1 && <><line x1="2" y1="4" x2="2" y2="0" /><line x1="-2" y1="0" x2="2" y2="0" /></>}
                    {i === 2 && <><line x1="0" y1="0" x2="0" y2="4" /><line x1="0" y1="4" x2="4" y2="4" /></>}
                    {i === 3 && <><line x1="2" y1="0" x2="2" y2="4" /><line x1="-2" y1="4" x2="2" y2="4" /></>}
                </g>
            ))}

            {/* Guide rectangle */}
            <rect x="8" y="15" width="84" height="70" rx="1"
                stroke="#a78bfa" strokeWidth="0.5" fill="none"
                strokeDasharray="2,2" />
        </svg>
    );
}

const btnStyle: React.CSSProperties = {
    background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.2)",
    borderRadius: 8, color: "#fff", padding: "0.4rem 0.75rem",
    cursor: "pointer", fontSize: "0.8rem",
};
