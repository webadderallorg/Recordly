import { useI18n as useUiLocale } from "@/contexts/I18nContext";
import { Card, Skeleton } from "@heroui/react";
import { LibrarySkeleton } from "./LibrarySkeleton";
import { LoadingFrameHeader } from "../layout/LoadingFrameHeader";

/** Match the Home sidebar, search row and project cards while startup loads. */
export function HomeLoadingSkeleton() {
	const { t: uiText } = useUiLocale();
	return (
		<div
			role="status"
			aria-label={uiText("ui.loadingHome")}
			aria-busy="true"
			className="dashboard-shell flex h-screen flex-col overflow-hidden bg-background text-foreground"
		>
			<span className="sr-only">{uiText("ui.loadingHome2")}</span>
			<LoadingFrameHeader home />
			<div className="flex min-h-0 flex-1">
				<div
					data-loading-home-sidebar
					aria-hidden="true"
					className="flex w-48 shrink-0 flex-col px-4 pb-5 pt-3 lg:w-56"
				>
					<Skeleton className="mb-5 h-10 w-full rounded-lg" />
					<div className="space-y-1">
						{[0, 1, 2].map((key) => (
							<Skeleton key={key} className="h-10 w-full rounded-lg" />
						))}
					</div>
					<div className="mt-9 space-y-4">
						<Skeleton className="h-4 w-20" />
						{[0, 1, 2].map((key) => (
							<Skeleton key={key} className="h-6 w-full rounded-lg" />
						))}
					</div>
					<Skeleton className="mt-auto h-[88px] w-full rounded-xl" />
					<Skeleton className="mt-1 h-10 w-full rounded-lg" />
				</div>
				<Card
					data-loading-home-panel
					aria-hidden="true"
					className="app-frame-surface my-3 mr-3 min-w-0 flex-1 gap-0 overflow-hidden rounded-3xl bg-surface p-0 shadow-sm"
				>
					<div className="flex items-baseline gap-3 px-7 pt-7 lg:px-10">
						<Skeleton className="h-7 w-36 rounded" />
						<Skeleton className="h-4 w-20 rounded" />
					</div>
					<div className="flex shrink-0 items-center gap-5 px-7 pb-5 pt-4 lg:px-10">
						<Skeleton className="h-11 min-w-0 flex-1 rounded-lg" />
						<Skeleton className="h-10 w-24 rounded-lg" />
					</div>
					<div className="flex gap-2 px-7 pb-7 lg:px-10">
						<Skeleton className="h-7 w-20 rounded-lg" />
						<Skeleton className="h-7 w-28 rounded-lg" />
						<Skeleton className="h-7 w-28 rounded-lg" />
						<Skeleton className="ml-auto h-7 w-20 rounded-lg" />
					</div>
					<div className="overflow-hidden px-7 pb-10 lg:px-10">
						<Skeleton className="mb-4 h-7 w-8 rounded" />
						<LibrarySkeleton />
					</div>
				</Card>
			</div>
		</div>
	);
}
