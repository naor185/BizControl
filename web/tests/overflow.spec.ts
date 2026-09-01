import { test, expect, type Page } from "@playwright/test";
import { injectAuth, installApiMocks } from "./mockApi";

// The exact breakpoints requested — small-phone through large-phone.
const VIEWPORT_WIDTHS = [360, 375, 390, 412, 430];
const VIEWPORT_HEIGHT = 800;

type RouteSpec = {
    path: string;
    name: string;
    /** Extra interaction after load, e.g. switching to a tab that lazy-loads content. */
    afterLoad?: (page: Page) => Promise<void>;
};

// The app's main routes (AppShell's own MAIN_NAV) plus /login (public).
// Extending coverage to another route is just adding an entry here — reuses
// the same mocked backend and the same overflow check.
const ROUTES: RouteSpec[] = [
    { path: "/login", name: "login" },
    { path: "/dashboard", name: "dashboard" },
    { path: "/calendar", name: "calendar" },
    { path: "/pos", name: "pos" },
    { path: "/inbox", name: "inbox" },
    {
        path: "/clients",
        name: "clients — VIP club tab",
        afterLoad: async (page) => {
            await page.getByRole("button", { name: /מועדון VIP/ }).click();
            // let the club-tab's own fetches (stats/leaderboard/birthday-status) resolve and render
            await page.waitForTimeout(300);
        },
    },
];

/**
 * Runs in-page. Finds the outermost element(s) actually responsible for
 * document-level horizontal overflow — skips anything inside a container
 * that legitimately owns its own horizontal scroll (overflow-x: auto/scroll
 * — e.g. a wide table's wrapper), since that never inflates
 * document.documentElement.scrollWidth in the first place and is explicitly
 * allowed. Only used to build a helpful failure message; the pass/fail
 * signal itself is the plain scrollWidth/innerWidth comparison below.
 */
function findOverflowCulprits() {
    const clientWidth = document.documentElement.clientWidth;

    function isContainedByScrollable(el: Element): boolean {
        let p = el.parentElement;
        while (p && p !== document.body) {
            const cs = getComputedStyle(p);
            const scrollable = cs.overflowX === "auto" || cs.overflowX === "scroll";
            const pRect = p.getBoundingClientRect();
            if (scrollable && pRect.right <= clientWidth + 1 && pRect.left >= -1) return true;
            p = p.parentElement;
        }
        return false;
    }

    const offenders: Element[] = [];
    document.querySelectorAll("body *").forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0) return;
        if (rect.right <= clientWidth + 1 && rect.left >= -1) return;
        if (isContainedByScrollable(el)) return;
        offenders.push(el);
    });

    // Report only the outermost offenders.
    const flagged = new Set(offenders);
    const roots = offenders.filter((el) => {
        let p = el.parentElement;
        while (p) {
            if (flagged.has(p)) return false;
            p = p.parentElement;
        }
        return true;
    });

    return roots.map((el) => {
        const rect = el.getBoundingClientRect();
        return {
            tag: el.tagName.toLowerCase(),
            className: (el as HTMLElement).className ? String((el as HTMLElement).className) : "(none)",
            overflowByPx: Math.round(Math.max(rect.right - clientWidth, -rect.left)),
        };
    });
}

for (const route of ROUTES) {
    for (const width of VIEWPORT_WIDTHS) {
        test(`${route.name} @ ${width}px — no page-level horizontal overflow`, async ({ page }) => {
            await installApiMocks(page);
            await injectAuth(page);
            await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
            await page.goto(route.path);
            await page.waitForLoadState("networkidle");
            if (route.afterLoad) await route.afterLoad(page);

            // NOTE: document.documentElement.scrollWidth is NOT usable here —
            // Chromium special-cases the root scrolling element so that once
            // overflow-x is "hidden" on <html> (our own global safety net,
            // see globals.css), its scrollWidth collapses to clientWidth no
            // matter how much real content overflows. It would silently
            // report "no overflow" even when there plainly is — exactly the
            // trap of a test that ends up relying on the safety net to hide
            // the bug it's supposed to catch. document.body.scrollWidth is a
            // regular (non-root) element and correctly reports true content
            // extent regardless of its own overflow-x, confirmed empirically
            // against a deliberately-injected 2000px-wide element.
            const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
            const innerWidth = await page.evaluate(() => window.innerWidth);

            if (scrollWidth > innerWidth) {
                const culprits = await page.evaluate(findOverflowCulprits);
                const report = culprits.length
                    ? culprits.map((c) => `  <${c.tag} class="${c.className}"> — overflows by ${c.overflowByPx}px`).join("\n")
                    : "  (could not isolate a single element — likely several small ones together)";
                throw new Error(
                    `Horizontal overflow on route "${route.path}" at ${width}px viewport.\n` +
                    `  document.body.scrollWidth = ${scrollWidth}, window.innerWidth = ${innerWidth}\n` +
                    `Offending element(s):\n${report}`
                );
            }

            // Contained horizontal scroll inside an explicit overflow-x-auto
            // container (tables) never shows up in scrollWidth, so this
            // assertion passing does NOT mean those containers can't scroll —
            // only that the page itself never shifts left/right.
            expect(scrollWidth, "the page itself must never be wider than the viewport").toBeLessThanOrEqual(innerWidth);
        });
    }
}
