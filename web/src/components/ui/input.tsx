import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    hint?: string;
    startIcon?: React.ReactNode;
    endIcon?: React.ReactNode;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ className, type, label, error, hint, startIcon, endIcon, ...props }, ref) => {
        return (
            <div className="flex flex-col gap-1.5 w-full">
                {label && (
                    <label className="text-sm font-medium text-zinc-700">
                        {label}
                        {props.required && <span className="text-red-500 mr-1">*</span>}
                    </label>
                )}
                <div className="relative flex items-center">
                    {startIcon && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none">
                            {startIcon}
                        </div>
                    )}
                    <input
                        type={type}
                        className={cn(
                            "flex h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm",
                            "placeholder:text-zinc-400",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:border-transparent",
                            "disabled:cursor-not-allowed disabled:opacity-50",
                            "transition-colors duration-150",
                            error && "border-red-400 focus-visible:ring-red-400",
                            startIcon && "pr-10",
                            endIcon && "pl-10",
                            className
                        )}
                        ref={ref}
                        {...props}
                    />
                    {endIcon && (
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none">
                            {endIcon}
                        </div>
                    )}
                </div>
                {error && <p className="text-xs text-red-500">{error}</p>}
                {hint && !error && <p className="text-xs text-zinc-400">{hint}</p>}
            </div>
        );
    }
);
Input.displayName = "Input";

export { Input };
