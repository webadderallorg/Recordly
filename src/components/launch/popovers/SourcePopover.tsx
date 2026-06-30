import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SourceSelector } from "../SourceSelector";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import {
	type DesktopSource,
	isScreenSource,
	isWindowSource,
	mapRawSource,
} from "./launchPopoverTypes";
import { createSourcePreviewRequestGate } from "./sourcePreviewRequestGate";

const POPOVER_ID = "sources";

function getHighlightSource(source: DesktopSource): DesktopSource {
	return {
		...source,
		name: source.appName ? `${source.appName} — ${source.name}` : source.name,
		appName: source.appName,
	};
}

export function SourcePopover({
	trigger,
	selectedSource,
	onSourceSelect,
	onOpen,
}: {
	trigger: ReactNode;
	selectedSource: string;
	onSourceSelect: (source: DesktopSource) => Promise<void> | void;
	onOpen?: () => void;
}) {
	const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
	const [sources, setSources] = useState<DesktopSource[]>([]);
	const [loading, setLoading] = useState(false);
	const open = isOpen(POPOVER_ID);
	const wasOpenRef = useRef(open);
	const previewRequestGate = useMemo(() => createSourcePreviewRequestGate(), []);

	const fetchSources = useCallback(async () => {
		if (!window.electronAPI) return;
		setLoading(true);
		try {
			const rawSources = await window.electronAPI.getSources({
				types: ["screen", "window"],
				thumbnailSize: { width: 160, height: 90 },
				fetchWindowIcons: true,
			});
			setSources(rawSources.map((s) => mapRawSource(s as DesktopSource)));
		} catch (error) {
			console.error("Failed to fetch sources:", error);
		} finally {
			setLoading(false);
		}
	}, []);

	const screenSources = useMemo(() => sources.filter(isScreenSource), [sources]);
	const windowSources = useMemo(() => sources.filter(isWindowSource), [sources]);
	const clearSourceHighlight = useCallback((context: string) => {
		const clearPromise = window.electronAPI?.clearSourceHighlight?.();
		if (clearPromise) {
			void clearPromise.catch((error) => {
				console.warn(`Failed to clear source highlight ${context}:`, error);
			});
		}
	}, []);
	const showSourcePreview = useCallback(
		(source: DesktopSource) => {
			const requestId = previewRequestGate.next();
			void (async () => {
				const platform = await window.electronAPI.getPlatform();
				if (!previewRequestGate.isCurrent(requestId)) {
					return;
				}
				if (platform === "linux") {
					clearSourceHighlight("for Linux preview");
					return;
				}
				const result = await window.electronAPI?.showSourceHighlight?.(
					getHighlightSource(source),
					{
						activateWindow: false,
					},
				);
				if (!previewRequestGate.isCurrent(requestId)) {
					return;
				}
				if (result && !result.success) {
					clearSourceHighlight("after preview failed");
				}
			})().catch((error) => {
				console.warn("Failed to preview source highlight:", error);
				if (previewRequestGate.isCurrent(requestId)) {
					clearSourceHighlight("after preview failed");
				}
			});
		},
		[clearSourceHighlight, previewRequestGate],
	);
	const restoreSelectedSourcePreview = useCallback(() => {
		const requestId = previewRequestGate.next();
		void (async () => {
			const platform = await window.electronAPI.getPlatform();
			if (!previewRequestGate.isCurrent(requestId)) {
				return;
			}
			if (platform === "linux") {
				clearSourceHighlight("for Linux restore");
				return;
			}
			const selected = await window.electronAPI?.getSelectedSource?.();
			if (!previewRequestGate.isCurrent(requestId)) {
				return;
			}
			if (selected) {
				const result = await window.electronAPI?.showSourceHighlight?.(selected, {
					activateWindow: false,
				});
				if (!previewRequestGate.isCurrent(requestId)) {
					return;
				}
				if (result && !result.success) {
					clearSourceHighlight("after restore failed");
				}
				return;
			}
			clearSourceHighlight("with no selected source");
		})().catch((error) => {
			console.error("Failed to restore source highlight:", error);
			if (previewRequestGate.isCurrent(requestId)) {
				clearSourceHighlight("after restore failed");
			}
		});
	}, [clearSourceHighlight, previewRequestGate]);

	useEffect(() => {
		if (wasOpenRef.current && !open) {
			restoreSelectedSourcePreview();
		}
		wasOpenRef.current = open;
	}, [open, restoreSelectedSourcePreview]);

	useEffect(() => {
		return () => {
			restoreSelectedSourcePreview();
		};
	}, [restoreSelectedSourcePreview]);

	return (
		<SourceSelector
			screenSources={screenSources}
			windowSources={windowSources}
			selectedSource={selectedSource}
			loading={loading}
			onSourceHover={showSourcePreview}
			onSourceHoverEnd={restoreSelectedSourcePreview}
			onSourceSelect={async (source) => {
				try {
					await onSourceSelect(source);
					requestClose(POPOVER_ID);
				} catch (error) {
					console.error("Failed to select source:", error);
				}
			}}
			onFetchSources={fetchSources}
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					requestClose(POPOVER_ID);
					return;
				}
				onOpen?.();
				requestOpen(POPOVER_ID);
			}}
		>
			{trigger}
		</SourceSelector>
	);
}
