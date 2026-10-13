import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { API } from "@/lib/api";

// One link for every phone — the invitation to the BizFind app sends it (app/services/app_invite.py):
// find.biz-control.com/app?b=<business>. An iPhone goes to the App Store, an Android to Google Play — once the
// superadmin set the store links (platform settings); until then, and on a computer, the business's page on BizFind.
export const dynamic = "force-dynamic";

export default async function AppLink({ searchParams }: { searchParams: { b?: string } }) {
    const ua = headers().get("user-agent") || "";
    const slug = (searchParams.b || "").replace(/[^\w֐-׿-]/g, "");       // a business's address, nothing else
    let links: { ios?: string | null; android?: string | null } = {};
    try {
        const res = await fetch(`${API}/api/public/bizfind-app`, { cache: "no-store" });
        if (res.ok) links = await res.json();
    } catch { /* the website, then */ }
    const store = /iPhone|iPad|iPod/i.test(ua) ? links.ios : /Android/i.test(ua) ? links.android : null;
    redirect(store || (slug ? `/b/${encodeURIComponent(slug)}` : "/"));
}
