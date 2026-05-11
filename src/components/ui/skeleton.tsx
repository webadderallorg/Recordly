import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const skeletonVariants = cva(
	"relative overflow-hidden rounded-md transition-shadow flex items-center justify-center",
	{
		variants: {
			variant: {
				default: "bg-muted/40",
				glass: "bg-white/5 backdrop-blur-sm border border-white/10",
				dark: "bg-black/20",
				subtle: "bg-foreground/[0.03]",
				clip: "bg-primary/5 border border-primary/10 shadow-inner",
			},
			animation: {
				none: "",
				pulse: "animate-pulse",
				shimmer:
					"before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-foreground/[0.05] before:to-transparent",
				"shimmer-glass":
					"before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-white/[0.08] before:to-transparent",
				"shimmer-premium":
					"before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.5s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/[0.1] before:to-transparent",
			},
		},
		defaultVariants: {
			variant: "default",
			animation: "shimmer",
		},
	},
);

export interface SkeletonProps
	extends React.HTMLAttributes<HTMLDivElement>,
		VariantProps<typeof skeletonVariants> {
	label?: string;
}

/**
 * A magnificent Skeleton component designed with Apple-inspired aesthetics.
 * Supports shimmer animations, pulse effects, and labels.
 */
const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
	({ className, variant, animation, label, children, ...props }, ref) => {
		return (
			<div
				ref={ref}
				className={cn(skeletonVariants({ variant, animation, className }))}
				{...props}
			>
				{(label || children) && (
					<div className="relative z-10 flex flex-col items-center gap-2 px-4 py-2">
						{label && (
							<div className="flex items-center">
								{label.split("").map((char, i) => (
									<span
										key={i}
										className={cn(
											"text-[11px] font-medium tracking-tight bg-gradient-to-r from-foreground/30 via-foreground/70 to-foreground/30 bg-clip-text text-transparent animate-text-shimmer whitespace-pre",
										)}
										style={{
											animationDelay: `${i * 0.05}s`,
											animationDuration: "2.5s",
										}}
									>
										{char}
									</span>
								))}
							</div>
						)}
						{children}
					</div>
				)}
			</div>
		);
	},
);

Skeleton.displayName = "Skeleton";

export { Skeleton, skeletonVariants };
