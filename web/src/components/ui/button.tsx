import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-95",
    {
        variants: {
            variant: {
                default:
                    "bg-zinc-900 text-white shadow-sm hover:bg-zinc-800 focus-visible:ring-zinc-900",
                destructive:
                    "bg-red-500 text-white shadow-sm hover:bg-red-600 focus-visible:ring-red-500",
                outline:
                    "border border-zinc-200 bg-white shadow-sm hover:bg-zinc-50 hover:border-zinc-300 text-zinc-800",
                secondary:
                    "bg-zinc-100 text-zinc-900 shadow-sm hover:bg-zinc-200",
                ghost:
                    "hover:bg-zinc-100 text-zinc-700 hover:text-zinc-900",
                link:
                    "text-zinc-900 underline-offset-4 hover:underline",
                success:
                    "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 focus-visible:ring-emerald-600",
                premium:
                    "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md hover:from-violet-700 hover:to-indigo-700 focus-visible:ring-violet-600",
            },
            size: {
                default: "h-9 px-4 py-2",
                sm: "h-8 rounded-lg px-3 text-xs",
                lg: "h-11 rounded-xl px-6 text-base",
                xl: "h-13 rounded-2xl px-8 text-base font-semibold",
                icon: "h-9 w-9",
                "icon-sm": "h-7 w-7 rounded-lg",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
);

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
        VariantProps<typeof buttonVariants> {
    loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, loading, children, disabled, ...props }, ref) => {
        return (
            <button
                className={cn(buttonVariants({ variant, size, className }))}
                ref={ref}
                disabled={disabled || loading}
                {...props}
            >
                {loading && (
                    <svg
                        className="h-4 w-4 animate-spin"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                    >
                        <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                        />
                        <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                    </svg>
                )}
                {children}
            </button>
        );
    }
);
Button.displayName = "Button";

export { Button, buttonVariants };
