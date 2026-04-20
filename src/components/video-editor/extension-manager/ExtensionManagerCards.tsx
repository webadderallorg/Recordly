import {
	CaretLeft as ChevronLeft,
	CaretRight as ChevronRight,
	Check,
	DownloadSimple as Download,
	SpinnerGap as Loader2,
	Trash as Trash2,
} from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useScopedT } from "@/contexts/I18nContext";
import type { ExtensionInfo, MarketplaceExtension } from "@/lib/extensions";
import { cn } from "@/lib/utils";
import { ExtensionIcon } from "../ExtensionIcon";
import { toSafeHttpUrl } from "./ExtensionManagerShared";

export function InstalledExtensionCard({
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
								onClick={(event) => event.stopPropagation()}
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
						{extension.manifest.permissions.map((permission) => (
							<span
								key={permission}
								className="text-[8px] px-1 py-[1px] rounded bg-foreground/5 text-muted-foreground font-mono"
							>
								{permission}
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
						onClick={(event) => {
							event.stopPropagation();
							onUninstall();
						}}
						title={t("actions.uninstall")}
					>
						<Trash2 className="w-3 h-3" />
					</Button>
				)}
				<div onClick={(event) => event.stopPropagation()}>
					<Switch checked={isActive} onCheckedChange={onToggle} disabled={isError} />
				</div>
			</div>
		</div>
	);
}

export function MarketplaceCard({
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
					<img src={extension.iconUrl} alt="" className="w-8 h-8 rounded-lg object-cover" />
				) : (
					<ExtensionIcon icon={undefined} className="w-3.5 h-3.5 text-muted-foreground" />
				)}
			</div>

			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-1.5">
					<span className="text-[13px] font-medium text-foreground truncate">{extension.name}</span>
				</div>

				<p className="text-[10px] text-muted-foreground/70 mt-0.5">
					{homepageUrl ? (
						<a
							href={homepageUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="hover:text-muted-foreground transition-colors"
							onClick={(event) => event.stopPropagation()}
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
						onClick={(event) => {
							event.stopPropagation();
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

export function ScreenshotGallery({ screenshots }: { screenshots: string[] }) {
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
							className="absolute left-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-editor-bg/80 text-foreground/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-editor-bg/80"
							onClick={() => setIndex((currentIndex) => (currentIndex - 1 + count) % count)}
						>
							<ChevronLeft className="w-3.5 h-3.5" />
						</button>
						<button
							type="button"
							className="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-editor-bg/80 text-foreground/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-editor-bg/80"
							onClick={() => setIndex((currentIndex) => (currentIndex + 1) % count)}
						>
							<ChevronRight className="w-3.5 h-3.5" />
						</button>
						<div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-1">
							{screenshots.map((_, screenshotIndex) => (
								<button
									type="button"
									key={screenshotIndex}
									className={cn(
										"w-1.5 h-1.5 rounded-full transition-colors",
										screenshotIndex === index
											? "bg-white"
											: "bg-white/30 hover:bg-foreground/50",
									)}
									onClick={() => setIndex(screenshotIndex)}
								/>
							))}
						</div>
					</>
				)}
			</div>
		</div>
	);
}