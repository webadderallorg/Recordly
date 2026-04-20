/**
 * ExtensionManager — Sidebar panel for browsing, installing, and managing extensions.
 */

import {
	BookOpen,
	FolderOpen,
	Plus,
	PuzzlePiece as Puzzle,
	ArrowsClockwise as RefreshCw,
	SpinnerGap as Loader2,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";
import { useExtensions } from "@/hooks/useExtensions";
import type { MarketplaceExtension } from "@/lib/extensions";
import { cn } from "@/lib/utils";
import { ExtensionDetailModal } from "./extension-manager/ExtensionDetailModal";
import { BrowseTab, InstalledTab, TabSwitcher } from "./extension-manager/ExtensionManagerTabs";
import {
	EXTENSIONS_DOCS_URL,
	EXTENSIONS_SUBMIT_URL,
	type ExtensionDetailData,
	type ExtensionTab,
} from "./extension-manager/ExtensionManagerShared";

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
	const [searchQuery, setSearchQuery] = useState("");
	const [marketplaceResults, setMarketplaceResults] = useState<MarketplaceExtension[]>([]);
	const [marketplaceLoading, setMarketplaceLoading] = useState(false);
	const [marketplaceError, setMarketplaceError] = useState<string | null>(null);
	const [installingIds, setInstallingIds] = useState<Set<string>>(new Set());
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
				setMarketplaceResults((previous) =>
					previous.map((extension) =>
						extension.id === id ? { ...extension, installed: false } : extension,
					),
				);
			} else {
				toast.error(t("toast.uninstallFailed", undefined, { name }));
			}
		},
		[uninstall, t],
	);

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
		} catch (error: unknown) {
			setMarketplaceError(error instanceof Error ? error.message : t("toast.searchFailed"));
			setMarketplaceResults([]);
		} finally {
			setMarketplaceLoading(false);
		}
	}, [marketplaceSearch, searchQuery, t]);

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

	useEffect(() => {
		if (activeTab !== "browse") {
			hasAutoSearchedBrowseRef.current = false;
			return;
		}

		if (!hasAutoSearchedBrowseRef.current && marketplaceResults.length === 0 && !marketplaceLoading) {
			void handleSearch();
		}
	}, [activeTab, handleSearch, marketplaceLoading, marketplaceResults.length]);

	const handleMarketplaceInstall = useCallback(
		async (extension: MarketplaceExtension) => {
			setInstallingIds((previous) => new Set(previous).add(extension.id));
			try {
				const result = await marketplaceInstall(extension.id, extension.downloadUrl);
				if (result.success) {
					toast.success(t("toast.marketplaceInstalled", undefined, { name: extension.name }));
					setMarketplaceResults((previous) =>
						previous.map((entry) =>
							entry.id === extension.id ? { ...entry, installed: true } : entry,
						),
					);
					setDetailData((previous) =>
						previous?.source === "marketplace" && previous.ext.id === extension.id
							? { ...previous, ext: { ...previous.ext, installed: true } }
							: previous,
					);
				} else {
					toast.error(t("toast.marketplaceInstallFailed", undefined, { name: extension.name }), {
						description: result.error,
					});
				}
			} finally {
				setInstallingIds((previous) => {
					const next = new Set(previous);
					next.delete(extension.id);
					return next;
				});
			}
		},
		[marketplaceInstall, t],
	);

	return (
		<div className="flex-[2] w-[332px] min-w-[280px] max-w-[332px] bg-editor-panel border border-foreground/10 rounded-2xl flex flex-col shadow-xl h-full overflow-hidden">
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
							onClick={() => window.electronAPI?.openExternalUrl(EXTENSIONS_SUBMIT_URL)}
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
							{activeTab === "installed" ? (
								<InstalledTab
									extensions={extensions}
									activeIds={activeIds}
									onToggle={toggleExtension}
									onUninstall={handleUninstall}
									onInstallFromFolder={handleInstallFromFolder}
									onOpenDirectory={openDirectory}
									onViewDetail={(extension) =>
										setDetailData({
											source: "installed",
											ext: extension,
											isActive: activeIds.has(extension.manifest.id),
										})
									}
								/>
							) : (
								<BrowseTab
									searchQuery={searchQuery}
									onSearchQueryChange={setSearchQuery}
									onSearch={handleSearch}
									results={marketplaceResults}
									loading={marketplaceLoading}
									error={marketplaceError}
									installingIds={installingIds}
									onInstall={handleMarketplaceInstall}
									onViewDetail={(extension) =>
										setDetailData({ source: "marketplace", ext: extension })
									}
								/>
							)}
						</motion.div>
					</AnimatePresence>
				)}
			</div>

			{detailData && (
				<ExtensionDetailModal
					detail={detailData}
					onClose={() => setDetailData(null)}
					onToggle={
						detailData.source === "installed"
							? () => {
								void toggleExtension(detailData.ext.manifest.id);
								setDetailData((previous) =>
									previous?.source === "installed"
										? { ...previous, isActive: !previous.isActive }
										: previous,
								);
							}
							: undefined
					}
					onInstall={
						detailData.source === "marketplace" && !detailData.ext.installed
							? () => void handleMarketplaceInstall(detailData.ext)
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
