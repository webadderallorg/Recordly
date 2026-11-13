import type { CSSProperties } from "react";
import { useI18n } from "@/contexts/I18nContext";

export function WindowControls({ maximized }: { maximized: boolean }) {
	const { t } = useI18n();
	const actions = [
		{
			action: "minimize" as const,
			label: t("common.actions.minimize", "Minimize"),
			path: "M0 5.5h10",
		},
		{
			action: "maximize" as const,
			label: maximized
				? t("common.actions.restoreWindow", "Restore window")
				: t("common.actions.maximize", "Maximize"),
			path: maximized ? "M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z" : "M.5.5h9v9h-9z",
		},
		{
			action: "close" as const,
			label: t("common.actions.close", "Close"),
			path: "m.5.5 9 9m0-9-9 9",
		},
	];
	return (
		<div
			role="group"
			aria-label={t("common.windowControls", "Window controls")}
			className="-mr-2 flex h-full items-center gap-1 pl-1"
			style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
		>
			{actions.map(({ action, label, path }) => (
				<button
					key={action}
					type="button"
					aria-label={label}
					title={label}
					className={`flex size-8 shrink-0 items-center justify-center rounded-md text-foreground transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-accent ${action === "close" ? "hover:bg-[#e81123] hover:text-white active:bg-[#c50f1f]" : "hover:bg-foreground/10 active:bg-foreground/15"}`}
					onClick={() => {
						void window.electronAPI?.windowControl?.(action);
					}}
				>
					<svg
						width="10"
						height="10"
						viewBox="0 0 10 10"
						fill="none"
						stroke="currentColor"
						strokeWidth="1"
						aria-hidden="true"
					>
						<path d={path} />
					</svg>
				</button>
			))}
		</div>
	);
}
