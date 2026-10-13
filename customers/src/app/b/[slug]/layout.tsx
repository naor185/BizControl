import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SITE, businessDescription, businessImage, businessJsonLd, businessKeywords, businessTitle, jsonForScript, loadBusiness } from "@/lib/seo";

// A business's page as Google and the link previews see it — its own title, description, keywords, picture and its
// business card (lib/seo.ts). The page itself (page.tsx) is drawn in the browser; this part is ready on the server.

const decode = (slug: string) => { try { return decodeURIComponent(slug); } catch { return slug; } };

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
    const slug = decode(params.slug);
    const b = await loadBusiness(slug);
    if (!b) return { title: "BizFind", robots: { index: false } };
    const url = `${SITE}/b/${encodeURIComponent(b.slug)}`;
    const title = businessTitle(b);
    const description = businessDescription(b);
    const image = businessImage(b);
    return {
        title, description,
        keywords: businessKeywords(b),
        alternates: { canonical: url },
        openGraph: { title, description, url, siteName: "BizFind", locale: "he_IL", type: "website", images: image ? [{ url: image }] : undefined },
        twitter: { card: image ? "summary_large_image" : "summary", title, description, images: image ? [image] : undefined },
    };
}

export default async function BusinessLayout({ children, params }: { children: ReactNode; params: { slug: string } }) {
    const b = await loadBusiness(decode(params.slug));
    return (
        <>
            {b && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonForScript(businessJsonLd(b)) }} />}
            {children}
        </>
    );
}
