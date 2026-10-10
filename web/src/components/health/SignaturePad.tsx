"use client";

import { useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";

// A signature with a finger or a pencil — pointer events, so it works the same on an iPad, an iPhone and with a mouse.
// onChange gives the signature as a PNG data URL, or null once cleared.
export default function SignaturePad({ label, onChange }: { label: string; onChange: (dataUrl: string | null) => void }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const last = useRef<{ x: number; y: number } | null>(null);
    const [empty, setEmpty] = useState(true);

    // the drawing at the screen's own sharpness, sized to the box
    useEffect(() => {
        const c = canvasRef.current;
        if (!c) return;
        const ratio = window.devicePixelRatio || 1;
        const box = c.getBoundingClientRect();
        c.width = Math.round(box.width * ratio);
        c.height = Math.round(box.height * ratio);
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.scale(ratio, ratio);
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#0f172a";
    }, []);

    const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const box = e.currentTarget.getBoundingClientRect();
        return { x: e.clientX - box.left, y: e.clientY - box.top };
    };
    const line = (from: { x: number; y: number }, to: { x: number; y: number }) => {
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
    };
    const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = at(e);
        last.current = p;
        line(p, { x: p.x + 0.1, y: p.y + 0.1 });          // a tap leaves a dot
    };
    const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!last.current) return;
        const p = at(e);
        line(last.current, p);
        last.current = p;
    };
    const up = () => {
        if (!last.current) return;
        last.current = null;
        setEmpty(false);
        onChange(canvasRef.current?.toDataURL("image/png") ?? null);
    };
    const clear = () => {
        const c = canvasRef.current;
        c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
        setEmpty(true);
        onChange(null);
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-semibold text-slate-700">{label}</span>
                <button type="button" onClick={clear} disabled={empty}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900 disabled:opacity-30">
                    <Eraser className="h-3.5 w-3.5" aria-hidden /> ניקוי
                </button>
            </div>
            <div className="relative">
                <canvas ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
                    aria-label={label}
                    className="w-full h-44 rounded-xl border-2 border-dashed border-slate-300 bg-white touch-none cursor-crosshair" />
                {empty && (
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">
                        לחתום כאן באצבע
                    </span>
                )}
            </div>
        </div>
    );
}
