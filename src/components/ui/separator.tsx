import { cn } from "@/lib/utils";

interface SeparatorProps {
	/** Orientation of the separator */
	orientation?: "horizontal" | "vertical";
	/** Additional CSS classes */
	className?: string;
}

/**
 * A reusable separator component that can be used as a horizontal or vertical divider.
 * Replaces the inline div separators used throughout the application.
 */
export function Separator({
	orientation = "horizontal",
	className,
}: SeparatorProps) {
	return (
		<div
			className={cn(
				"bg-separator",
				orientation === "horizontal" ? "h-px w-full" : "w-px h-full",
				className,
			)}
		/>
	);
}
