"use client";

import { useEffect, useState } from "react";
import { SlidersHorizontal, MessageSquare, Loader2, Info } from "lucide-react";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import ClassPolicies, { type ClassPolicy } from "@/components/classes/ClassPolicies";
import ClassNotifications, { type NotifEvent } from "@/components/classes/ClassNotifications";
import PenaltyRules from "@/components/classes/PenaltyRules";
import { apiFetch, getCurrentUserRole } from "@/lib/api";
import { useTerms } from "@/lib/useTerms";

// Classes & memberships settings: the owner's rules and the class/membership messages. Behind the
// "classes" module; a rule or message whose module is off (e.g. the waitlist) is not shown.
const EDITORS = new Set(["owner", "admin", "superadmin"]);

type Tab = "rules" | "messages";

function ClassSettings() {
    const terms = useTerms();
    const [tab, setTab] = useState<Tab>("rules");
    const [policies, setPolicies] = useState<ClassPolicy[] | null>(null);
    const [events, setEvents] = useState<NotifEvent[] | null>(null);
    const [modules, setModules] = useState<Record<string, boolean> | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [canEdit, setCanEdit] = useState(false);

    useEffect(() => {
        Promise.all([
            apiFetch<ClassPolicy[]>("/api/classes/settings"),
            apiFetch<NotifEvent[]>("/api/classes/notifications"),
            apiFetch<Record<string, boolean>>("/api/modules/me").catch(() => null),
        ])
            .then(([p, e, m]) => {
                setPolicies(p); setEvents(e); setModules(m);
                setCanEdit(EDITORS.has(getCurrentUserRole() ?? ""));   // the server checks too (classes.configure)
            })
            .catch(e => setError(e instanceof Error ? e.message : "טעינה נכשלה"));
    }, []);

    const moduleOn = (id: string) => !modules || modules[id] !== false;

    if (error) {
        const off = error.includes("not enabled");
        return (
            <div className="max-w-xl mx-auto mt-10 bg-white rounded-2xl border border-slate-200 p-6 text-center">
                <Info className="w-8 h-8 text-indigo-500 mx-auto mb-3" aria-hidden />
                <p className="font-bold text-slate-800">{off ? "שיעורים קבוצתיים לא פעילים בעסק" : "לא הצלחנו לטעון את ההגדרות"}</p>
                <p className="text-sm text-slate-500 mt-1">{off ? "להפעלה — פנו לתמיכה של BizControl." : error}</p>
            </div>
        );
    }
    if (!policies || !events) {
        return (
            <div className="flex justify-center py-20">
                <Loader2 className="w-7 h-7 text-indigo-500 animate-spin" aria-label="טוען" />
            </div>
        );
    }

    const tabs: { id: Tab; label: string; icon: typeof SlidersHorizontal }[] = [
        { id: "rules", label: "כללים", icon: SlidersHorizontal },
        { id: "messages", label: "הודעות", icon: MessageSquare },
    ];

    return (
        <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
            <p className="text-sm text-slate-500 max-w-2xl">
                הכללים חלים על כל השיעורים בעסק, וההודעות — על כל {terms.client_plural}.
            </p>

            <div role="tablist" className="flex gap-1 border-b border-slate-200">
                {tabs.map(t => (
                    <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                        className={`inline-flex items-center gap-2 px-4 min-h-11 text-sm font-semibold border-b-2 -mb-px transition-colors ${tab === t.id ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
                        <t.icon className="w-4 h-4" aria-hidden /> {t.label}
                    </button>
                ))}
            </div>

            {tab === "rules" ? (
                <div className="space-y-4 pb-24">{/* room for the "unsaved changes" bar */}
                    <ClassPolicies policies={policies.filter(p => moduleOn(p.module))} canEdit={canEdit} onSaved={setPolicies} />
                    <section className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5 space-y-3">
                        <div>
                            <h3 className="text-base font-bold text-slate-800">ביטול מאוחר ואי-הגעה</h3>
                            <p className="text-xs text-slate-500 mt-1">
                                מה קורה כשמבטלים בתוך חלון הביטול או לא מגיעים. אפשר לקבוע כללים אחרים לשיעור מסוים או לסוג מנוי — מתוך ההגדרות שלהם.
                            </p>
                        </div>
                        <PenaltyRules canEdit={canEdit}
                            emptyNote="אין כללים — ביטול מאוחר ואי-הגעה מנצלים את הכניסה (בכרטיסייה), בלי חיוב." />
                    </section>
                </div>
            ) : (
                <ClassNotifications events={events.filter(e => moduleOn(e.module))} canEdit={canEdit} terms={terms} onChange={setEvents} />
            )}
        </div>
    );
}

export default function ClassSettingsPage() {
    return (
        <RequireAuth>
            <AppShell title="הגדרות שיעורים ומנויים">
                <ClassSettings />
            </AppShell>
        </RequireAuth>
    );
}
