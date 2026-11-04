"use client";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";

// Lucky Club's wheel (the owner's spec, 2026-11-04): the names on coloured slices, bulbs around the rim that chase while
// it spins, a pointer at the top that kicks on every peg. It only shows — spinTo(i) turns it, slowing down, until slice
// i stops under the pointer; which slice is the server's winner (app/services/lucky_draw).

export type WheelHandle = { spinTo: (index: number) => Promise<void> };

const SLICES = ["#f59e0b", "#7c3aed", "#0ea5e9", "#ec4899", "#10b981", "#ef4444", "#6366f1", "#14b8a6"];
const DARK_TEXT = new Set(["#f59e0b", "#0ea5e9", "#10b981", "#14b8a6"]);

const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);

function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
    if (ctx.measureText(text).width <= max) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + "…").width > max) t = t.slice(0, -1);
    return t + "…";
}

type Props = { labels: string[]; onTick?: () => void; reducedMotion?: boolean };

const Wheel = forwardRef<WheelHandle, Props>(function Wheel({ labels, onTick, reducedMotion = false }, ref) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const box = useRef<HTMLDivElement>(null);
    const theta = useRef(0);                 // the wheel's turn
    const spinning = useRef(false);
    const kick = useRef(0);                  // the pointer's kick on a peg, fading
    const labelsRef = useRef(labels);
    const onTickRef = useRef(onTick);
    useEffect(() => { labelsRef.current = labels; onTickRef.current = onTick; }, [labels, onTick]);

    const draw = useCallback((now: number) => {
        const cv = canvas.current;
        if (!cv) return;
        const c = cv.getContext("2d");
        if (!c) return;
        const dpr = window.devicePixelRatio || 1;
        const size = cv.clientWidth;
        if (cv.width !== Math.round(size * dpr)) { cv.width = Math.round(size * dpr); cv.height = Math.round(size * dpr); }
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, size, size);

        const names = labelsRef.current.length ? labelsRef.current : ["…"];
        const n = names.length;
        const cx = size / 2, cy = size / 2 + size * 0.02;
        const rim = size * 0.46, r = rim - size * 0.035;
        const a = (Math.PI * 2) / n;

        // the rim, with its bulbs
        c.save();
        c.beginPath();
        c.arc(cx, cy, rim, 0, Math.PI * 2);
        const ring = c.createLinearGradient(0, cy - rim, 0, cy + rim);
        ring.addColorStop(0, "#fde68a");
        ring.addColorStop(0.5, "#b45309");
        ring.addColorStop(1, "#fbbf24");
        c.fillStyle = ring;
        c.shadowColor = "rgba(251,191,36,0.55)";
        c.shadowBlur = size * 0.05;
        c.fill();
        c.restore();
        const bulbs = 28;
        const phase = Math.floor(now / (spinning.current ? 70 : 420));
        for (let i = 0; i < bulbs; i++) {
            const ba = (i / bulbs) * Math.PI * 2;
            const on = (i + phase) % 2 === 0;
            c.beginPath();
            c.arc(cx + Math.cos(ba) * (rim - size * 0.0175), cy + Math.sin(ba) * (rim - size * 0.0175), size * 0.0085, 0, Math.PI * 2);
            c.fillStyle = on ? "#fffbeb" : "#92400e";
            c.shadowColor = on ? "#fde68a" : "transparent";
            c.shadowBlur = on ? size * 0.02 : 0;
            c.fill();
        }
        c.shadowBlur = 0;

        // the slices and the names
        const font = getComputedStyle(cv).fontFamily || "sans-serif";
        const fontSize = Math.max(10, Math.min(size * 0.042, ((Math.PI * 2 * r) / n) * 0.42));
        for (let i = 0; i < n; i++) {
            const start = theta.current + i * a - Math.PI / 2;
            let color = SLICES[i % SLICES.length];
            if (i === n - 1 && n > 1 && n % SLICES.length === 1) color = SLICES[2];        // never two alike side by side
            c.beginPath();
            c.moveTo(cx, cy);
            c.arc(cx, cy, r, start, start + a);
            c.closePath();
            c.fillStyle = color;
            c.fill();
            c.strokeStyle = "rgba(255,255,255,0.35)";
            c.lineWidth = 1;
            c.stroke();

            // the name along its slice, from the rim inwards — turned over on the left half, so it never reads upside down
            const mid = start + a / 2;
            const left = Math.cos(mid) < 0;
            c.save();
            c.translate(cx, cy);
            c.rotate(left ? mid + Math.PI : mid);
            c.fillStyle = DARK_TEXT.has(color) ? "#1e1b4b" : "#ffffff";
            c.font = `700 ${fontSize}px ${font}`;
            c.textBaseline = "middle";
            c.direction = "rtl";
            c.textAlign = left ? "end" : "start";
            c.fillText(fit(c, names[i], r * 0.62), left ? -(r - size * 0.03) : r - size * 0.03, 0);
            c.restore();
        }

        // the hub
        const hub = c.createRadialGradient(cx - size * 0.02, cy - size * 0.02, size * 0.01, cx, cy, size * 0.085);
        hub.addColorStop(0, "#fef3c7");
        hub.addColorStop(1, "#d97706");
        c.beginPath();
        c.arc(cx, cy, size * 0.085, 0, Math.PI * 2);
        c.fillStyle = hub;
        c.shadowColor = "rgba(0,0,0,0.35)";
        c.shadowBlur = size * 0.02;
        c.fill();
        c.shadowBlur = 0;
        c.fillStyle = "#78350f";
        c.font = `900 ${size * 0.03}px ${font}`;
        c.textAlign = "center";
        c.direction = "ltr";
        c.fillText("LUCKY", cx, cy + size * 0.001);

        // the pointer, kicking on a peg
        kick.current *= 0.86;
        c.save();
        c.translate(cx, cy - rim + size * 0.005);
        c.rotate(-kick.current);
        c.beginPath();
        c.moveTo(-size * 0.035, -size * 0.045);
        c.lineTo(size * 0.035, -size * 0.045);
        c.lineTo(0, size * 0.05);
        c.closePath();
        const pg = c.createLinearGradient(0, -size * 0.045, 0, size * 0.05);
        pg.addColorStop(0, "#ffffff");
        pg.addColorStop(1, "#fbbf24");
        c.fillStyle = pg;
        c.shadowColor = "rgba(0,0,0,0.45)";
        c.shadowBlur = size * 0.015;
        c.fill();
        c.restore();
    }, []);

    // one loop draws it all — the bulbs keep chasing even at rest
    useEffect(() => {
        let raf = 0;
        const loop = (t: number) => { draw(t); raf = requestAnimationFrame(loop); };
        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [draw]);

    useImperativeHandle(ref, () => ({
        spinTo: (index: number) => new Promise<void>(resolve => {
            const n = Math.max(1, labelsRef.current.length);
            const a = (Math.PI * 2) / n;
            const from = theta.current;
            // slice `index` under the pointer (at the top), somewhere inside the slice — not always its middle
            const inside = (Math.random() - 0.5) * a * 0.6;
            let target = -(index * a + a / 2) - inside;
            const turns = reducedMotion ? 2 : 7 + Math.floor(Math.random() * 3);
            while (target <= from) target += Math.PI * 2;
            target += turns * Math.PI * 2;
            const duration = reducedMotion ? 1800 : 7500 + Math.random() * 1500;
            const start = performance.now();
            let lastPeg = Math.floor(from / a);
            spinning.current = true;
            const step = (now: number) => {
                const t = Math.min(1, (now - start) / duration);
                theta.current = from + (target - from) * easeOut(t);
                const peg = Math.floor(theta.current / a);
                if (peg !== lastPeg) {
                    lastPeg = peg;
                    kick.current = 0.35;
                    onTickRef.current?.();
                }
                if (t < 1) requestAnimationFrame(step);
                else { spinning.current = false; theta.current %= Math.PI * 2; resolve(); }
            };
            requestAnimationFrame(step);
        }),
    }), [reducedMotion]);

    return (
        <div ref={box} className="relative aspect-square w-full">
            <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden />
        </div>
    );
});

export default Wheel;
