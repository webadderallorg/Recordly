import { type ReactNode, useEffect, useState } from "react";
import "./loading-transition.css";

/** Keep the placeholder underneath the reveal so loading never flashes an empty page. */
export function LoadingTransition({
	loading,
	fallback,
	children,
	className = "",
}: {
	loading: boolean;
	fallback: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	const [retainingPlaceholder, setRetainingPlaceholder] = useState(loading);
	useEffect(() => {
		if (loading) {
			setRetainingPlaceholder(true);
			return;
		}
		const timer = window.setTimeout(() => setRetainingPlaceholder(false), 200);
		return () => window.clearTimeout(timer);
	}, [loading]);
	return (
		<div className={`loading-transition ${className}`} data-loading={loading}>
			{!loading && (
				<div className={retainingPlaceholder ? "loading-content-enter" : undefined}>
					{children}
				</div>
			)}
			{(loading || retainingPlaceholder) && (
				<div
					className="loading-placeholder"
					data-retiring={!loading}
					aria-hidden={!loading || undefined}
					inert={!loading}
				>
					{fallback}
				</div>
			)}
		</div>
	);
}
