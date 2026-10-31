import { Card, Skeleton } from "@heroui/react";
import { LibrarySkeleton } from "./LibrarySkeleton";

/** Match the Home sidebar, search row and project cards while startup loads. */
export function HomeLoadingSkeleton() {
	return (
		<div
			role="status"
			aria-label="Loading home"
			aria-busy="true"
			className="dashboard-shell flex h-screen overflow-hidden bg-background text-foreground"
		>
			<span className="sr-only">Loading home…</span>
			<div
				aria-hidden="true"
				className="flex w-48 shrink-0 flex-col gap-5 px-4 pb-5 pt-12 lg:w-56"
			>
				<Skeleton className="h-10 w-32 rounded-lg" />
				<Skeleton className="h-10 w-full rounded-lg" />
				<div className="space-y-3">
					{[0, 1, 2].map((key) => (
						<Skeleton key={key} className="h-8 w-full rounded-lg" />
					))}
				</div>
				<div className="mt-4 space-y-4">
					<Skeleton className="h-4 w-20" />
					{[0, 1, 2].map((key) => (
						<Skeleton key={key} className="h-6 w-full rounded-lg" />
					))}
				</div>
				<div className="mt-auto space-y-3">
					<Skeleton className="h-8 w-full rounded-lg" />
					<Skeleton className="h-8 w-full rounded-lg" />
				</div>
			</div>
			<Card
				aria-hidden="true"
				className="my-3 mr-3 min-w-0 flex-1 gap-0 overflow-hidden rounded-2xl bg-background p-0 shadow-sm"
			>
				<div className="flex h-24 shrink-0 items-center gap-5 px-7 pt-5 lg:px-10">
					<Skeleton className="h-11 min-w-0 flex-1 rounded-lg" />
					<Skeleton className="h-10 w-24 rounded-lg" />
				</div>
				<div className="flex gap-3 px-7 pb-7 pt-5 lg:px-10">
					<Skeleton className="h-7 w-20 rounded-full" />
					<Skeleton className="h-7 w-28 rounded-full" />
				</div>
				<div className="overflow-hidden px-7 pb-10 lg:px-10">
					<LibrarySkeleton />
				</div>
			</Card>
		</div>
	);
}
