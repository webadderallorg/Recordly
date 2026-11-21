import { Tooltip } from "@heroui/react";
import { type ReactElement, useState } from "react";

interface HudTooltipProps {
	label: string;
	children: ReactElement;
	suppressed?: boolean;
}

// Native `title` tooltips only show while the HUD window is focused on macOS.
// The child must be a React Aria button so it picks up the trigger via context.
export function HudTooltip({ label, children, suppressed = false }: HudTooltipProps) {
	const [open, setOpen] = useState(false);
	return (
		<Tooltip isOpen={open && !suppressed && label.length > 0} onOpenChange={setOpen}>
			{children}
			<Tooltip.Content
				placement="top"
				offset={8}
				className="launch-theme pointer-events-none"
			>
				{label}
			</Tooltip.Content>
		</Tooltip>
	);
}
