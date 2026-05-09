"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
    title: string;
    value: string | number;
    subtitle?: string;
    icon?: React.ReactNode;
    trend?: number;
    color?: "default" | "green" | "blue" | "purple" | "amber" | "red";
    className?: string;
    loading?: boolean;
}

const COLOR_MAP = {
    default: { bg: "bg-zinc-50", icon: "bg-zinc-900 text-white", border: "border-zinc-200" },
    green:   { bg: "bg-emerald-50", icon: "bg-emerald-600 text-white", border: "border-emerald-200" },
    blue:    { bg: "bg-blue-50", icon: "bg-blue-600 text-white", border: "border-blue-200" },
    purple:  { bg: "bg-violet-50", icon: "bg-violet-600 text-white", border: "border-violet-200" },
    amber:   { bg: "bg-amber-50", icon: "bg-amber-500 text-white", border: "border-amber-200" },
    red:     { bg: "bg-red-50", icon: "bg-red-500 text-white", border: "border-red-200" },
};

export function StatCard({ title, value, subtitle, icon, trend, color = "default", className, loading }: StatCardProps) {
    const c = COLOR_MAP[color];

    if (loading) {
        return (
            <div className={cn("rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm animate-pulse", className)}>
                <div className="flex items-start justify-between">
                    <div className="space-y-2 flex-1">
                        <div className="h-3 w-20 bg-zinc-200 rounded" />
                        <div className="h-7 w-28 bg-zinc-200 rounded" />
                    </div>
                    <div className="h-10 w-10 bg-zinc-200 rounded-xl" />
                </div>
            </div>
        );
    }

    return (
        <motion.div
            whileHover={{ y: -2, boxShadow: "0 8px 24px -4px rgba(0,0,0,0.08)" }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            className={cn(
                "rounded-2xl border bg-white p-5 shadow-sm cursor-default",
                c.border,
                className
            )}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-zinc-500 truncate">{title}</p>
                    <p className="mt-1 text-2xl font-bold text-zinc-900 tabular-nums">{value}</p>
                    {subtitle && (
                        <p className="mt-0.5 text-xs text-zinc-400 truncate">{subtitle}</p>
                    )}
                    {trend !== undefined && (
                        <div className={cn(
                            "mt-2 inline-flex items-center gap-1 text-xs font-medium rounded-full px-2 py-0.5",
                            trend > 0 ? "bg-emerald-100 text-emerald-700" :
                            trend < 0 ? "bg-red-100 text-red-700" :
                            "bg-zinc-100 text-zinc-500"
                        )}>
                            {trend > 0 ? <TrendingUp className="h-3 w-3" /> :
                             trend < 0 ? <TrendingDown className="h-3 w-3" /> :
                             <Minus className="h-3 w-3" />}
                            <span>{trend > 0 ? "+" : ""}{trend}%</span>
                        </div>
                    )}
                </div>
                {icon && (
                    <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl shrink-0", c.icon)}>
                        {icon}
                    </div>
                )}
            </div>
        </motion.div>
    );
}
