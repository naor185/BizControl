// ויקי's voice in the guide (components/tour/TourProvider). The owner records each sentence of the recording script
// (on the owner's Desktop: "ויקי - טקסטים להקלטה.txt", clips 01–68) and the files go to web/public/viki-voice/NN.mp3 (mono,
// 96k). A clip belongs to one thing the guide says: a path's welcome (the path's id), a step's opening (the step's id),
// what to do on its screen (step:target), the praise (step:done), a path's end (path:finish) and the offer of the
// next path (path:next) — one clip, or a few said one after the other ("23 24"). Only recorded clips are listed — the
// rest stay text only.

export const VOICE: Record<string, string> = {
    owner_start: "01",
    business: "02",
    "business:logo-upload": "03",
    "business:business-address": "04",
    "business:done": "05",
    service: "06",
    "service:service-new": "07",
    "service:service-form": "08",
    "service:done": "09",
    client: "10",
    "client:client-new": "11",
    "client:client-form": "12",
    "client:done": "13",
    appointment: "14",
    "appointment:calendar-grid": "15",
    "appointment:appointment-new": "16",
    "appointment:type-appointment": "17",
    "appointment:appointment-form": "18",
    "appointment:done": "19",
    payment: "20",
    "payment:pay-bit": "21",
    "payment:done": "22",
    "owner_start:finish": "23",
    "owner_start:next": "23",          // "כל הכבוד, סיימת…" — then 24, the offer of "ההודעות ללקוחות", once it's recorded
};

const clipsOf = (key: string): string[] => (VOICE[key] ? VOICE[key].split(" ").map(n => `/viki-voice/${n}.mp3`) : []);

/** Whether a path has any recorded clip — its welcome, its end, or one of its steps. */
export const hasVoice = (tourId: string, stepIds: string[]): boolean =>
    Object.keys(VOICE).some(k => { const head = k.split(":")[0]; return head === tourId || stepIds.includes(head); });

const KEY = "viki_voice";
export const voiceOn = (): boolean => { try { return localStorage.getItem(KEY) !== "0"; } catch { return true; } };
export const saveVoiceOn = (on: boolean): void => { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* fine */ } };

// One voice for the whole app: the guide is mounted again on every screen, and she shouldn't repeat herself or talk
// over herself.
const said = new Set<string>();
let playing: HTMLAudioElement | null = null;
let last: string[] = [];

export const alreadySaid = (key: string): boolean => said.has(key);
export const forgetSaid = (): void => said.clear();
export const stopVoice = (): void => { playing?.pause(); };

/** Says the clips one after the other (what isn't recorded is skipped); `held` — the browser held the sound back
 *  until a tap. */
export function say(keys: string[], held: (yes: boolean) => void): void {
    last = keys.filter(k => VOICE[k]);
    const queue = last.flatMap(k => clipsOf(k).map(src => ({ k, src })));
    playing?.pause();
    const next = () => {
        const clip = queue.shift();
        if (!clip) return;
        said.add(clip.k);
        const a = new Audio(clip.src);
        playing = a;
        a.onended = next;
        a.play().then(() => held(false)).catch(() => held(true));
    };
    next();
}

/** What she said last, again — after the browser held it back. */
export const sayAgain = (held: (yes: boolean) => void): void => say(last, held);
