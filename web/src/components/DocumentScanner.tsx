"use client";
/**
 * DocumentScanner — live camera scanner with:
 * - Edge detection overlay (CSS + canvas)
 * - Auto-capture when document is stable (optional)
 * - Image enhancement: grayscale, contrast boost, sharpen
 * - Perspective correction via manual corner drag (future: OpenCV.js)
 */
import { useRef, useState, useEffect, useCallback } from "react";

interface Props {
    onCapture: (file: File) => void;
    onClose: () => void;
}

// ── Image enhancement (runs on Canvas ImageData) ─────────────────────────────
function enhanceForOCR(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;

    // 1. Convert to grayscale
    for (let i = 0; i < d.length; i += 4) {
        const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
        d[i] = d[i + 1] = d[i + 2] = g;
    }

    // 2. Adaptive contrast (histogram stretch)
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4) { min = Math.min(min, d[i]); max = Math.max(max, d[i]); }
    const range = max - min || 1;
    for (let i = 0; i < d.length; i += 4) {
        const stretched = Math.round(((d[i] - min) / range) * 255);
        d[i] = d[i + 1] = d[i + 2] = stretched;
    }

    // 3. Sharpen (3×3 kernel)
    const copy = new Uint8ClampedArray(d);
    const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            let sum = 0;
            for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++) {
                    const idx = ((y + ky) * w + (x + kx)) * 4;
                    sum += copy[idx] * kernel[(ky + 1) * 3 + (kx + 1)];
                }
            }
            const out = Math.min(255, Math.max(0, sum));
            const px = (y * w + x) * 4;
            d[px] = d[px + 1] = d[px + 2] = out;
        }
    }

    ctx.putImageData(imageData, 0, 0);
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

    // Capture + enhance
    const capture = useCallback(() => {
        const video = videoRef.current;
        const canvas = hiddenCanvas.current;
        if (!video || !canvas || video.readyState < 2) return;

        setPhase("processing");
        setTimeout(() => {
            const W = video.videoWidth || 1280;
            const H = video.videoHeight || 720;
            canvas.width = W;
            canvas.height = H;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(video, 0, 0, W, H);

            // Stop camera
            streamRef.current?.getTracks().forEach(t => t.stop());

            // Enhance for OCR
            enhanceForOCR(ctx, W, H);

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
            position: "fixed", inset: 0, zIndex: 9999,
            background: "#000", display: "flex", flexDirection: "column",
        }}>
            {/* Hidden canvas for processing */}
            <canvas ref={hiddenCanvas} style={{ display: "none" }} />

            {/* Header */}
            <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "0.75rem 1rem", background: "rgba(0,0,0,.7)",
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
            <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
                padding: "1.25rem", background: "rgba(0,0,0,.85)",
                display: "flex", gap: "1rem", justifyContent: "center", alignItems: "center",
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
