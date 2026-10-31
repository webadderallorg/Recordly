import { Label, Description } from "@heroui/react";
import type { ReactNode } from "react";

/** One spacing and typography contract for editor and dashboard preferences. */
export function SettingsRow({
	title,
	description,
	children,
	stacked = false,
}: {
	title: ReactNode;
	description?: ReactNode;
	children: ReactNode;
	stacked?: boolean;
}) {
	return (
		<section
			className={stacked ? "flex flex-col gap-3" : "flex items-center justify-between gap-4"}
		>
			<div className="flex min-w-0 flex-col gap-1">
				<Label className="text-[13px] font-medium">{title}</Label>
				{description && (
					<Description className="text-xs leading-relaxed">{description}</Description>
				)}
			</div>
			<div className={stacked ? "w-full" : "shrink-0"}>{children}</div>
		</section>
	);
}
