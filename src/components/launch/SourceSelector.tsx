import * as React from "react";
import { Monitor, AppWindow, CaretUp as ChevronUp } from "@phosphor-icons/react";
import { useMemo, useCallback, useEffect } from "react";
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

const MarqueeText = ({
	text,
	className,
	speed = 50, // px per second
}: {
	text: string;
	className?: string;
	speed?: number;
}) => {
	const containerRef = React.useRef<HTMLDivElement>(null);
	const [shouldMarquee, setShouldMarquee] = React.useState(false);
	const [duration, setDuration] = React.useState(0);
	const [translate, setTranslate] = React.useState("0px");

	React.useEffect(() => {
		const checkOverflow = () => {
			const container = containerRef.current;
			if (container) {
				const containerWidth = container.clientWidth;
				// Create a temporary span to measure the text width accurately
				const span = document.createElement("span");
				span.style.visibility = "hidden";
				span.style.position = "absolute";
				span.style.whiteSpace = "nowrap";
				span.style.font = window.getComputedStyle(container).font;
				span.innerText = text;
				document.body.appendChild(span);
				
				const textWidth = span.offsetWidth;
				document.body.removeChild(span);

				const hasOverflow = textWidth > containerWidth && containerWidth > 0;
				setShouldMarquee(hasOverflow);
				
				if (hasOverflow) {
					const overflow = textWidth - containerWidth;
					setDuration(textWidth / speed);
					setTranslate(`-${overflow}px`);
				}
			}
		};

		// Use a small timeout to ensure layout is done
		const timeout = setTimeout(checkOverflow, 50);
		
		window.addEventListener("resize", checkOverflow);
		return () => {
			clearTimeout(timeout);
			window.removeEventListener("resize", checkOverflow);
		};
	}, [text, speed]);

	return (
		<div
			ref={containerRef}
			className={cn("relative overflow-hidden w-full", className)}
		>
			<div
				className={cn(
					"whitespace-nowrap transition-all duration-500",
					shouldMarquee ? "truncate group-hover:overflow-visible group-hover:w-max group-hover:animate-[marquee_var(--marquee-duration)_linear_infinite_alternate]" : "truncate"
				)}
				style={
					shouldMarquee
						? ({
								"--marquee-duration": `${duration}s`,
								"--marquee-translate": translate,
						  } as React.CSSProperties)
						: {}
				}
			>
				{text}
			</div>
		</div>
	);
};

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

	// Memoized source item to prevent unnecessary re-renders
	const SourceItem = useCallback(
		({ source, isSelected }: { source: DesktopSource; isSelected: boolean }) => (
			<Button
				variant="ghost"
				size="sm"
				className={cn(
					"source-selector-item group !h-auto w-full justify-start gap-3 rounded-[11px] px-3 py-2.5 text-left font-medium",
					isSelected && "source-selector-item-selected",
				)}
				onClick={() => onSourceSelect(source)}
			>
				{/* Thumbnail with fallback */}
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
					{isSelected && (
						<div className="source-selector-dot absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center">
							<div className="w-1.5 h-1.5 source-selector-dot-inner rounded-full" />
						</div>
					)}
				</div>

				{/* Source info */}
				<div className="flex-1 min-w-0 flex flex-col items-start text-left">
					<div className="flex items-center gap-2 w-full overflow-hidden">
						<MarqueeText 
							text={source.windowTitle || source.name}
							className="text-sm font-medium source-selector-text"
							speed={40}
						/>
						{source.appName && source.appName !== source.name && (
							<span className="text-xs source-selector-muted truncate shrink-0">
								{source.appName}
							</span>
						)}
					</div>
					<div className="text-xs source-selector-subtle truncate w-full text-left">
						{source.sourceType === "screen" ? t("recording.screen") : t("recording.window")}
					</div>
				</div>
			</Button>
		),
		[onSourceSelect, t],
	);

	// Memoized section for screens
	const screenSection = useMemo(() => {
		if (screenSources.length === 0) return null;

		return (
			<div className="space-y-1">
				<div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] source-selector-label">
					{t("recording.screens")}
				</div>
				<div className="space-y-0.5">
					{screenSources.map((source) => (
						<SourceItem
							key={source.id}
							source={source}
							isSelected={selectedSource === source.name}
						/>
					))}
				</div>
			</div>
		);
	}, [screenSources, selectedSource, SourceItem, t]);

	// Memoized section for windows
	const windowSection = useMemo(() => {
		if (windowSources.length === 0) return null;

		return (
			<div className="space-y-1">
				<div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] source-selector-label">
					{t("recording.windows")}
				</div>
				<div className="space-y-0.5">
					{windowSources.map((source) => (
						<SourceItem
							key={source.id}
							source={source}
							isSelected={selectedSource === source.name}
						/>
					))}
				</div>
			</div>
		);
	}, [windowSources, selectedSource, SourceItem, t]);

	if (loading) {
		return (
			<div className="flex items-center justify-center py-8">
				<div className="animate-spin rounded-full h-5 w-5 border-b-2 source-selector-accent-border" />
			</div>
		);
	}

	return (
		<div className="max-h-[320px] overflow-y-auto overflow-x-hidden p-2 source-selector-scroll">
			{screenSection || windowSection ? (
				<>
					{screenSection}
					{windowSection}
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
	// Fetch sources when popover opens
	useEffect(() => {
		if (open) {
			void onFetchSources();
		}
	}, [open, onFetchSources]);

	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger asChild>
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
							<MarqueeText 
								text={selectedSource} 
								speed={40}
							/>
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
