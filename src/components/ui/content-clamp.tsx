import { Tooltip } from "@heroui/react";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
interface ContentClampProps extends HTMLAttributes<HTMLDivElement> {
	truncateLength?: number;
}
export function ContentClamp({
	children,
	className,
	truncateLength = 50,
	...props
}: ContentClampProps) {
	const text = typeof children === "string" ? children : String(children ?? "");
	if (text.length <= truncateLength)
		return (
			<div className={cn("inline", className)} {...props}>
				{children}
			</div>
		);
	return (
		<Tooltip delay={300}>
			<Tooltip.Trigger>
				<span tabIndex={0} className={cn("cursor-help", className)} {...props}>
					{text.slice(0, truncateLength)}…
				</span>
			</Tooltip.Trigger>
			<Tooltip.Content>{text}</Tooltip.Content>
		</Tooltip>
	);
}
