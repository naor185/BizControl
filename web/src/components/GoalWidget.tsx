"use client";

import { toast } from "@/lib/toast";
import { useEffect, useState } from "react";
import { getGoalProgress, setMonthlyGoal, GoalProgress } from "@/lib/api";

const fmt = (n: number) =>
    Math.round(n).toLocaleString("he-IL");

export default function GoalWidget({ month, year }: { month?: number, year?: number }) {
    const [progress, setProgress] = useState<GoalProgress | null>(null);
    const [loading, setLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [newTarget, setNewTarget] = useState("");

    const fetchGoal = async (keepEditValue = false) => {
        try {
            setLoading(true);
            const data = await getGoalProgress(month, year);
            setProgress(data);
            if (!keepEditValue) {
                setNewTarget(data.target_amount > 0 ? String(Math.round(Number(data.target_amount))) : "");
            }
        } catch (err) {
            console.error("Failed to fetch goal progress", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchGoal();
    }, [month, year]);

    const handleSave = async () => {
        const target = parseFloat(newTarget);
        if (isNaN(target) || target <= 0) return;
        try {
            const today = new Date();
            const targetMonth = month || (today.getMonth() + 1);
            const targetYear = year || today.getFullYear();
            await setMonthlyGoal(target, targetMonth, targetYear);
            setIsEditing(false);
            fetchGoal();
        } catch (err) {
            toast.error("שגיאה בעדכון יעד");
        }
    };

    if (loading && !isEditing && !progress) return <div className="h-24 bg-slate-50 animate-pulse rounded-3xl" />;
    if (!progress) return null;

    const current = Number(progress.current_revenue);
    const target = Number(progress.target_amount);
    const remaining = Number(progress.remaining_amount);
    const dailyAvg = Number(progress.current_daily_avg);
    const dailyNeeded = Number(progress.required_daily_avg);
    const percentage = Math.min(100, progress.progress_percentage);
    const isTargetMet = current >= target && target > 0;

    // Compare daily avg vs needed
    const dailyGap = dailyNeeded - dailyAvg;
    const isOnTrack = dailyAvg >= dailyNeeded;

    return (
        <div className="bg-white rounded-3xl border border-slate-100 p-8 shadow-xl relative overflow-hidden group transition-all hover:shadow-2xl">
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-bl-full -z-10 group-hover:scale-110 transition-transform" />

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-1">
                    <h3 className="text-xl font-bold text-slate-800">יעד הכנסה חודשי 🎯</h3>
                    <p className="text-sm text-slate-500">
                        {new Date().toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}
                    </p>
                </div>

                <div className="flex items-center gap-4">
                    {isEditing ? (
                        <div className="flex gap-2">
                            <input
                                type="text"
                                inputMode="numeric"
                                value={newTarget}
                                onChange={(e) => setNewTarget(e.target.value.replace(/[^0-9.]/g, ""))}
                                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setIsEditing(false); }}
                                className="w-36 px-4 py-2 border-2 border-indigo-400 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-left text-slate-900 bg-white placeholder-slate-400 text-base font-semibold"
                                dir="ltr"
                                autoFocus
                                placeholder="15000"
                            />
                            <button onClick={handleSave} className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold">שמור</button>
                            <button onClick={() => setIsEditing(false)} className="px-4 py-2 text-slate-500 font-bold">ביטול</button>
                        </div>
                    ) : (
                        <div className="flex flex-col items-end">
                            <div className="flex items-baseline gap-2">
                                <span className="text-3xl font-black text-slate-900" dir="ltr">₪{fmt(current)}</span>
                                <span className="text-slate-400 font-bold">/ ₪{fmt(target)}</span>
                            </div>
                            <button
                                onClick={() => { setNewTarget(target > 0 ? String(Math.round(target)) : ""); setIsEditing(true); }}
                                className="text-xs text-indigo-600 font-bold hover:underline"
                            >עדכן יעד</button>
                        </div>
                    )}
                </div>
            </div>

            {/* Progress Bar */}
            <div className="mt-8">
                <div className="h-4 bg-slate-100 rounded-full overflow-hidden">
                    <div
                        className={`h-full transition-all duration-1000 ${isTargetMet ? 'bg-emerald-500' : 'bg-linear-to-r from-indigo-500 to-indigo-600'}`}
                        style={{ width: `${percentage}%` }}
                    >
                        <div className="w-full h-full bg-linear-to-r from-transparent via-white/20 to-transparent" />
                    </div>
                </div>
                <div className="flex justify-between mt-3 px-1">
                    <span className="text-sm font-bold text-slate-700">{percentage.toFixed(1)}% בוצע</span>
                    <span className="text-sm font-bold text-slate-400">₪{fmt(remaining)} נותרו</span>
                </div>
            </div>

            {/* Daily Breakdown */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 border-t border-slate-100 pt-6">
                <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">ממוצע יומי נוכחי</div>
                    <div className="text-lg font-bold text-slate-700" dir="ltr">₪{fmt(dailyAvg)}</div>
                </div>
                <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">נדרש ביום ליעד</div>
                    <div className={`text-lg font-bold ${isOnTrack ? 'text-emerald-600' : 'text-rose-600'}`} dir="ltr">
                        ₪{fmt(dailyNeeded)}
                    </div>
                    {target > 0 && progress.days_remaining > 0 && (
                        <div className={`text-xs font-semibold mt-0.5 ${isOnTrack ? 'text-emerald-500' : 'text-rose-400'}`}>
                            {isOnTrack ? `+₪${fmt(dailyAvg - dailyNeeded)} מעל` : `-₪${fmt(dailyGap)} מתחת`}
                        </div>
                    )}
                </div>
                <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">ימים שחלפו</div>
                    <div className="text-lg font-bold text-slate-700">{progress.days_elapsed}</div>
                </div>
                <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">ימים שנותרו</div>
                    <div className="text-lg font-bold text-slate-700">{progress.days_remaining}</div>
                </div>
            </div>

            {isTargetMet && (
                <div className="mt-4 bg-emerald-50 text-emerald-700 p-3 rounded-2xl border border-emerald-100 text-sm font-bold text-center">
                    כל הכבוד! עברת את היעד החודשי ✨ תמשיך ככה!
                </div>
            )}
        </div>
    );
}
