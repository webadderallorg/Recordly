import { Description, Label } from "@heroui/react";
import type { ReactNode } from "react";
import { SettingsInfo } from "./SettingsInfo";

/** One spacing and typography contract for editor and dashboard preferences. */
export function SettingsRow({
	title,
	description,
	descriptionInline = false,
	help,
	children,
	stacked = false,
}: {
	title: ReactNode;
	description?: ReactNode;
	descriptionInline?: boolean;
	help?: ReactNode;
	children: ReactNode;
	stacked?: boolean;
}) {
	return (
		<section
			className={
				stacked
					? "settings-row settings-row-stacked flex flex-col gap-3"
					: "settings-row flex items-center justify-between gap-4"
			}
		>
			<div className="settings-row-copy flex min-w-0 flex-col gap-1">
				<div className="flex items-center gap-1.5">
					<Label className="text-sm font-medium">{title}</Label>
					{(help || (!descriptionInline && description)) && (
						<SettingsInfo label={title}>{help || description}</SettingsInfo>
					)}
				</div>
				{descriptionInline && description && (
					<Description className="text-xs leading-relaxed">{description}</Description>
				)}
			</div>
			<div className={`settings-row-control ${stacked ? "w-full" : "shrink-0"}`}>
				{children}
			</div>
		</section>
	);
}
