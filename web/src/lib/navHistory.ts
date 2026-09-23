// Which pages of the app this browser tab has been through, so a screen can offer "back" only when
// there is an earlier page of the app to go back to (not on the first page after login, where
// router.back() would leave the app). Every page mounts its own AppShell, so this has to live in
// sessionStorage rather than in component state.
const KEY = "bizcontrol_nav_stack";
const MAX_PAGES = 50;

// True when the browser's own back/forward (which router.back() uses too) moved us to the page being
// recorded, as opposed to a click on a link. Lets "hub → catalog → hub link" count as a new step, not a return.
let arrivedByHistory = false;
if (typeof window !== "undefined") {
    window.addEventListener("popstate", () => { arrivedByHistory = true; });
}

function read(): string[] {
    try {
        const parsed = JSON.parse(sessionStorage.getItem(KEY) || "[]");
        return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
    } catch {
        return [];
    }
}

function write(stack: string[]) {
    try {
        sessionStorage.setItem(KEY, JSON.stringify(stack));
    } catch { /* storage unavailable — back simply stays hidden */ }
}

/** Call once per page view with the page's path. Returns true when an earlier page of the app exists. */
export function recordVisit(path: string): boolean {
    if (typeof window === "undefined" || !path) return false;
    const stack = read();
    const viaHistory = arrivedByHistory;
    arrivedByHistory = false;
    if (stack[stack.length - 1] !== path) {
        // Went back to the page before this one → drop the page we left; otherwise it is a new step.
        if (viaHistory && stack.length >= 2 && stack[stack.length - 2] === path) stack.pop();
        else stack.push(path);
        write(stack.slice(-MAX_PAGES));
    }
    return stack.length > 1;
}

/** Forget the trail (on logout), so the next login starts with no "back". */
export function clearNavHistory() {
    try {
        sessionStorage.removeItem(KEY);
    } catch { /* ignore */ }
}
