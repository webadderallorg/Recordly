import { useCallback, useEffect, useMemo, useState } from "react";
import { SourceSelector } from "./SourceSelector";
import type { DesktopSource } from "./popovers/launchPopoverTypes";

export function StandaloneSourceSelector() {
	const [sources, setSources] = useState<DesktopSource[]>([]);
	const [loading, setLoading] = useState(false);
	const [selectedSourceName, setSelectedSourceName] = useState<string>("Screen");
	const [open, setOpen] = useState(true);

	const fetchSources = useCallback(async () => {
		if (!window.electronAPI) return;
		setLoading(true);
		try {
			const rawSources = await window.electronAPI.getSources({
				types: ["screen", "window"],
				thumbnailSize: { width: 160, height: 90 },
				fetchWindowIcons: true,
			});
			setSources(
				rawSources.map((s: any) => {
					const isWindow = s.id.startsWith("window:");
					const type = s.sourceType ?? (isWindow ? "window" : "screen");
					let displayName = s.name;
					let appName = s.appName;
					if (isWindow && !appName && s.name.includes(" — ")) {
						const parts = s.name.split(" — ");
						appName = parts[0]?.trim();
						displayName = parts.slice(1).join(" — ").trim() || s.name;
					} else if (isWindow && s.windowTitle) {
						displayName = s.windowTitle;
					}
					return {
						id: s.id,
						name: displayName,
						thumbnail: s.thumbnail,
						display_id: s.display_id,
						appIcon: s.appIcon,
						sourceType: type,
						appName,
						windowTitle: s.windowTitle ?? displayName,
					};
				}),
			);
		} catch (error) {
			console.error("Failed to fetch sources:", error);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void fetchSources();
	}, [fetchSources]);

	const handleSourceSelect = useCallback(async (source: DesktopSource) => {
		if (!window.electronAPI) return;
		try {
			const result = await window.electronAPI.selectSource(source);
			if (result) {
				setSelectedSourceName(source.name);
			}
		} catch (error) {
			console.error("Failed to select source:", error);
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
		<div className="flex items-center justify-center h-full w-full p-4">
			<SourceSelector
				screenSources={screenSources}
				windowSources={windowSources}
				selectedSource={selectedSourceName}
				loading={loading}
				onSourceSelect={handleSourceSelect}
				onFetchSources={fetchSources}
				open={open}
				onOpenChange={setOpen}
			/>
		</div>
	);
}
