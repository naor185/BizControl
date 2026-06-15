import type { Metadata } from "next";

const API = (process.env.NEXT_PUBLIC_API_URL || "https://api.biz-control.com").replace(/\/$/, "");

export async function generateMetadata(
    { params }: { params: { id: string } }
): Promise<Metadata> {
    try {
        const data = await fetch(
            `${API}/api/public/receipts/${params.id}`,
            { next: { revalidate: 60 } }
        ).then(r => r.ok ? r.json() : null);

        if (!data) return { title: "קבלה — BizControl" };

        const logoUrl = data.business_logo_url || null;
        const businessName = data.business_name || "BizControl";
        const title = `קבלה — ${businessName}`;

        return {
            title,
            openGraph: {
                title,
                images: logoUrl ? [{ url: logoUrl, width: 400, height: 400 }] : [],
            },
        };
    } catch {
        return { title: "קבלה — BizControl" };
    }
}

export default function ReceiptLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
