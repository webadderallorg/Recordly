import { Tooltip } from "@heroui/react";
import type { ReactNode } from "react";
import { Info } from "@/components/ui/icons";

/** Keep optional guidance available without adding another line to each setting. */
export function SettingsInfo({ label, children }: { label: ReactNode; children: ReactNode }) {
	return (
		<Tooltip delay={250} closeDelay={100}>
			<Tooltip.Trigger
				tabIndex={0}
				aria-label={typeof label === "string" ? label : undefined}
				className="settings-info inline-flex h-5 w-5 shrink-0 cursor-help items-center justify-center rounded-full text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent"
				onClick={(event) => {
					// Some settings are wrapped by a switch label. Help must never toggle it.
					event.preventDefault();
					event.stopPropagation();
				}}
				onKeyDown={(event) => {
					if (event.key === " " || event.key === "Enter") {
						event.preventDefault();
						event.stopPropagation();
					}
				}}
			>
				<Info size={15} aria-hidden="true" />
			</Tooltip.Trigger>
			<Tooltip.Content
				className="max-w-80 text-xs leading-relaxed"
				style={{ wordBreak: "normal", overflowWrap: "break-word" }}
				placement="top"
			>
				{children}
			</Tooltip.Content>
		</Tooltip>
	);
}
