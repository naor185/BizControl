import type { Metadata } from "next";

const API = (process.env.NEXT_PUBLIC_API_URL || "https://api.biz-control.com").replace(/\/$/, "");

export async function generateMetadata(
    { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
    try {
        const { id } = await params;          // a Promise since Next 15 (read plainly it was empty — 2026-10-27)
        const data = await fetch(
            `${API}/api/public/receipts/${id}`,
            { next: { revalidate: 60 } }
        ).then(r => r.ok ? r.json() : null);

        if (!data) return { title: "קבלה — BizControl", robots: { index: false, follow: false } };

        const logoUrl = data.business_logo_url || null;
        const businessName = data.business_name || "BizControl";
        const title = `קבלה — ${businessName}`;

        return {
            title,
            robots: { index: false, follow: false },   // a private link — never in a search engine
            openGraph: {
                title,
                images: logoUrl ? [{ url: logoUrl, width: 400, height: 400 }] : [],
            },
        };
    } catch {
        return { title: "קבלה — BizControl", robots: { index: false, follow: false } };
    }
}

export default function ReceiptLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
