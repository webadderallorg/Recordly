import { useI18n as useUiLocale } from "@/contexts/I18nContext";
import { Card, Skeleton } from "@heroui/react";
import { LoadingFrameHeader } from "./LoadingFrameHeader";
import { TimelineLoadingSkeleton } from "./TimelineLoadingSkeleton";

/** Mirror the editor's tools, inspector, preview controls and timeline. */
export function EditorLoadingSkeleton() {
	const { t: uiText } = useUiLocale();
	return (
		<div
			className="flex h-screen flex-col overflow-hidden bg-editor-bg"
			role="status"
			aria-label={uiText("ui.loadingEditor")}
			aria-busy="true"
		>
			<span className="sr-only">{uiText("ui.loadingEditor2")}</span>
			<LoadingFrameHeader />
			<div aria-hidden="true" className="flex min-h-0 flex-1 pt-3">
				<div className="flex min-h-0 shrink-0 pb-3 pr-2">
					<div
						data-loading-rail
						className="flex w-16 shrink-0 flex-col items-center gap-2 py-2.5"
					>
						{Array.from({ length: 4 }, (_, i) => (
							<Skeleton key={i} className="size-10 rounded-lg md:size-9" />
						))}
					</div>
					<Card
						data-loading-inspector
						className="app-frame-surface min-h-0 w-[320px] shrink-0 gap-0 overflow-hidden rounded-3xl bg-surface p-0 shadow-sm"
					>
						<div className="flex h-14 shrink-0 items-center justify-between px-5">
							<Skeleton className="h-4 w-16" />
							<Skeleton className="h-5 w-20 rounded-full" />
						</div>
						<div className="overflow-hidden px-5 pb-6 pt-1">
							<Skeleton className="h-8 w-full rounded-lg" />
							<div className="mt-5 grid grid-cols-4 gap-2">
								{Array.from({ length: 4 }, (_, i) => (
									<Skeleton key={i} className="h-8 rounded-full" />
								))}
							</div>
							<div className="mt-4 grid grid-cols-5 gap-2">
								{Array.from({ length: 25 }, (_, i) => (
									<Skeleton key={i} className="aspect-[4/3] rounded-md" />
								))}
							</div>
							<Skeleton className="mt-5 h-8 w-full rounded-lg" />
							{Array.from({ length: 3 }, (_, i) => (
								<div key={i} className="mt-3 space-y-3">
									<Skeleton className="h-3 w-20" />
									<Skeleton className="h-5 w-full rounded-full" />
								</div>
							))}
						</div>
					</Card>
				</div>
				<div
					data-loading-preview
					className="loading-preview flex min-h-0 min-w-0 flex-1 flex-col"
				>
					<div className="flex h-10 shrink-0 items-center justify-center gap-3">
						<Skeleton className="h-7 w-16 rounded-lg" />
						<Skeleton className="h-7 w-16 rounded-lg" />
					</div>
					<div className="flex min-h-0 flex-1 px-4 py-3">
						<div className="loading-preview-stage relative min-h-0 min-w-0 flex-1">
							<Skeleton className="loading-preview-frame rounded-xl" />
							<span className="loading-recordly-mark" />
						</div>
					</div>
					<div className="loading-playback">
						<Skeleton className="loading-playback-tools h-9 w-48 rounded-lg" />
						<Skeleton className="loading-playback-center h-9 w-48 rounded-full" />
						<Skeleton className="loading-playback-volume size-9 rounded-lg" />
					</div>
				</div>
			</div>
			<div aria-hidden="true" className="contents">
				<TimelineLoadingSkeleton
					className="flex shrink-0 flex-col gap-3 px-4 pb-4 pt-2"
					style={{ height: "calc(22% - 4.32px)", minHeight: 188, maxHeight: 288 }}
				/>
			</div>
		</div>
	);
}
