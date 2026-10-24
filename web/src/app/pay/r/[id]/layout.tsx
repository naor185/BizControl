import type { Metadata } from "next";

// a private link — never in a search engine
export const metadata: Metadata = { title: "תשלום", robots: { index: false, follow: false } };

export default function PaymentRequestLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
