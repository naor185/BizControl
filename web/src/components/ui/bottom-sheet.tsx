"use client";

import { cn } from "@/lib/utils";

// The single reusable bottom-sheet the app was missing — this exact pattern
// (backdrop + rounded-t-3xl + drag handle + slide-in-from-bottom) was
// previously copy-pasted independently in 9+ files with inconsistent details
// (some missing the drag handle, max-height varying 85dvh/90dvh/92dvh).
// Bakes in every mobile-modal fix already made this session: z-[60] (matches
// the app-wide fix so it never renders behind BottomNav), dvh (not vh),
// overflow-y-auto + min-h-0 on the scroll body (so the footer never gets
// pushed off-screen), and safe-area-aware bottom padding.
interface BottomSheetProps {
    open: boolean;
    onClose: () => void;
    title?: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
    className?: string;
}

export default function BottomSheet({ open, onClose, title, children, footer, className }: BottomSheetProps) {
    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-end justify-center animate-in fade-in duration-200"
            onClick={onClose}
            dir="rtl"
        >
            <div
                className={cn(
                    "bg-white w-full rounded-t-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90dvh] animate-in slide-in-from-bottom duration-300",
                    className
                )}
                style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
                    <div className="w-10 h-1 rounded-full bg-slate-300" />
                </div>

                {title && (
                    <div className="px-5 pb-3 flex items-center justify-between flex-shrink-0 border-b border-slate-100">
                        <h3 className="text-lg font-bold text-slate-800">{title}</h3>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="סגור"
                            className="w-11 h-11 flex items-center justify-center text-slate-400 hover:text-slate-600 -me-2"
                        >
                            ✕
                        </button>
                    </div>
                )}

                <div className="overflow-y-auto flex-1 min-h-0 p-5">
                    {children}
                </div>

                {footer && (
                    <div className="border-t border-slate-100 p-4 flex-shrink-0 bg-slate-50">
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
}
