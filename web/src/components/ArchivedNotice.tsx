import { Archive } from "lucide-react";

// Shown on a studio's public pages while its subscription has lapsed (the API answers 410).
// The studio's data is untouched and the page opens again by itself once the studio renews.
export default function ArchivedNotice() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6" dir="rtl">
            <div className="text-center max-w-sm space-y-3">
                <div className="mx-auto h-14 w-14 rounded-2xl bg-white border border-slate-100 shadow-sm flex items-center justify-center">
                    <Archive className="h-7 w-7 text-slate-500" />
                </div>
                <h1 className="text-xl font-bold text-slate-800">העסק אינו זמין להזמנות כרגע</h1>
                <p className="text-sm text-slate-500 leading-relaxed">האתר של העסק בארכיון. הוא יחזור לפעול ברגע שהעסק יחדש את המנוי.</p>
            </div>
        </div>
    );
}
