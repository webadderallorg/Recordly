import { Skeleton } from "@heroui/react";
import { AppFrameHeader } from "./AppFrameHeader";

/** Reserve the same breadcrumb, actions and account space as the app header. */
export function LoadingFrameHeader({ home = false }: { home?: boolean }) {
	return (
		<AppFrameHeader>
			<div
				aria-hidden="true"
				className="loading-frame-start flex min-w-0 items-center gap-3 overflow-hidden"
			>
				<Skeleton className="h-9 w-20 shrink-0 rounded-lg" />
				<Skeleton className="h-4 w-28 shrink-0 rounded" />
				{!home && <Skeleton className="h-8 w-16 shrink-0 rounded-lg" />}
			</div>
			<div aria-hidden="true" className="flex items-center gap-3">
				<Skeleton className="h-9 w-28 rounded-lg" />
				{!home && <Skeleton className="h-9 w-[76px] rounded-lg" />}
				<Skeleton className="size-9 rounded-full" />
			</div>
		</AppFrameHeader>
	);
}
