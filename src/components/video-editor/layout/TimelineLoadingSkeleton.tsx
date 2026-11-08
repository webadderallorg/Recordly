import { Skeleton } from "@heroui/react";
import type { HTMLAttributes } from "react";
import { useI18n } from "@/contexts/I18nContext";

/** Keep the timeline wireframe consistent during startup and media loading. */
export function TimelineLoadingSkeleton({
	className = "flex min-h-0 flex-1 flex-col gap-3 pt-2",
	style,
}: Pick<HTMLAttributes<HTMLDivElement>, "className" | "style">) {
	const { t } = useI18n();
	return (
		<div
			data-loading-timeline
			role="status"
			aria-label={t("ui.loadingTimeline")}
			aria-busy="true"
			className={className}
			style={style}
		>
			<div aria-hidden="true" className="contents">
				<Skeleton className="h-7 w-64 rounded-lg" />
				<Skeleton className="h-3 w-full" />
				<Skeleton className="h-[54px] w-4/5 rounded-lg" />
				<Skeleton className="h-6 w-1/3 rounded-lg" />
			</div>
		</div>
	);
}
