import { useCallback, useMemo, type ReactNode, useState } from "react";
import { SourceSelector } from "../SourceSelector";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import { mapRawSource, type DesktopSource, type RawDesktopSource } from "./launchPopoverTypes";

const POPOVER_ID = "sources";

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

	const fetchSources = useCallback(async () => {
		if (!window.electronAPI) return;
		setLoading(true);
		try {
			const rawSources = await window.electronAPI.getSources({
				types: ["screen", "window"],
				thumbnailSize: { width: 160, height: 90 },
				fetchWindowIcons: true,
			});
			setSources(rawSources.map((s) => mapRawSource(s as RawDesktopSource)));
		} catch (error) {
			console.error("Failed to fetch sources:", error);
		} finally {
			setLoading(false);
		}
	}, []);

	const screenSources = useMemo(
		() => sources.filter((s) => s.sourceType === "screen" || s.id.startsWith("screen:")),
		[sources],
	);
	const windowSources = useMemo(
		() => sources.filter((s) => s.sourceType === "window" || s.id.startsWith("window:")),
		[sources],
	);

	return (
		<SourceSelector
			screenSources={screenSources}
			windowSources={windowSources}
			selectedSource={selectedSource}
			loading={loading}
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
