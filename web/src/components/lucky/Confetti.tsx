"use client";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

// Lucky Club's confetti — paper pieces bursting from the top when a winner is revealed. burst() starts one; the canvas
// draws only while pieces are falling.

export type ConfettiHandle = { burst: () => void };

type Piece = { x: number; y: number; vx: number; vy: number; w: number; h: number; rot: number; vr: number; color: string; life: number };

const COLORS = ["#fbbf24", "#f472b6", "#a78bfa", "#38bdf8", "#34d399", "#fb7185", "#fde68a", "#ffffff"];

const Confetti = forwardRef<ConfettiHandle, { reducedMotion?: boolean }>(function Confetti({ reducedMotion = false }, ref) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const pieces = useRef<Piece[]>([]);
    const running = useRef(false);

    const loop = useCallback(function step() {
        const cv = canvas.current;
        const c = cv?.getContext("2d");
        if (!cv || !c) { running.current = false; return; }
        const dpr = window.devicePixelRatio || 1;
        const w = cv.clientWidth, h = cv.clientHeight;
        if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, w, h);
        pieces.current = pieces.current.filter(p => p.life > 0 && p.y < h + 40);
        for (const p of pieces.current) {
            p.vy += 0.12;
            p.vx *= 0.992;
            p.x += p.vx;
            p.y += p.vy;
            p.rot += p.vr;
            p.life -= 1;
            c.save();
            c.translate(p.x, p.y);
            c.rotate(p.rot);
            c.globalAlpha = Math.min(1, p.life / 60);
            c.fillStyle = p.color;
            c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 2)));
            c.restore();
        }
        if (pieces.current.length) requestAnimationFrame(step);
        else running.current = false;
    }, []);

    useImperativeHandle(ref, () => ({
        burst: () => {
            const cv = canvas.current;
            if (!cv) return;
            const w = cv.clientWidth;
            const count = reducedMotion ? 60 : 220;
            for (let i = 0; i < count; i++) {
                const fromLeft = i % 2 === 0;
                pieces.current.push({
                    x: fromLeft ? w * 0.15 : w * 0.85, y: -10,
                    vx: (fromLeft ? 1 : -1) * (2 + Math.random() * 6) + (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 5,
                    w: 6 + Math.random() * 8, h: 8 + Math.random() * 10, rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
                    color: COLORS[Math.floor(Math.random() * COLORS.length)], life: 260 + Math.random() * 120,
                });
            }
            if (!running.current) { running.current = true; requestAnimationFrame(loop); }
        },
    }), [reducedMotion, loop]);

    return <canvas ref={canvas} className="pointer-events-none fixed inset-0 z-[80] h-full w-full" aria-hidden />;
});

export default Confetti;
