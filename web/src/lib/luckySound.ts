// Lucky Club's sounds, made in the browser (Web Audio) — no sound files: the wheel's tick, the winner's fanfare, a
// drum roll while it spins, and an optional soft music loop (off until the host turns it on). The audio starts on the
// host's first click (browsers allow sound only after one).

type Ctx = AudioContext;
let ctx: Ctx | null = null;

export function audio(): Ctx | null {
    if (typeof window === "undefined") return null;
    try {
        if (!ctx) {
            const A = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            ctx = new A();
        }
        if (ctx.state === "suspended") void ctx.resume();
        return ctx;
    } catch {
        return null;
    }
}

function tone(c: Ctx, freq: number, start: number, length: number, type: OscillatorType, gain: number) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, start + length);
    o.connect(g).connect(c.destination);
    o.start(start);
    o.stop(start + length + 0.02);
}

/** The wheel passing a peg. */
export function tick() {
    const c = audio();
    if (!c) return;
    tone(c, 1650, c.currentTime, 0.045, "square", 0.05);
}

/** The winner — a rising arpeggio and a held chord. */
export function fanfare() {
    const c = audio();
    if (!c) return;
    const t = c.currentTime + 0.02;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, f, t + i * 0.12, 0.28, "triangle", 0.16));
    [523.25, 659.25, 783.99, 1046.5].forEach(f => tone(c, f, t + 0.55, 1.4, "triangle", 0.09));
    [261.63, 392].forEach(f => tone(c, f, t + 0.55, 1.4, "sine", 0.12));
}

/** A drum roll for `seconds` — soft noise bursts that speed up. */
export function drumRoll(seconds: number) {
    const c = audio();
    if (!c) return;
    const len = Math.floor(c.sampleRate * 0.05);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    let t = c.currentTime;
    const end = t + seconds;
    let gap = 0.11;
    while (t < end) {
        const s = c.createBufferSource();
        const g = c.createGain();
        const f = c.createBiquadFilter();
        f.type = "bandpass";
        f.frequency.value = 900;
        s.buffer = buf;
        g.gain.value = 0.06;
        s.connect(f).connect(g).connect(c.destination);
        s.start(t);
        t += gap;
        gap = Math.max(0.045, gap * 0.985);
    }
}

/** A gentle music loop (I–V–vi–IV, arpeggiated) — start() / stop(). */
export class Music {
    private timer: ReturnType<typeof setInterval> | null = null;
    private step = 0;
    private readonly chords = [[261.63, 329.63, 392], [196, 246.94, 293.66], [220, 261.63, 329.63], [174.61, 220, 261.63]];

    start() {
        const c = audio();
        if (!c || this.timer) return;
        this.timer = setInterval(() => {
            const ac = audio();
            if (!ac) return;
            const chord = this.chords[Math.floor(this.step / 8) % this.chords.length];
            const note = chord[this.step % 3] * (this.step % 8 >= 4 ? 2 : 1);
            tone(ac, note, ac.currentTime, 0.32, "sine", 0.035);
            if (this.step % 8 === 0) tone(ac, chord[0] / 2, ac.currentTime, 1.4, "sine", 0.04);
            this.step++;
        }, 230);
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }
}
