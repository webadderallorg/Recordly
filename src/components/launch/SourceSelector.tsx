import * as React from "react";
import { Monitor, AppWindow, CaretUp as ChevronUp } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import "./launchTheme.css";
import "./SourceSelector.css";

interface DesktopSource {
	id: string;
	name: string;
	thumbnail: string | null;
	display_id: string;
	appIcon: string | null;
	sourceType?: "screen" | "window";
	appName?: string;
	windowTitle?: string;
}

interface SourceSelectorProps {
	/** List of available screen sources */
	screenSources?: DesktopSource[];
	/** List of available window sources */
	windowSources?: DesktopSource[];
	/** Currently selected source name */
	selectedSource?: string;
	/** Loading state */
	loading?: boolean;
	/** Callback when a source is selected */
	onSourceSelect?: (source: DesktopSource) => void;
	/** Callback to fetch sources */
	onFetchSources?: () => Promise<void>;
	/** Whether the popover is open */
	open?: boolean;
	/** Callback when open state changes */
	onOpenChange?: (open: boolean) => void;
	/** Optional custom trigger element */
	children?: React.ReactNode;
}

export function MarqueeText({ text }: { text: string }) {
	const staticRef = useRef<HTMLSpanElement>(null);
	const [overflowing, setOverflowing] = useState(false);

	useLayoutEffect(() => {
		const node = staticRef.current;
		if (!node) return;
		const checkOverflow = () => {
			setOverflowing(node.scrollWidth > node.clientWidth + 1);
		};
		checkOverflow();
		const observer = new ResizeObserver(checkOverflow);
		observer.observe(node);
		return () => observer.disconnect();
	}, [text]);

	return (
		<div
			className="w-full source-selector-marquee"
			data-overflowing={overflowing ? "true" : "false"}
		>
			<span ref={staticRef} className="source-selector-marquee-static">
				{text}
			</span>
			<span className="source-selector-marquee-animated">
				<span className="source-selector-marquee-track">
					<span className="source-selector-marquee-segment">{text}</span>
					<span className="source-selector-marquee-segment source-selector-marquee-duplicate">
						{text}
					</span>
				</span>
			</span>
		</div>
	);
}

/**
 * SourceSelectorContent - The actual list of sources
 */
export const SourceSelectorContent = ({
	screenSources = [],
	windowSources = [],
	selectedSource = "Screen",
	loading = false,
	onSourceSelect = () => {},
}: Pick<SourceSelectorProps, "screenSources" | "windowSources" | "selectedSource" | "loading" | "onSourceSelect">) => {
	const t = useScopedT("launch");
	const renderSourceItem = (source: DesktopSource, index: number) => {
		const isSelected = selectedSource === source.name;
		return (
			<button
				key={`${source.id}-${index}`}
				type="button"
				className={cn(
					"source-selector-item group min-h-[46px] w-full rounded-[11px] px-3 py-2.5 text-left font-medium flex items-center justify-start gap-3",
					isSelected && "source-selector-item-selected",
				)}
				onClick={() => onSourceSelect(source)}
			>
				<div className="relative flex-shrink-0">
					{source.thumbnail ? (
						<img
							src={source.thumbnail}
							alt=""
							className="w-12 h-8 rounded-[8px] object-cover bg-black/50"
							onError={(e) => {
								(e.target as HTMLImageElement).style.display = "none";
							}}
						/>
					) : (
						<div className="source-selector-thumb-fallback w-12 h-8 rounded-[8px] flex items-center justify-center">
							{source.sourceType === "window" ? (
								<AppWindow className="w-5 h-5 source-selector-muted" />
							) : (
								<Monitor className="w-5 h-5 source-selector-muted" />
							)}
						</div>
					)}
				</div>

					<div className="flex-1 min-w-0 flex flex-col items-start text-left">
					<div className="text-sm font-medium source-selector-text w-full">
						<MarqueeText text={source.windowTitle || source.name} />
					</div>
					<div className="text-xs source-selector-subtle truncate w-full text-left">
						{source.sourceType === "screen" ? t("recording.screen") : t("recording.window")}
					</div>
				</div>
			</button>
		);
	};

	const hasAnySources = screenSources.length > 0 || windowSources.length > 0;

	if (loading && !hasAnySources) {
		return (
			<div className="flex items-center justify-center py-8">
				<div className="animate-spin rounded-full h-5 w-5 border-b-2 source-selector-accent-border" />
			</div>
		);
	}

	return (
		<div className="max-h-[320px] overflow-y-auto overflow-x-hidden p-2 source-selector-scroll">
			{hasAnySources ? (
				<>
					{screenSources.length > 0 ? (
						<div className="space-y-1">
							<div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] source-selector-label flex items-center gap-2">
								{t("recording.screens")}
								<span
									className={cn(
										"normal-case tracking-normal text-[10px] source-selector-muted transition-opacity duration-150",
										loading ? "opacity-100" : "opacity-0",
									)}
								>
									{t("common.loading", "Refreshing...")}
								</span>
							</div>
							<div className="space-y-0.5">
								{screenSources.map((source, index) => renderSourceItem(source, index))}
							</div>
						</div>
					) : null}
					{windowSources.length > 0 ? (
						<div className="space-y-1">
							<div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] source-selector-label">
								{t("recording.windows")}
							</div>
							<div className="space-y-0.5">
								{windowSources.map((source, index) => renderSourceItem(source, index))}
							</div>
						</div>
					) : null}
				</>
			) : (
				<div className="text-center py-8 text-sm source-selector-muted">
					{t("recording.noSourcesFound")}
				</div>
			)}
		</div>
	);
};

/**
 * SourceSelector - A rich source selection component with thumbnails
 * Uses Radix UI Popover for positioning and accessibility
 */
export const SourceSelector = React.memo(function SourceSelector({
	screenSources = [],
	windowSources = [],
	selectedSource = "Screen",
	loading = false,
	onSourceSelect = () => {},
	onFetchSources = async () => {},
	open = false,
	onOpenChange = () => {},
	children,
}: SourceSelectorProps) {
	const hasPrefetchedRef = useRef(false);

	const prefetchSources = React.useCallback(() => {
		if (hasPrefetchedRef.current) {
			return;
		}
		hasPrefetchedRef.current = true;
		void onFetchSources();
	}, [onFetchSources]);

	// Fetch sources when popover opens
	useEffect(() => {
		if (open) {
			void onFetchSources();
		}
	}, [open, onFetchSources]);

	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger asChild>
				<div onPointerEnter={prefetchSources} onFocusCapture={prefetchSources}>
					{children || (
						<Button
							variant="outline"
							size="lg"
							className={cn(
								"group gap-2 px-3 min-w-0 max-w-[180px] rounded-[11px] font-medium text-[12px] [ -webkit-app-region:no-drag ] shrink-0",
								"border-[#2a2a34] bg-[#1a1a22] text-[#eeeef2] hover:border-[#3e3e4c] hover:bg-[#20202a] transition-all",
								"data-[state=open]:border-[#3e3e4c] data-[state=open]:bg-[#20202a]",
							)}
							title={selectedSource}
						>
							<Monitor size={16} className="shrink-0" />
							<div className="flex-1 min-w-0">
								<MarqueeText text={selectedSource} />
							</div>
							<ChevronUp
								size={10}
								className={cn(
									"text-[#6b6b78] ml-0.5 shrink-0 transition-transform duration-200",
									open ? "" : "rotate-180",
								)}
							/>
						</Button>
					)}
				</div>
			</PopoverTrigger>
			<PopoverContent
				className="launch-theme w-80 p-0 source-selector-popover"
				unstyled
				align="start"
				sideOffset={8}
				side="bottom"
				alignOffset={-8}
				avoidCollisions={true}
				collisionPadding={10}
				usePortal={false}
			>
				<SourceSelectorContent 
					screenSources={screenSources}
					windowSources={windowSources}
					selectedSource={selectedSource}
					loading={loading}
					onSourceSelect={onSourceSelect}
				/>
			</PopoverContent>
		</Popover>
	);
});

SourceSelector.displayName = "SourceSelector";
