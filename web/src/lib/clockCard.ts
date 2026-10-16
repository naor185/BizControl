// The attendance clock's barcode (app/services/nfc_clock.py) — the business's clock link as a QR code, and the card to
// hang at the door: the business's name, the barcode, how to use it. One place for the superadmin's card
// (components/admin/NfcClockAdmin) and the owner's (components/team/ClockCode).

export async function clockQr(link: string): Promise<string> {
    const m = await import("qrcode");
    return m.default.toDataURL(link, { width: 640, margin: 1, errorCorrectionLevel: "M" });
}

const esc = (t: string) => t.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch] as string));

const TITLE = "החתמת נוכחות";
const HOW = "סורקים עם המצלמה של הטלפון";
const WHEN = "בכניסה לעבודה ובסוף היום — כניסה ויציאה";

/** The card as a picture — to download, or attach in WhatsApp. */
export async function clockCardPng(qr: string, studioName: string): Promise<string> {
    const img = new Image();
    img.src = qr;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 1000;
    c.height = 1300;
    const g = c.getContext("2d")!;
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, c.width, c.height);
    g.direction = "rtl";
    g.textAlign = "center";
    g.fillStyle = "#0f172a";
    g.font = "bold 64px Arial, sans-serif";
    g.fillText(TITLE, 500, 130);
    g.font = "44px Arial, sans-serif";
    g.fillStyle = "#334155";
    g.fillText(studioName, 500, 205);
    g.drawImage(img, 180, 260, 640, 640);
    g.font = "bold 38px Arial, sans-serif";
    g.fillStyle = "#0f172a";
    g.fillText(HOW, 500, 990);
    g.font = "34px Arial, sans-serif";
    g.fillStyle = "#475569";
    g.fillText(WHEN, 500, 1050);
    g.fillText("(או נוגעים בטלפון במדבקה, אם יש)", 500, 1100);
    g.font = "26px Arial, sans-serif";
    g.fillStyle = "#94a3b8";
    g.fillText("BizControl", 500, 1230);
    return c.toDataURL("image/png");
}

export async function downloadClockCard(qr: string, studioName: string): Promise<void> {
    const a = document.createElement("a");
    a.href = await clockCardPng(qr, studioName);
    a.download = `שעון נוכחות - ${studioName || "העסק"}.png`;
    a.click();
}

/** The card in a print window. False when the browser blocked the window. */
export function printClockCard(qr: string, studioName: string): boolean {
    const w = window.open("", "_blank", "width=720,height=900");
    if (!w) return false;
    w.document.write(`<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>${TITLE} · ${esc(studioName)}</title>
<style>body{font-family:Arial,sans-serif;text-align:center;padding:40px;color:#111}h1{font-size:36px;margin:0 0 6px}h2{font-size:24px;font-weight:normal;margin:0 0 24px;color:#333}img{width:420px;height:420px}p{font-size:20px;margin:18px 0 4px}small{display:block;font-size:16px;color:#555}</style>
</head><body><h1>${TITLE}</h1><h2>${esc(studioName)}</h2><img src="${qr}" alt="ברקוד להחתמת נוכחות"><p><b>${HOW}</b></p><small>${WHEN}</small>
<script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
    return true;
}
