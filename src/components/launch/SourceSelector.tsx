import * as React from "react";
import { Monitor, AppWindow } from "@phosphor-icons/react";
import { useMemo, useCallback, useEffect } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
}

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
}: SourceSelectorProps) {
	const t = useScopedT("launch");

	// Fetch sources when popover opens
	useEffect(() => {
		if (open) {
			void onFetchSources();
		}
	}, [open, onFetchSources]);

	// Memoized source item to prevent unnecessary re-renders
	const SourceItem = useCallback(
		({ source, isSelected }: { source: DesktopSource; isSelected: boolean }) => (
			<button
				type="button"
				className={cn(
					"flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors",
					"hover:bg-accent hover:text-accent-foreground",
					isSelected && "bg-accent text-accent-foreground",
				)}
				onClick={() => onSourceSelect(source)}
			>
				{/* Thumbnail with fallback */}
				<div className="relative flex-shrink-0">
					{source.thumbnail ? (
						<img
							src={source.thumbnail}
							alt=""
							className="w-12 h-8 rounded-md object-cover bg-black/50"
							onError={(e) => {
								(e.target as HTMLImageElement).style.display = "none";
							}}
						/>
					) : (
						<div className="w-12 h-8 rounded-md bg-muted flex items-center justify-center">
							{source.sourceType === "window" ? (
								<AppWindow className="w-5 h-5 text-muted-foreground" />
							) : (
								<Monitor className="w-5 h-5 text-muted-foreground" />
							)}
						</div>
					)}
					{isSelected && (
						<div className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-primary rounded-full flex items-center justify-center">
							<div className="w-1.5 h-1.5 bg-primary-foreground rounded-full" />
						</div>
					)}
				</div>

				{/* Source info */}
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<span className="text-sm font-medium truncate">
							{source.windowTitle || source.name}
						</span>
						{source.appName && source.appName !== source.name && (
							<span className="text-xs text-muted-foreground truncate">
								{source.appName}
							</span>
						)}
					</div>
					<div className="text-xs text-muted-foreground truncate">
						{source.sourceType === "screen" ? t("recording.screen") : t("recording.window")}
					</div>
				</div>
			</button>
		),
		[onSourceSelect, t],
	);

	// Memoized section for screens
	const screenSection = useMemo(() => {
		if (screenSources.length === 0) return null;

		return (
			<div className="space-y-1">
				<div className="px-3 py-2 text-xs font-medium text-muted-foreground">
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
				<div className="px-3 py-2 text-xs font-medium text-muted-foreground">
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

	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					className={cn(
						"w-full justify-between",
						"data-[state=open]:bg-accent",
					)}
				>
					<span className="truncate">{selectedSource}</span>
					<Monitor className="w-4 h-4 ml-2 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				className="w-80 p-0"
				align="start"
				sideOffset={8}
				side="bottom"
				alignOffset={-8}
				avoidCollisions={true}
				collisionPadding={10}
			>
				{loading ? (
					<div className="flex items-center justify-center py-8">
						<div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
					</div>
				) : (
					<div className="max-h-[320px] overflow-y-auto overflow-x-hidden p-2">
						{screenSection || windowSection ? (
							<>
								{screenSection}
								{windowSection}
							</>
						) : (
							<div className="text-center py-8 text-sm text-muted-foreground">
								{t("recording.noSourcesFound")}
							</div>
						)}
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
});

SourceSelector.displayName = "SourceSelector";
