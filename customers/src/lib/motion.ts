// BizFind's motion, on every page (the owner, 2026-11-09: "the Apple animation on all of BizFind"). Two kinds:
// - .bfx-rise — comes in as the page opens (blur → sharp, rising), in turn by --delay. CSS only.
// - data-reveal="" — comes in when it is scrolled to, in turn by --d. components/Reveal.tsx arms it: a part already
//   on the screen stays as it is, one below it is hidden ("wait") until it is reached ("in"). Without the page's
//   script, or with the phone's reduce-motion setting, everything simply shows.
// .bfx-zoom grows into place instead of rising; .bfx-card lifts on hover. Colors stay in the --bf-* tokens.
export const MOTION_CSS = `
.bfx-rise { animation: bfx-rise 1s cubic-bezier(.2,.7,.2,1) both; animation-delay: var(--delay, 0ms); }
@keyframes bfx-rise { from { opacity: 0; transform: translateY(28px); filter: blur(6px); } to { opacity: 1; transform: none; filter: none; } }
[data-reveal] { transition: opacity 1s cubic-bezier(.2,.7,.2,1), transform 1s cubic-bezier(.2,.7,.2,1); transition-delay: var(--d, 0ms); }
[data-reveal="wait"] { opacity: 0; transform: translateY(48px); }
[data-reveal="wait"].bfx-zoom { transform: scale(.9); }
.bfx-card { height: 100%; transition: transform .35s ease, box-shadow .35s ease, border-color .35s ease; }
.bfx-card:hover { transform: translateY(-4px); box-shadow: 0 18px 40px rgb(var(--bf-text-rgb) / .08); }
@media (prefers-reduced-motion: reduce) {
  .bfx-rise { animation: none !important; }
  [data-reveal], .bfx-card { transition: none !important; }
}
`;
