import {
	FolderOpen,
	MagnifyingGlass as Search,
	Plus,
	PuzzlePiece as Puzzle,
	ShieldWarning as ShieldAlert,
	SpinnerGap as Loader2,
} from "@phosphor-icons/react";
import { LayoutGroup, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";
import type { ExtensionInfo, MarketplaceExtension } from "@/lib/extensions";
import { cn } from "@/lib/utils";
import { InstalledExtensionCard, MarketplaceCard } from "./ExtensionManagerCards";
import { TAB_OPTIONS, type ExtensionTab } from "./ExtensionManagerShared";

export function TabSwitcher({
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

export function InstalledTab({
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
					onUninstall={ext.builtin ? undefined : () => onUninstall(ext.manifest.id, ext.manifest.name)}
					onClick={() => onViewDetail(ext)}
				/>
			))}
		</div>
	);
}

export function BrowseTab({
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
	onSearchQueryChange: (query: string) => void;
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
			<div className="relative">
				<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/70 pointer-events-none" />
				<input
					type="text"
					placeholder={t("search.placeholder")}
					value={searchQuery}
					onChange={(event) => onSearchQueryChange(event.target.value)}
					onKeyDown={(event) => {
						event.stopPropagation();
						if (event.key === "Enter") onSearch();
					}}
					className="w-full h-8 pl-8 pr-3 rounded-lg bg-foreground/[0.04] border border-foreground/[0.08] text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#2563EB]/50 focus:border-[#2563EB]/30 transition-colors"
				/>
			</div>

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