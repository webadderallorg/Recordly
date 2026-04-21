/**
 * ExtensionManager — Sidebar panel for browsing, installing, and managing extensions.
 *
 * Matches the SettingsPanel sidebar styling with tabs:
 *   - Browse: Marketplace search and download
 *   - Installed: Local extensions with toggle switches
 */

import {
	BookOpen,
	Check,
	CaretLeft as ChevronLeft,
	CaretRight as ChevronRight,
	DownloadSimple as Download,
	ArrowSquareOut as ExternalLink,
	FolderOpen,
	SpinnerGap as Loader2,
	Plus,
	PuzzlePiece as Puzzle,
	ArrowsClockwise as RefreshCw,
	MagnifyingGlass as Search,
	ShieldWarning as ShieldAlert,
	Tag,
	Trash as Trash2,
} from "@phosphor-icons/react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useScopedT } from "@/contexts/I18nContext";
import { useExtensions } from "@/hooks/useExtensions";
import type { ExtensionInfo, MarketplaceExtension } from "@/lib/extensions";
import { cn } from "@/lib/utils";
import { ExtensionIcon } from "./ExtensionIcon";

type ExtensionTab = "installed" | "browse";

const TAB_OPTIONS: { value: ExtensionTab; labelKey: string }[] = [
	{ value: "browse", labelKey: "tabs.browse" },
	{ value: "installed", labelKey: "tabs.installed" },
];

const EXTENSIONS_DOCS_URL = "https://marketplace.recordly.dev/extensions";
const EXTENSIONS_SUBMIT_URL = "https://marketplace.recordly.dev/extensions/submit";

function toSafeHttpUrl(value?: string): string | null {
	if (!value) return null;

	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:"
			? parsed.toString()
			: null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Installed Extension Card
// ---------------------------------------------------------------------------

function InstalledExtensionCard({
	extension,
	isActive,
	onToggle,
	onUninstall,
	onClick,
}: {
	extension: ExtensionInfo;
	isActive: boolean;
	onToggle: () => void;
	onUninstall?: () => void;
	onClick?: () => void;
}) {
	const t = useScopedT("extensions");
	const isError = extension.status === "error";
	const isBuiltin = extension.builtin;
	const homepageUrl = toSafeHttpUrl(extension.manifest.homepage);

	return (
		<div
			className={cn(
				"flex items-start gap-3 p-3 rounded-xl border transition-colors cursor-pointer",
				isError
					? "border-red-500/30 bg-red-500/5"
					: isActive
						? "border-[#2563EB]/20 bg-[#2563EB]/5"
						: "border-foreground/[0.06] bg-white/[0.02] hover:bg-foreground/[0.04]",
			)}
			onClick={onClick}
		>
			<div className="flex-shrink-0 w-8 h-8 rounded-lg bg-foreground/5 border border-foreground/10 flex items-center justify-center overflow-hidden">
				<ExtensionIcon
					icon={extension.manifest.icon}
					extensionPath={extension.path}
					className="w-3.5 h-3.5 text-muted-foreground"
					imageClassName="w-8 h-8 rounded-lg"
				/>
			</div>

			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-1.5">
					<span className="text-[13px] font-medium text-foreground truncate">
						{extension.manifest.name}
					</span>
				</div>

				{extension.manifest.author && (
					<p className="text-[10px] text-muted-foreground/70 mt-0.5">
						{homepageUrl ? (
							<a
								href={homepageUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="hover:text-muted-foreground transition-colors"
								onClick={(e) => e.stopPropagation()}
							>
								{t("detail.by", undefined, { author: extension.manifest.author })}
							</a>
						) : (
							<>{t("detail.by", undefined, { author: extension.manifest.author })}</>
						)}
					</p>
				)}

				<p className="text-[11px] text-muted-foreground/70 mt-0.5 line-clamp-3">
					{extension.manifest.description || t("detail.noDescription")}
				</p>

				{isError && extension.error && (
					<p className="text-[10px] text-red-400 mt-1">
						{t("detail.error", undefined, { message: extension.error })}
					</p>
				)}

				{extension.manifest.permissions.length > 0 && (
					<div className="flex gap-1 mt-1.5 flex-wrap">
						{extension.manifest.permissions.map((perm) => (
							<span
								key={perm}
								className="text-[8px] px-1 py-[1px] rounded bg-foreground/5 text-muted-foreground font-mono"
							>
								{perm}
							</span>
						))}
					</div>
				)}
			</div>

			<div className="flex items-center gap-1.5 flex-shrink-0">
				{!isBuiltin && onUninstall && (
					<Button
						variant="ghost"
						size="icon"
						className="h-6 w-6 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
						onClick={(e) => {
							e.stopPropagation();
							onUninstall();
						}}
						title={t("actions.uninstall")}
					>
						<Trash2 className="w-3 h-3" />
					</Button>
				)}
				<div onClick={(e) => e.stopPropagation()}>
					<Switch checked={isActive} onCheckedChange={onToggle} disabled={isError} />
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Marketplace Extension Card
// ---------------------------------------------------------------------------

function MarketplaceCard({
	extension,
	isInstalling,
	onInstall,
	onClick,
}: {
	extension: MarketplaceExtension;
	isInstalling: boolean;
	onInstall: () => void;
	onClick?: () => void;
}) {
	const t = useScopedT("extensions");
	const homepageUrl = toSafeHttpUrl(extension.homepage);
	return (
		<div
			className="flex items-start gap-3 p-3 rounded-xl border border-foreground/[0.06] bg-white/[0.02] hover:bg-foreground/[0.04] transition-colors cursor-pointer"
			onClick={onClick}
		>
			<div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-white/10 to-white/5 border border-foreground/10 flex items-center justify-center overflow-hidden">
				{extension.iconUrl ? (
					<img
						src={extension.iconUrl}
						alt=""
						className="w-8 h-8 rounded-lg object-cover"
					/>
				) : (
					<ExtensionIcon icon={undefined} className="w-3.5 h-3.5 text-muted-foreground" />
				)}
			</div>

			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-1.5">
					<span className="text-[13px] font-medium text-foreground truncate">
						{extension.name}
					</span>
				</div>

				<p className="text-[10px] text-muted-foreground/70 mt-0.5">
					{homepageUrl ? (
						<a
							href={homepageUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="hover:text-muted-foreground transition-colors"
							onClick={(e) => e.stopPropagation()}
						>
							{t("detail.by", undefined, { author: extension.author })}
						</a>
					) : (
						<>{t("detail.by", undefined, { author: extension.author })}</>
					)}
				</p>

				<p className="text-[11px] text-muted-foreground/70 mt-0.5 line-clamp-3">
					{extension.description}
				</p>

				<div className="flex items-center gap-3 mt-1.5">
					<span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
						<Download className="w-2.5 h-2.5" />
						{extension.downloads.toLocaleString()}
					</span>
				</div>

				{extension.tags.length > 0 && (
					<div className="flex gap-1 mt-1.5 flex-wrap">
						{extension.tags.slice(0, 3).map((tag) => (
							<span
								key={tag}
								className="text-[8px] px-1 py-[1px] rounded bg-[#2563EB]/10 text-[#2563EB]/70 font-medium"
							>
								{tag}
							</span>
						))}
					</div>
				)}
			</div>

			<div className="flex-shrink-0">
				{extension.installed ? (
					<span className="flex items-center gap-1 text-[10px] text-emerald-500 font-medium">
						<Check className="w-3 h-3" />
						{t("status.installed")}
					</span>
				) : (
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-2.5 text-[11px] text-[#2563EB] hover:text-[#2563EB] hover:bg-[#2563EB]/10 font-medium gap-1"
						onClick={(e) => {
							e.stopPropagation();
							onInstall();
						}}
						disabled={isInstalling}
					>
						{isInstalling ? (
							<Loader2 className="w-3 h-3 animate-spin" />
						) : (
							<Download className="w-3 h-3" />
						)}
						{isInstalling ? t("actions.installing") : t("actions.install")}
					</Button>
				)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Screenshot Gallery Carousel
// ---------------------------------------------------------------------------

function ScreenshotGallery({ screenshots }: { screenshots: string[] }) {
	const t = useScopedT("extensions");
	const [index, setIndex] = useState(0);
	const count = screenshots.length;
	if (count === 0) return null;

	return (
		<div>
			<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 mb-1.5">
				{t("detail.preview")}
			</p>
			<div className="relative group rounded-lg overflow-hidden bg-black/20 border border-foreground/[0.06]">
				<img
					src={screenshots[index]}
					alt={t("detail.screenshotAlt", undefined, { number: String(index + 1) })}
					className="w-full aspect-video object-cover"
				/>
				{count > 1 && (
					<>
						<button
							type="button"
							className="absolute start-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-editor-bg/80 text-foreground/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-editor-bg/80"
							onClick={() => setIndex((i) => (i - 1 + count) % count)}
						>
							<ChevronLeft className="w-3.5 h-3.5" />
						</button>
						<button
							type="button"
							className="absolute end-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-editor-bg/80 text-foreground/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-editor-bg/80"
							onClick={() => setIndex((i) => (i + 1) % count)}
						>
							<ChevronRight className="w-3.5 h-3.5" />
						</button>
						<div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-1">
							{screenshots.map((_, i) => (
								<button
									type="button"
									key={i}
									className={cn(
										"w-1.5 h-1.5 rounded-full transition-colors",
										i === index ? "bg-white" : "bg-white/30 hover:bg-foreground/50",
									)}
									onClick={() => setIndex(i)}
								/>
							))}
						</div>
					</>
				)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Extension Detail (unified type for installed + marketplace)
// ---------------------------------------------------------------------------

type ExtensionDetailData =
	| { source: "installed"; ext: ExtensionInfo; isActive: boolean }
	| { source: "marketplace"; ext: MarketplaceExtension };

function ExtensionDetailModal({
	detail,
	onClose,
	onToggle,
	onInstall,
	isInstalling,
}: {
	detail: ExtensionDetailData;
	onClose: () => void;
	onToggle?: () => void;
	onInstall?: () => void;
	isInstalling?: boolean;
}) {
	const t = useScopedT("extensions");
	const isInstalled = detail.source === "installed";
	const name = isInstalled ? detail.ext.manifest.name : detail.ext.name;
	const description = isInstalled
		? detail.ext.manifest.description || t("detail.noDescription")
		: detail.ext.description || t("detail.noDescription");
	const author = isInstalled ? detail.ext.manifest.author : detail.ext.author;
	const permissions = isInstalled ? detail.ext.manifest.permissions : detail.ext.permissions;
	const homepage = isInstalled ? detail.ext.manifest.homepage : detail.ext.homepage;
	const homepageUrl = toSafeHttpUrl(homepage);
	const screenshots = detail.source === "marketplace" ? (detail.ext.screenshots ?? []) : [];
	const isError = isInstalled ? detail.ext.status === "error" : false;

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="max-w-md bg-editor-panel border-foreground/10 text-foreground p-0 gap-0 overflow-hidden">
				{/* Header */}
				<div className="p-5 pb-4">
					<div className="flex items-start gap-3.5">
						<div className="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-[#2563EB]/20 to-[#2563EB]/5 border border-foreground/10 flex items-center justify-center">
							{detail.source === "marketplace" && detail.ext.iconUrl ? (
								<img
									src={detail.ext.iconUrl}
									alt=""
									className="w-7 h-7 rounded-lg"
								/>
							) : (
								<ExtensionIcon
									icon={isInstalled ? detail.ext.manifest.icon : undefined}
									extensionPath={isInstalled ? detail.ext.path : undefined}
									className="w-5 h-5 text-[#2563EB]/60"
								/>
							)}
						</div>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-1.5">
								<h2 className="text-[15px] font-semibold text-foreground truncate">
									{name}
								</h2>
							</div>
							<p className="text-[11px] text-muted-foreground/70 mt-0.5">
								{author ? (
									homepageUrl ? (
										<a
											href={homepageUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="hover:text-muted-foreground transition-colors inline-flex items-center gap-1"
										>
											{t("detail.by", undefined, { author })}
											<ExternalLink className="w-2.5 h-2.5" />
										</a>
									) : (
										<>{t("detail.by", undefined, { author })}</>
									)
								) : (
									t("detail.unknownAuthor")
								)}
							</p>
						</div>
					</div>

					{/* Stats for marketplace extensions */}
					{detail.source === "marketplace" && (
						<div className="flex items-center gap-3 mt-3">
							<span className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
								<Download className="w-3 h-3" />
								{t("detail.downloads", undefined, {
									count: detail.ext.downloads.toLocaleString(),
								})}
							</span>
						</div>
					)}
				</div>

				{/* Body */}
				<div className="px-5 pb-5 space-y-4 max-h-[50vh] overflow-y-auto custom-scrollbar">
					{/* Screenshot gallery */}
					{screenshots.length > 0 && <ScreenshotGallery screenshots={screenshots} />}

					{/* Description */}
					<div>
						<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 mb-1.5">
							{t("detail.description")}
						</p>
						<p className="text-[12px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
							{description}
						</p>
					</div>

					{/* Tags */}
					{detail.source === "marketplace" && detail.ext.tags.length > 0 && (
						<div>
							<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 mb-1.5">
								{t("detail.tags")}
							</p>
							<div className="flex flex-wrap gap-1.5">
								{detail.ext.tags.map((tag) => (
									<span
										key={tag}
										className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-[#2563EB]/10 text-[#2563EB]/70 font-medium"
									>
										<Tag className="w-2.5 h-2.5" />
										{tag}
									</span>
								))}
							</div>
						</div>
					)}

					{/* Permissions */}
					{permissions.length > 0 && (
						<div>
							<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 mb-1.5">
								{t("detail.permissions")}
							</p>
							<div className="flex flex-wrap gap-1.5">
								{permissions.map((perm) => (
									<span
										key={perm}
										className="text-[10px] px-2 py-0.5 rounded bg-foreground/5 text-muted-foreground font-mono"
									>
										{perm}
									</span>
								))}
							</div>
						</div>
					)}

					{/* Path (installed extensions) */}
					{isInstalled && (
						<div>
							<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 mb-1.5">
								{t("detail.location")}
							</p>
							<p className="text-[10px] text-muted-foreground/70 font-mono break-all">
								{detail.ext.path}
							</p>
						</div>
					)}

					{/* Error */}
					{isError && isInstalled && detail.ext.error && (
						<div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
							<p className="text-[11px] text-red-400">{detail.ext.error}</p>
						</div>
					)}
				</div>

				{/* Footer actions */}
				<div className="flex items-center gap-2 px-5 py-3 border-t border-foreground/[0.06] bg-white/[0.02]">
					{isInstalled && onToggle && (
						<div className="flex items-center gap-2">
							<Switch
								checked={detail.isActive}
								onCheckedChange={onToggle}
								disabled={isError}
							/>
							<span className="text-[11px] text-muted-foreground">
								{detail.isActive ? t("status.enabled") : t("status.disabled")}
							</span>
						</div>
					)}
					{detail.source === "marketplace" && !detail.ext.installed && onInstall && (
						<Button
							size="sm"
							className="h-8 px-3 text-[12px] bg-[#2563EB] hover:bg-[#2563EB]/90 text-white gap-1.5"
							onClick={onInstall}
							disabled={isInstalling}
						>
							{isInstalling ? (
								<Loader2 className="w-3.5 h-3.5 animate-spin" />
							) : (
								<Download className="w-3.5 h-3.5" />
							)}
							{isInstalling ? t("actions.installing") : t("actions.install")}
						</Button>
					)}
					{detail.source === "marketplace" && detail.ext.installed && (
						<span className="flex items-center gap-1 text-[11px] text-emerald-500 font-medium">
							<Check className="w-3.5 h-3.5" />
							{t("status.installed")}
						</span>
					)}
					<div className="flex-1" />
					<Button
						variant="ghost"
						size="sm"
						className="h-8 px-3 text-[12px] text-muted-foreground hover:text-foreground hover:bg-foreground/10"
						onClick={onClose}
					>
						{t("actions.close")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------------------
// Tab Switcher (LayoutGroup pill animation — matches SettingsPanel pattern)
// ---------------------------------------------------------------------------

function TabSwitcher({
	activeTab,
	onTabChange,
	extensionCount,
}: {
	activeTab: ExtensionTab;
	onTabChange: (tab: ExtensionTab) => void;
	extensionCount: number;
}) {
	const t = useScopedT("extensions");
	return (
		<LayoutGroup id="extension-tab-switcher">
			<div className="grid h-8 w-full grid-cols-2 rounded-xl border border-foreground/10 bg-foreground/[0.04] p-1">
				{TAB_OPTIONS.map((option) => {
					const isActive = activeTab === option.value;
					const count = option.value === "installed" ? extensionCount : undefined;
					return (
						<button
							key={option.value}
							type="button"
							onClick={() => onTabChange(option.value)}
							className="relative rounded-lg text-[10px] font-semibold tracking-wide transition-colors"
						>
							{isActive ? (
								<motion.span
									layoutId="extension-tab-pill"
									className="absolute inset-0 rounded-lg bg-[#2563EB]"
									transition={{ type: "spring", stiffness: 420, damping: 34 }}
								/>
							) : null}
							<span
								className={cn(
									"relative z-10 flex items-center justify-center gap-1",
									isActive ? "text-white" : "text-muted-foreground hover:text-foreground",
								)}
							>
								{t(option.labelKey)}
								{count !== undefined && count > 0 && (
									<span
										className={cn(
											"text-[8px] px-1 rounded-full font-semibold min-w-[14px] text-center leading-[14px]",
											isActive
												? "bg-white/20 text-white"
												: "bg-foreground/5 text-muted-foreground",
										)}
									>
										{count}
									</span>
								)}
							</span>
						</button>
					);
				})}
			</div>
		</LayoutGroup>
	);
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function ExtensionManager() {
	const t = useScopedT("extensions");
	const {
		extensions,
		activeIds,
		ready,
		refresh,
		toggleExtension,
		installFromFolder,
		uninstall,
		openDirectory,
		marketplaceSearch,
		marketplaceInstall,
	} = useExtensions();

	const [activeTab, setActiveTab] = useState<ExtensionTab>("browse");
	const [isRefreshing, setIsRefreshing] = useState(false);

	// Marketplace state
	const [searchQuery, setSearchQuery] = useState("");
	const [marketplaceResults, setMarketplaceResults] = useState<MarketplaceExtension[]>([]);
	const [marketplaceLoading, setMarketplaceLoading] = useState(false);
	const [marketplaceError, setMarketplaceError] = useState<string | null>(null);
	const [installingIds, setInstallingIds] = useState<Set<string>>(new Set());

	// Extension detail modal state
	const [detailData, setDetailData] = useState<ExtensionDetailData | null>(null);
	const hasAutoSearchedBrowseRef = useRef(false);

	const handleInstallFromFolder = useCallback(async () => {
		const success = await installFromFolder();
		if (success) {
			toast.success(t("toast.installedAndEnabled"));
		}
	}, [installFromFolder, t]);

	const handleUninstall = useCallback(
		async (id: string, name: string) => {
			const success = await uninstall(id);
			if (success) {
				toast.success(t("toast.uninstalled", undefined, { name }));
				// Clear installed flag in cached marketplace results
				setMarketplaceResults((prev) =>
					prev.map((e) => (e.id === id ? { ...e, installed: false } : e)),
				);
			} else {
				toast.error(t("toast.uninstallFailed", undefined, { name }));
			}
		},
		[uninstall, t],
	);

	// Marketplace search
	const handleSearch = useCallback(async () => {
		hasAutoSearchedBrowseRef.current = true;
		setMarketplaceLoading(true);
		setMarketplaceError(null);
		try {
			const result = await marketplaceSearch({
				query: searchQuery || undefined,
				sort: "popular",
				pageSize: 50,
			});
			setMarketplaceResults(result.extensions);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : t("toast.searchFailed");
			setMarketplaceError(message);
			setMarketplaceResults([]);
		} finally {
			setMarketplaceLoading(false);
		}
	}, [searchQuery, marketplaceSearch, t]);

	const handleRefresh = useCallback(async () => {
		setIsRefreshing(true);
		try {
			await refresh();

			if (activeTab === "browse") {
				await handleSearch();
			}

			toast.success(t("toast.refreshed"));
		} catch {
			toast.error(t("toast.refreshFailed"));
		} finally {
			setIsRefreshing(false);
		}
	}, [activeTab, handleSearch, refresh, t]);

	// Auto-search when switching to browse tab
	useEffect(() => {
		if (activeTab !== "browse") {
			hasAutoSearchedBrowseRef.current = false;
			return;
		}

		if (
			!hasAutoSearchedBrowseRef.current &&
			marketplaceResults.length === 0 &&
			!marketplaceLoading
		) {
			void handleSearch();
		}
	}, [activeTab, handleSearch, marketplaceLoading, marketplaceResults.length]);

	// Marketplace install
	const handleMarketplaceInstall = useCallback(
		async (ext: MarketplaceExtension) => {
			setInstallingIds((prev) => new Set(prev).add(ext.id));
			try {
				const result = await marketplaceInstall(ext.id, ext.downloadUrl);
				if (result.success) {
					toast.success(t("toast.marketplaceInstalled", undefined, { name: ext.name }));
					// Update the marketplace results to show installed state
					setMarketplaceResults((prev) =>
						prev.map((e) => (e.id === ext.id ? { ...e, installed: true } : e)),
					);
					setDetailData((prev) =>
						prev?.source === "marketplace" && prev.ext.id === ext.id
							? { ...prev, ext: { ...prev.ext, installed: true } }
							: prev,
					);
				} else {
					toast.error(
						t("toast.marketplaceInstallFailed", undefined, { name: ext.name }),
						{
							description: result.error,
						},
					);
				}
			} finally {
				setInstallingIds((prev) => {
					const next = new Set(prev);
					next.delete(ext.id);
					return next;
				});
			}
		},
		[marketplaceInstall, t],
	);

	return (
		<div className="flex-[2] w-[332px] min-w-[280px] max-w-[332px] bg-editor-panel border border-foreground/10 rounded-2xl flex flex-col shadow-xl h-full overflow-hidden">
			{/* Header */}
			<div className="flex-shrink-0 p-4 pb-3">
				<div className="flex items-center justify-between mb-3">
					<div className="flex items-center gap-2">
						<Puzzle className="w-4 h-4 text-[#2563EB]" />
						<h3 className="text-[13px] font-semibold text-foreground">{t("title")}</h3>
					</div>
					<div className="flex items-center gap-0.5">
						<Button
							variant="ghost"
							size="icon"
							className="h-6 w-6 text-muted-foreground/70 hover:text-muted-foreground hover:bg-foreground/10"
							onClick={() =>
								window.electronAPI?.openExternalUrl(EXTENSIONS_SUBMIT_URL)
							}
							title={t("actions.submit")}
						>
							<Plus className="w-3 h-3" />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							className="h-6 w-6 text-muted-foreground/70 hover:text-muted-foreground hover:bg-foreground/10"
							onClick={() => window.electronAPI?.openExternalUrl(EXTENSIONS_DOCS_URL)}
							title={t("actions.docs")}
						>
							<BookOpen className="w-3 h-3" />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							className="h-6 w-6 text-muted-foreground/70 hover:text-muted-foreground hover:bg-foreground/10"
							onClick={handleRefresh}
							disabled={isRefreshing}
							title={t("actions.refresh")}
						>
							<RefreshCw className={cn("w-3 h-3", isRefreshing && "animate-spin")} />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							className="h-6 w-6 text-muted-foreground/70 hover:text-muted-foreground hover:bg-foreground/10"
							onClick={openDirectory}
							title={t("actions.openFolder")}
						>
							<FolderOpen className="w-3 h-3" />
						</Button>
					</div>
				</div>

				<TabSwitcher
					activeTab={activeTab}
					onTabChange={setActiveTab}
					extensionCount={extensions.length}
				/>
			</div>

			{/* Content */}
			<div
				className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 pb-0 pt-0"
				style={{ scrollbarGutter: "stable" }}
			>
				{!ready ? (
					<div className="flex-1 flex items-center justify-center py-12">
						<Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
					</div>
				) : (
					<AnimatePresence mode="wait" initial={false}>
						<motion.div
							key={activeTab}
							initial={{ opacity: 0, y: 8 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -8 }}
							transition={{ duration: 0.18, ease: "easeOut" }}
						>
							{activeTab === "installed" && (
								<InstalledTab
									extensions={extensions}
									activeIds={activeIds}
									onToggle={toggleExtension}
									onUninstall={handleUninstall}
									onInstallFromFolder={handleInstallFromFolder}
									onOpenDirectory={openDirectory}
									onViewDetail={(ext) =>
										setDetailData({
											source: "installed",
											ext,
											isActive: activeIds.has(ext.manifest.id),
										})
									}
								/>
							)}

							{activeTab === "browse" && (
								<BrowseTab
									searchQuery={searchQuery}
									onSearchQueryChange={setSearchQuery}
									onSearch={handleSearch}
									results={marketplaceResults}
									loading={marketplaceLoading}
									error={marketplaceError}
									installingIds={installingIds}
									onInstall={handleMarketplaceInstall}
									onViewDetail={(ext) =>
										setDetailData({ source: "marketplace", ext })
									}
								/>
							)}
						</motion.div>
					</AnimatePresence>
				)}
			</div>

			{/* Extension Detail Modal */}
			{detailData && (
				<ExtensionDetailModal
					detail={detailData}
					onClose={() => setDetailData(null)}
					onToggle={
						detailData.source === "installed"
							? () => {
									toggleExtension(detailData.ext.manifest.id);
									setDetailData((prev) =>
										prev?.source === "installed"
											? { ...prev, isActive: !prev.isActive }
											: prev,
									);
								}
							: undefined
					}
					onInstall={
						detailData.source === "marketplace" && !detailData.ext.installed
							? () => handleMarketplaceInstall(detailData.ext as MarketplaceExtension)
							: undefined
					}
					isInstalling={
						detailData.source === "marketplace"
							? installingIds.has(detailData.ext.id)
							: false
					}
				/>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Installed Tab
// ---------------------------------------------------------------------------

function InstalledTab({
	extensions,
	activeIds,
	onToggle,
	onUninstall,
	onInstallFromFolder,
	onOpenDirectory,
	onViewDetail,
}: {
	extensions: ExtensionInfo[];
	activeIds: Set<string>;
	onToggle: (id: string) => Promise<void>;
	onUninstall: (id: string, name: string) => void;
	onInstallFromFolder: () => void;
	onOpenDirectory: () => void;
	onViewDetail: (ext: ExtensionInfo) => void;
}) {
	const t = useScopedT("extensions");
	if (extensions.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center gap-3 py-10">
				<div className="w-11 h-11 rounded-full bg-foreground/[0.04] flex items-center justify-center">
					<Puzzle className="w-5 h-5 text-muted-foreground" />
				</div>
				<div className="text-center">
					<p className="text-[13px] font-medium text-muted-foreground">{t("empty.title")}</p>
					<p className="text-[11px] text-muted-foreground mt-1 leading-relaxed max-w-[200px]">
						{t("empty.description")}
					</p>
				</div>
				<div className="flex gap-2 mt-2">
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-2.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-foreground/10 gap-1"
						onClick={onInstallFromFolder}
					>
						<Plus className="w-3 h-3" />
						{t("actions.install")}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-2.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-foreground/10 gap-1"
						onClick={onOpenDirectory}
					>
						<FolderOpen className="w-3 h-3" />
						{t("actions.folder")}
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between mb-1">
				<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
					{t("tabs.installed")}
				</p>
				<Button
					variant="ghost"
					size="sm"
					className="h-6 px-2 text-[10px] text-muted-foreground/70 hover:text-muted-foreground hover:bg-foreground/10 gap-1"
					onClick={onInstallFromFolder}
				>
					<Plus className="w-2.5 h-2.5" />
					{t("actions.add")}
				</Button>
			</div>
			{extensions.map((ext) => (
				<InstalledExtensionCard
					key={ext.manifest.id}
					extension={ext}
					isActive={activeIds.has(ext.manifest.id)}
					onToggle={() => onToggle(ext.manifest.id)}
					onUninstall={
						ext.builtin
							? undefined
							: () => onUninstall(ext.manifest.id, ext.manifest.name)
					}
					onClick={() => onViewDetail(ext)}
				/>
			))}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Browse Tab
// ---------------------------------------------------------------------------

function BrowseTab({
	searchQuery,
	onSearchQueryChange,
	onSearch,
	results,
	loading,
	error,
	installingIds,
	onInstall,
	onViewDetail,
}: {
	searchQuery: string;
	onSearchQueryChange: (q: string) => void;
	onSearch: () => void;
	results: MarketplaceExtension[];
	loading: boolean;
	error: string | null;
	installingIds: Set<string>;
	onInstall: (ext: MarketplaceExtension) => void;
	onViewDetail: (ext: MarketplaceExtension) => void;
}) {
	const t = useScopedT("extensions");
	return (
		<div className="flex flex-col gap-3">
			{/* Search */}
			<div className="relative">
				<Search className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/70 pointer-events-none" />
				<input
					type="text"
					placeholder={t("search.placeholder")}
					value={searchQuery}
					onChange={(e) => onSearchQueryChange(e.target.value)}
					onKeyDown={(e) => {
						e.stopPropagation();
						if (e.key === "Enter") onSearch();
					}}
					className="w-full h-8 ps-8 pe-3 rounded-lg bg-foreground/[0.04] border border-foreground/[0.08] text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#2563EB]/50 focus:border-[#2563EB]/30 transition-colors"
				/>
			</div>

			{/* Results */}
			{loading && (
				<div className="flex items-center justify-center py-10">
					<Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
				</div>
			)}

			{error && (
				<div className="flex flex-col items-center gap-2 py-8">
					<ShieldAlert className="w-5 h-5 text-red-400/60" />
					<p className="text-[11px] text-red-400/80 text-center max-w-[200px]">{error}</p>
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-2.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-foreground/10"
						onClick={onSearch}
					>
						{t("actions.retry")}
					</Button>
				</div>
			)}

			{!loading && !error && results.length === 0 && (
				<div className="flex flex-col items-center gap-2 py-10">
					<Search className="w-5 h-5 text-muted-foreground" />
					<p className="text-[11px] text-muted-foreground text-center">
						{searchQuery ? t("search.noResults") : t("search.noMarketplace")}
					</p>
				</div>
			)}

			{!loading && !error && results.length > 0 && (
				<div className="flex flex-col gap-2">
					<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
						{results.length !== 1
							? t("search.countPlural", undefined, { count: results.length })
							: t("search.count", undefined, { count: results.length })}
					</p>
					{results.map((ext) => (
						<MarketplaceCard
							key={ext.id}
							extension={ext}
							isInstalling={installingIds.has(ext.id)}
							onInstall={() => onInstall(ext)}
							onClick={() => onViewDetail(ext)}
						/>
					))}
				</div>
			)}
		</div>
	);
}
