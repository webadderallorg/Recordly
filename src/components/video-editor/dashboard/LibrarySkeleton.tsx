import { useI18n as useUiLocale } from "@/contexts/I18nContext";
import { Skeleton } from "@heroui/react";
export function LibrarySkeleton() {
	const { t: uiText } = useUiLocale();
	return (
		<div
			aria-label={uiText("ui.loadingProjects")}
			aria-busy="true"
			className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] min-[1440px]:grid-cols-4 gap-x-7 gap-y-10 pt-2 lg:gap-x-9"
		>
			{[0, 1, 2, 3].map((key) => (
				<div key={key}>
					<Skeleton className="aspect-[4/3] w-full rounded-xl" />
					<div className="pt-3">
						<Skeleton className="h-5 w-3/4 rounded" />
						<Skeleton className="mt-1.5 h-6 w-1/2 rounded-full" />
					</div>
				</div>
			))}
		</div>
	);
}
