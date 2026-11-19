import { useI18n as useUiLocale } from "@/contexts/I18nContext";
import { MagnifyingGlass, UploadSimple, ArrowClockwise } from "@/components/ui/icons";
import { type CSSProperties } from "react";
import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";

import type { DashboardProps } from "./types";

import type { DashboardModel } from "./useDashboardModel";

export function DashboardToolbar({
	onImportFile,
	isRaw,
	query,
	setQuery,
	run,
	busy,
	actionLabel,
	action = "import",
	title,
	count,
}: Pick<
	DashboardProps & DashboardModel,
	"onImportFile" | "query" | "setQuery" | "run" | "busy" | "isRaw"
> & { actionLabel?: string; action?: "import" | "refresh"; title?: string; count?: number }) {
	const { locale, t: uiText } = useUiLocale();
	return (
		<>
			<div className="flex items-baseline gap-3 px-7 pt-7 lg:px-10">
				<h1 className="min-w-0 break-words text-xl font-semibold tracking-tight">
					{title ?? (isRaw ? uiText("ui.originalRecordings") : uiText("ui.yourProjects"))}
				</h1>
				{count !== undefined && (
					<span className="shrink-0 text-sm text-muted-foreground">
						{uiText(isRaw ? "ui.recordingCount" : "ui.projectCount", undefined, {
							count,
							number: new Intl.NumberFormat(locale).format(count),
						})}
					</span>
				)}
			</div>
			<header
				className="flex shrink-0 items-center gap-5 px-7 pb-5 pt-4 lg:px-10"
				style={{ WebkitAppRegion: "drag" } as CSSProperties}
			>
				<div
					className="relative min-w-0 flex-1"
					style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
				>
					<MagnifyingGlass className="pointer-events-none absolute left-3.5 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground/60" />
					<Input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						aria-label={
							isRaw
								? uiText("ui.searchOriginalRecordings")
								: uiText("ui.searchProjects")
						}
						placeholder={
							isRaw
								? uiText("ui.searchOriginalRecordings2")
								: uiText("ui.searchProjects2")
						}
						className="h-11 w-full border-0 bg-default/30 pl-10 shadow-none"
					/>
				</div>
				<div style={{ WebkitAppRegion: "no-drag" } as CSSProperties}>
					<Button
						variant="secondary"
						disabled={busy}
						onClick={() => void run(onImportFile)}
						className="h-10 shrink-0 gap-2 text-[13px]"
					>
						{action === "refresh" ? (
							<ArrowClockwise className="size-4" />
						) : (
							<UploadSimple className="size-4" />
						)}
						{actionLabel ?? uiText("ui.import")}
					</Button>
				</div>
			</header>
		</>
	);
}
