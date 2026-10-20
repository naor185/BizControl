"use client";

import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/lib/toast";

import { tx } from "@/lib/i18n";
// BizFind in the App Store and Google Play — the invitation to the app (app/services/app_invite.py) goes out only once
// the App Store link is set here, with one link, find.biz-control.com/app, that leads to the phone's store.

type Links = { bizfind_ios_url: string | null; bizfind_android_url: string | null };

export default function BizFindStoreLinks() {
    const [ios, setIos] = useState("");
    const [android, setAndroid] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        apiFetch<Links>("/api/admin/platform-settings")
            .then(s => { setIos(s.bizfind_ios_url || ""); setAndroid(s.bizfind_android_url || ""); })
            .catch(() => {});
    }, []);

    const save = async () => {
        setSaving(true);
        try {
            const s = await apiFetch<Links>("/api/admin/platform-settings", {
                method: "PATCH", body: JSON.stringify({ bizfind_ios_url: ios.trim(), bizfind_android_url: android.trim() }),
            });
            setIos(s.bizfind_ios_url || "");
            setAndroid(s.bizfind_android_url || "");
            toast.success(tx("הקישורים לחנויות נשמרו"));
        } catch (e) {
            toast.error((e as Error)?.message || tx("שגיאה בשמירה"));
        } finally {
            setSaving(false);
        }
    };

    const field = "w-full bg-white/5 border border-white/15 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-emerald-500";
    return (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center"><Smartphone className="w-5 h-5 text-emerald-300" aria-hidden /></div>
                <div>
                    <h2 className="text-lg font-bold">{tx("BizFind בחנויות")}</h2>
                    <p className="text-slate-400 text-sm mt-0.5">
                        {tx("ההזמנה לאפליקציה יוצאת ללקוחות רק אחרי שקישור ה-App Store כאן — עד אז היא לא נשלחת בכלל. היא שולחת קישור אחד, find.biz-control.com/app: מאייפון הוא פותח את ה-App Store, מאנדרואיד את Google Play.")}
                    </p>
                </div>
            </div>
            <label className="block text-xs font-semibold text-slate-400">
                {tx("קישור ל-App Store")}
                <input dir="ltr" value={ios} onChange={e => setIos(e.target.value)} placeholder="https://apps.apple.com/..." className={`${field} mt-1.5`} />
            </label>
            <label className="block text-xs font-semibold text-slate-400">
                {tx("קישור ל-Google Play")}
                <input dir="ltr" value={android} onChange={e => setAndroid(e.target.value)} placeholder="https://play.google.com/store/apps/details?id=..." className={`${field} mt-1.5`} />
            </label>
            <button type="button" onClick={save} disabled={saving}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold">
                {saving ? tx("שומר...") : tx("שמירה")}
            </button>
        </div>
    );
}
