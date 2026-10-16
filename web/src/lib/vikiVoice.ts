// ויקי's voice in the guide (components/tour/TourProvider). The owner records each sentence of the recording script
// (on the owner's Desktop: "ויקי - טקסטים להקלטה.txt", clips 01–68) and the files go to web/public/viki-voice/NN.mp3 (mono,
// 96k). A clip belongs to one thing the guide says: a path's welcome (the path's id), a step's opening (the step's id),
// what to do on its screen (step:target), the praise (step:done), a path's end (path:finish) and the offer of the
// next path (path:next). Only recorded clips are listed — the rest stay text only.

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
};

export const voiceSrc = (key: string | null): string | null => (key && VOICE[key] ? `/viki-voice/${VOICE[key]}.mp3` : null);

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
    const queue = keys.filter(k => voiceSrc(k));
    last = [...queue];
    playing?.pause();
    const next = () => {
        const k = queue.shift();
        if (!k) return;
        said.add(k);
        const a = new Audio(voiceSrc(k)!);
        playing = a;
        a.onended = next;
        a.play().then(() => held(false)).catch(() => held(true));
    };
    next();
}

/** What she said last, again — after the browser held it back. */
export const sayAgain = (held: (yes: boolean) => void): void => say(last, held);
