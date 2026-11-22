import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { WindowControls } from "./WindowControls";

export function AppFrameHeader({
	children,
	className = "",
}: {
	children: ReactNode;
	className?: string;
}) {
	const [chrome, setChrome] = useState({
		customControls: false,
		maximized: false,
	});
	useEffect(() => {
		let disposed = false;
		const update = (state: { customControls?: boolean; maximized?: boolean }) => {
			if (!disposed)
				setChrome({
					customControls: state.customControls === true,
					maximized: state.maximized === true,
				});
		};
		void window.electronAPI
			?.getWindowChrome?.()
			.then(update)
			.catch(() => undefined);
		const unsubscribe = window.electronAPI?.onWindowChromeChanged?.(update);
		return () => {
			disposed = true;
			unsubscribe?.();
		};
	}, []);
	return (
		<>
			<header
				className={`app-frame-header relative z-50 grid h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-separator bg-background px-4 [--text-sm:0.8125rem] ${className}`}
				style={
					{
						WebkitAppRegion: "drag",
						...(chrome.customControls
							? { gridTemplateColumns: "minmax(0, 1fr) auto auto" }
							: {}),
					} as CSSProperties
				}
			>
				{children}
				{chrome.customControls && <WindowControls maximized={chrome.maximized} />}
			</header>
		</>
	);
}
