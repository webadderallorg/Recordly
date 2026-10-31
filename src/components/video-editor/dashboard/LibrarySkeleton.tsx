import { Skeleton } from "@heroui/react";
export function LibrarySkeleton() {
	return (
		<div
			aria-label="Loading projects"
			aria-busy="true"
			className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-x-7 gap-y-10 lg:gap-x-9"
		>
			{[0, 1, 2].map((key) => (
				<div key={key} className="space-y-4">
					<Skeleton className="aspect-[4/3] w-full rounded-xl" />
					<div className="flex items-center gap-3">
						<Skeleton className="size-12 rounded-full" />
						<div className="flex-1 space-y-2">
							<Skeleton className="h-4 w-3/4 rounded" />
							<Skeleton className="h-3 w-1/3 rounded" />
						</div>
					</div>
				</div>
			))}
		</div>
	);
}
