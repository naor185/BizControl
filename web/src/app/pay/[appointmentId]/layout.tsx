import type { Metadata } from "next";

const API = (process.env.NEXT_PUBLIC_API_URL || "https://api.biz-control.com").replace(/\/$/, "");

export async function generateMetadata(
    { params }: { params: { appointmentId: string } }
): Promise<Metadata> {
    try {
        const data = await fetch(
            `${API}/api/public/payment/${params.appointmentId}`,
            { next: { revalidate: 60 } }
        ).then(r => r.ok ? r.json() : null);

        if (!data) return { title: "תשלום — BizControl" };

        const logoUrl = data.logo_filename ? `${API}/uploads/${data.logo_filename}` : null;
        const title = data.appointment_title
            ? `תשלום עבור ${data.appointment_title}`
            : "אישור תשלום";

        return {
            title,
            openGraph: {
                title,
                images: logoUrl ? [{ url: logoUrl, width: 400, height: 400 }] : [],
            },
        };
    } catch {
        return { title: "תשלום — BizControl" };
    }
}

export default function PayLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
