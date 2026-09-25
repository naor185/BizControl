"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarDays, Repeat, DoorOpen, SlidersHorizontal, Loader2, Info, type LucideIcon } from "lucide-react";
import AppShell from "@/components/AppShell";
import RequireAuth from "@/components/RequireAuth";
import ClassSchedule from "@/components/classes/ClassSchedule";
import ClassTemplates from "@/components/classes/ClassTemplates";
import ClassRooms from "@/components/classes/ClassRooms";
import type { ClassPolicy } from "@/components/classes/ClassPolicies";
import { apiFetch, getCurrentUserId, getCurrentUserRole } from "@/lib/api";
import { useTerms } from "@/lib/useTerms";
import type { Room, StaffMember } from "@/lib/classes";

// Group classes: the week's schedule, the recurring classes it is made from, and rooms. Behind the
// "classes" module; the rooms tab only when "rooms" is on. /classes?session=<id> opens one class
// (the calendar links here).
const MANAGERS = new Set(["owner", "admin", "superadmin"]);

type Tab = "schedule" | "templates" | "rooms";
type Service = { id: string; name: string; duration_minutes: number; color: string };

function Classes() {
    const params = useSearchParams();
    const terms = useTerms();
    const [tab, setTab] = useState<Tab>(() => (params.get("tab") as Tab) || "schedule");
    const [modules, setModules] = useState<Record<string, boolean> | null>(null);
    const [rooms, setRooms] = useState<Room[]>([]);
    const [staff, setStaff] = useState<StaffMember[]>([]);
    const [services, setServices] = useState<Service[]>([]);
    const [policies, setPolicies] = useState<ClassPolicy[]>([]);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [role, setRole] = useState<string | null>(null);
    const [userId, setUserId] = useState<string | null>(null);

    const loadRooms = useCallback((on: boolean) => {
        if (!on) return;
        apiFetch<Room[]>("/api/classes/rooms").then(setRooms).catch(() => setRooms([]));
    }, []);

    useEffect(() => {
        apiFetch<Record<string, boolean>>("/api/modules/me").catch(() => null).then(m => {
            setModules(m);
            setRole(getCurrentUserRole());
            setUserId(getCurrentUserId());
            if (m && m.classes === false) { setError("off"); return; }
            loadRooms(!m || m.rooms !== false);
            return Promise.all([
                apiFetch<StaffMember[]>("/api/users/artists").then(setStaff).catch(() => setStaff([])),
                apiFetch<Service[]>("/api/services?active_only=true").then(setServices).catch(() => setServices([])),
                apiFetch<ClassPolicy[]>("/api/classes/settings").then(setPolicies).catch(() => setPolicies([])),
            ]).then(() => setReady(true));
        });
    }, [loadRooms]);

    if (error) {
        return (
            <div className="max-w-xl mx-auto mt-10 bg-white rounded-2xl border border-slate-200 p-6 text-center">
                <Info className="w-8 h-8 text-indigo-500 mx-auto mb-3" aria-hidden />
                <p className="font-bold text-slate-800">שיעורים קבוצתיים לא פעילים בעסק</p>
                <p className="text-sm text-slate-500 mt-1">להפעלה — פנו לתמיכה של BizControl.</p>
            </div>
        );
    }
    if (!ready) {
        return <div className="flex justify-center py-20"><Loader2 className="w-7 h-7 text-indigo-500 animate-spin" aria-label="טוען" /></div>;
    }

    const roomsOn = !modules || modules.rooms !== false;
    const canManage = MANAGERS.has(role ?? "");
    const tabs: { id: Tab; label: string; icon: LucideIcon }[] = [
        { id: "schedule", label: "לוח שיעורים", icon: CalendarDays },
        { id: "templates", label: "שיעורים קבועים", icon: Repeat },
        ...(roomsOn ? [{ id: "rooms" as Tab, label: "חדרים", icon: DoorOpen }] : []),
    ];

    return (
        <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
            <div className="flex items-end justify-between gap-3 border-b border-slate-200">
                <div role="tablist" className="flex gap-1 overflow-x-auto">
                    {tabs.map(t => (
                        <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                            className={`inline-flex items-center gap-2 px-3 sm:px-4 min-h-11 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors ${tab === t.id ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
                            <t.icon className="w-4 h-4" aria-hidden /> {t.label}
                        </button>
                    ))}
                </div>
                <Link href="/classes/settings" className="inline-flex items-center gap-1.5 min-h-11 px-2 text-sm text-slate-600 hover:text-indigo-700 shrink-0">
                    <SlidersHorizontal className="w-4 h-4" aria-hidden /><span className="hidden sm:inline">הגדרות</span>
                </Link>
            </div>

            {tab === "schedule" && (
                <ClassSchedule rooms={rooms} staff={staff} terms={terms} role={role} userId={userId} openSessionId={params.get("session")} />
            )}
            {tab === "templates" && (
                <ClassTemplates rooms={rooms} staff={staff} services={services} policies={policies} terms={terms}
                    canConfigure={canManage} modules={modules} />
            )}
            {tab === "rooms" && roomsOn && (
                <ClassRooms rooms={rooms} canConfigure={canManage} onChange={() => loadRooms(true)} />
            )}
        </div>
    );
}

export default function ClassesPage() {
    return (
        <RequireAuth>
            <AppShell title="שיעורים">
                <Suspense fallback={null}>
                    <Classes />
                </Suspense>
            </AppShell>
        </RequireAuth>
    );
}
