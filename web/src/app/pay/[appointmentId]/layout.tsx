import type { Metadata } from "next";

const API = (process.env.NEXT_PUBLIC_API_URL || "https://api.biz-control.com").replace(/\/$/, "");

export async function generateMetadata(
    { params }: { params: Promise<{ appointmentId: string }> }
): Promise<Metadata> {
    try {
        // a Promise since Next 15 — read as a plain object it was always empty, and the link's preview never had the
        // business's title and logo (2026-10-27)
        const { appointmentId } = await params;
        const data = await fetch(
            `${API}/api/public/payment/${appointmentId}`,
            { next: { revalidate: 60 } }
        ).then(r => r.ok ? r.json() : null);

        if (!data) return { title: "תשלום — BizControl", robots: { index: false, follow: false } };

        // a logo in the cloud is a full address; one on this server, a file name
        const logoUrl = data.logo_filename ? (String(data.logo_filename).startsWith("http") ? data.logo_filename : `${API}/uploads/${data.logo_filename}`) : null;
        const en = data.locale === "en";           // the business's language
        const title = data.appointment_title
            ? (en ? `Payment for ${data.appointment_title}` : `תשלום עבור ${data.appointment_title}`)
            : (en ? "Payment confirmation" : "אישור תשלום");

        return {
            title,
            robots: { index: false, follow: false },   // a private link — never in a search engine
            openGraph: {
                title,
                images: logoUrl ? [{ url: logoUrl, width: 400, height: 400 }] : [],
            },
        };
    } catch {
        return { title: "תשלום — BizControl", robots: { index: false, follow: false } };
    }
}

export default function PayLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
