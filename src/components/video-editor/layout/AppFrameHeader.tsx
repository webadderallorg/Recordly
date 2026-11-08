import type { CSSProperties, ReactNode } from "react";

export function AppFrameHeader({
	children,
	className = "",
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<>
			<header
				className={`app-frame-header relative z-50 grid h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-separator bg-background px-4 [--text-sm:0.8125rem] ${className}`}
				style={{ WebkitAppRegion: "drag" } as CSSProperties}
			>
				{children}
			</header>
		</>
	);
}
