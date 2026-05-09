import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
    "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
    {
        variants: {
            variant: {
                default: "bg-zinc-900 text-white",
                secondary: "bg-zinc-100 text-zinc-700",
                destructive: "bg-red-100 text-red-700",
                success: "bg-emerald-100 text-emerald-700",
                warning: "bg-amber-100 text-amber-700",
                info: "bg-blue-100 text-blue-700",
                purple: "bg-violet-100 text-violet-700",
                outline: "border border-zinc-200 text-zinc-700",
            },
        },
        defaultVariants: {
            variant: "default",
        },
    }
);

export interface BadgeProps
    extends React.HTMLAttributes<HTMLDivElement>,
        VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
    return (
        <div className={cn(badgeVariants({ variant }), className)} {...props} />
    );
}

export { Badge, badgeVariants };
