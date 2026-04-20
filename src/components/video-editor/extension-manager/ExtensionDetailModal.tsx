import {
	ArrowSquareOut as ExternalLink,
	Check,
	DownloadSimple as Download,
	SpinnerGap as Loader2,
	Tag,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useScopedT } from "@/contexts/I18nContext";
import { ExtensionIcon } from "../ExtensionIcon";
import { ScreenshotGallery } from "./ExtensionManagerCards";
import { type ExtensionDetailData, toSafeHttpUrl } from "./ExtensionManagerShared";

export function ExtensionDetailModal({
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
	const homepageUrl = toSafeHttpUrl(isInstalled ? detail.ext.manifest.homepage : detail.ext.homepage);
	const screenshots = detail.source === "marketplace" ? (detail.ext.screenshots ?? []) : [];
	const isError = isInstalled ? detail.ext.status === "error" : false;

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-w-md bg-editor-panel border-foreground/10 text-foreground p-0 gap-0 overflow-hidden">
				<div className="p-5 pb-4">
					<div className="flex items-start gap-3.5">
						<div className="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-[#2563EB]/20 to-[#2563EB]/5 border border-foreground/10 flex items-center justify-center">
							{detail.source === "marketplace" && detail.ext.iconUrl ? (
								<img src={detail.ext.iconUrl} alt="" className="w-7 h-7 rounded-lg" />
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
								<h2 className="text-[15px] font-semibold text-foreground truncate">{name}</h2>
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

				<div className="px-5 pb-5 space-y-4 max-h-[50vh] overflow-y-auto custom-scrollbar">
					{screenshots.length > 0 && <ScreenshotGallery screenshots={screenshots} />}

					<div>
						<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 mb-1.5">
							{t("detail.description")}
						</p>
						<p className="text-[12px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
							{description}
						</p>
					</div>

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

					{permissions.length > 0 && (
						<div>
							<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 mb-1.5">
								{t("detail.permissions")}
							</p>
							<div className="flex flex-wrap gap-1.5">
								{permissions.map((permission) => (
									<span
										key={permission}
										className="text-[10px] px-2 py-0.5 rounded bg-foreground/5 text-muted-foreground font-mono"
									>
										{permission}
									</span>
								))}
							</div>
						</div>
					)}

					{isInstalled && (
						<div>
							<p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 mb-1.5">
								{t("detail.location")}
							</p>
							<p className="text-[10px] text-muted-foreground/70 font-mono break-all">{detail.ext.path}</p>
						</div>
					)}

					{isError && isInstalled && detail.ext.error && (
						<div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
							<p className="text-[11px] text-red-400">{detail.ext.error}</p>
						</div>
					)}
				</div>

				<div className="flex items-center gap-2 px-5 py-3 border-t border-foreground/[0.06] bg-white/[0.02]">
					{isInstalled && onToggle && (
						<div className="flex items-center gap-2">
							<Switch checked={detail.isActive} onCheckedChange={onToggle} disabled={isError} />
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