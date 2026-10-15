import { redirect } from "next/navigation";

// "דשבורד" (/overview) became part of לוח בקרה (the owner, 2026-10-15: one home screen) — what it held (the setup
// checklist, the leads, BizFind's exposure) is there now. A link from before still lands in the right place: a lead's
// notice on לוח בקרה, the subscription's (?billing=…) on its own screen.
export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const q = await searchParams;
    const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
    const billing = one(q.billing);
    if (billing) redirect(billing === "plans" ? "/billing" : `/billing?billing=${encodeURIComponent(billing)}`);
    const lead = one(q.lead);
    redirect(lead ? `/dashboard?lead=${encodeURIComponent(lead)}` : "/dashboard");
}
