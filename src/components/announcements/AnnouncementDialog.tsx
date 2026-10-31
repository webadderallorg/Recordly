import { ArrowLeft, ArrowRight, ArrowSquareOut, Megaphone } from "@/components/ui/icons";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { BUNDLED_ANNOUNCEMENT_FEED } from "@/content/announcements";
import { useI18n } from "@/contexts/I18nContext";
import { runAnnouncementAction } from "@/lib/announcementActions";
import {
	dismissAnnouncements,
	readAnnouncementImpressionCounts,
	readDismissedAnnouncementIds,
	recordAnnouncementImpression,
} from "@/lib/announcementState";
import {
	type Announcement,
	type AnnouncementAudience,
	parseAnnouncementFeed,
	selectAnnouncements,
} from "@/lib/announcements";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";

function AnnouncementMediaBanner({
	announcement,
	cover = false,
}: {
	announcement: Announcement;
	cover?: boolean;
}) {
	const [failed, setFailed] = useState(false);
	const media = announcement.media;

	if (!media || failed) {
		return (
			<div className="flex h-32 items-center justify-center bg-gradient-to-br from-primary/25 via-primary/10 to-transparent">
				<Megaphone className="h-12 w-12 text-primary/70" weight="duotone" />
			</div>
		);
	}

	if (media.type === "video") {
		return (
			<video
				key={media.url}
				className={cn(
					"w-full bg-black",
					cover ? "h-full object-cover" : "max-h-72 object-contain",
				)}
				controls
				playsInline
				preload="metadata"
				poster={media.posterUrl}
				onError={() => setFailed(true)}
			>
				<source src={media.url} />
			</video>
		);
	}

	return (
		<img
			src={media.url}
			alt={media.alt || ""}
			className={cn("w-full bg-black/20 object-cover", cover ? "h-full" : "max-h-72")}
			onError={() => setFailed(true)}
		/>
	);
}

export function AnnouncementDialog({ audience }: { audience: AnnouncementAudience }) {
	const { t } = useI18n();
	const [announcements, setAnnouncements] = useState<Announcement[]>([]);
	const [currentIndex, setCurrentIndex] = useState(0);
	const [open, setOpen] = useState(false);
	const [popupAspectRatio, setPopupAspectRatio] = useState(
		BUNDLED_ANNOUNCEMENT_FEED.settings.aspectRatio,
	);
	const countedThisSessionRef = useRef(new Set<string>());

	useEffect(() => {
		let cancelled = false;

		const loadAnnouncements = async () => {
			const dismissedIds = new Set(readDismissedAnnouncementIds());
			const impressionCounts = readAnnouncementImpressionCounts();
			const [appVersion, remoteFeed] = await Promise.all([
				window.electronAPI.getAppVersion().catch(() => "0.0.0"),
				window.electronAPI.getAnnouncements().catch(() => null),
			]);
			if (cancelled) {
				return;
			}

			const parsedRemoteFeed = parseAnnouncementFeed(remoteFeed);
			const eligible = selectAnnouncements({
				bundled: BUNDLED_ANNOUNCEMENT_FEED.announcements,
				remote: parsedRemoteFeed.announcements,
				dismissedIds,
				impressionCounts,
				appVersion,
				audience,
			}).filter(
				(announcement) =>
					announcement.presentation !== "notification" &&
					announcement.presentation !== "banner" &&
					announcement.presentation !== "export",
			);
			setPopupAspectRatio(
				parsedRemoteFeed.settings.aspectRatio ??
					BUNDLED_ANNOUNCEMENT_FEED.settings.aspectRatio,
			);
			setAnnouncements(eligible);
			setCurrentIndex(0);
			setOpen(eligible.length > 0);
		};

		void loadAnnouncements();
		return () => {
			cancelled = true;
		};
	}, [audience]);

	const current = announcements[currentIndex];
	const currentId = current?.id;
	const usesCoverMedia = current?.mediaMode === "cover" && Boolean(current.media);
	const controls = {
		close: current?.controls?.close !== false,
		dismiss: current?.controls?.dismiss !== false,
		action: current?.controls?.action !== false,
		navigation: current?.controls?.navigation !== false,
		indicators: current?.controls?.indicators !== false,
	};

	useEffect(() => {
		if (!open || !currentId || countedThisSessionRef.current.has(currentId)) {
			return;
		}

		countedThisSessionRef.current.add(currentId);
		recordAnnouncementImpression(currentId);
	}, [currentId, open]);

	useEffect(() => {
		if (!open || !current?.displayDurationSeconds) {
			return;
		}

		const timeout = window.setTimeout(() => {
			if (currentIndex >= announcements.length - 1) {
				setOpen(false);
				return;
			}
			setCurrentIndex((index) => index + 1);
		}, current.displayDurationSeconds * 1_000);

		return () => window.clearTimeout(timeout);
	}, [announcements.length, current?.displayDurationSeconds, currentIndex, open]);

	const dismissCurrent = () => {
		if (!current) {
			setOpen(false);
			return;
		}

		dismissAnnouncements([current.id]);

		const remaining = announcements.filter((announcement) => announcement.id !== current.id);
		setAnnouncements(remaining);
		if (remaining.length === 0) {
			setOpen(false);
			setCurrentIndex(0);
			return;
		}

		setCurrentIndex((index) => Math.min(index, remaining.length - 1));
	};

	const openAction = async () => {
		if (!current?.action) {
			return;
		}

		try {
			const result = await runAnnouncementAction(current.action);
			if (!result.success) {
				toast.error(result.error || t("announcements.openFailed", "Failed to open link."));
				return;
			}
			dismissCurrent();
		} catch (error) {
			toast.error(
				`${t("announcements.openFailed", "Failed to open link.")} ${String(error)}`,
			);
		}
	};

	if (!current) {
		return null;
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					if (controls.dismiss) {
						dismissCurrent();
					} else {
						setOpen(false);
					}
				}
			}}
		>
			<DialogContent
				className={cn(
					"flex max-h-[90vh] max-w-xl flex-col gap-0 overflow-hidden border-foreground/10 bg-editor-dialog p-0 text-foreground",
					!controls.close && "[&>button]:hidden",
					usesCoverMedia &&
						"isolate min-h-80 text-white [&>button]:bg-black/35 [&>button]:text-white [&>button:hover]:bg-black/55",
				)}
				style={
					popupAspectRatio
						? { aspectRatio: popupAspectRatio.replace(":", " / ") }
						: undefined
				}
			>
				{usesCoverMedia ? (
					<>
						<div className="absolute inset-0 z-0">
							<AnnouncementMediaBanner
								key={current.id}
								announcement={current}
								cover
							/>
						</div>
						<div
							className="pointer-events-none absolute inset-0 z-[1] bg-black/15"
							aria-hidden="true"
						/>
					</>
				) : (
					<AnnouncementMediaBanner key={current.id} announcement={current} />
				)}
				<div
					className={cn(
						"space-y-5 overflow-y-auto p-6",
						usesCoverMedia &&
							"relative z-10 mt-auto w-full bg-gradient-to-t from-black/90 via-black/65 to-transparent pt-20",
					)}
				>
					<DialogHeader>
						<DialogTitle className="cursor-text select-text text-xl leading-tight">
							{current.title}
						</DialogTitle>
						<DialogDescription
							className={cn(
								"cursor-text select-text whitespace-pre-line pt-2 text-sm leading-relaxed text-muted-foreground",
								usesCoverMedia && "text-white/80",
							)}
						>
							{current.body}
						</DialogDescription>
					</DialogHeader>

					{announcements.length > 1 && (controls.navigation || controls.indicators) && (
						<div
							className={cn(
								"flex items-center",
								controls.navigation ? "justify-between" : "justify-center",
							)}
							aria-label={t("announcements.carousel", "Announcements")}
						>
							{controls.navigation && (
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className={
										usesCoverMedia
											? "text-white hover:text-white hover:bg-white/15"
											: undefined
									}
									onClick={() =>
										setCurrentIndex(
											(index) =>
												(index - 1 + announcements.length) %
												announcements.length,
										)
									}
									aria-label={t(
										"announcements.previous",
										"Previous announcement",
									)}
								>
									<ArrowLeft />
								</Button>
							)}
							{controls.indicators && (
								<div className="flex gap-1.5">
									{announcements.map((announcement, index) => (
										<Button
											type="button"
											key={announcement.id}
											variant="ghost"
											className={`h-1.5 min-w-0 p-0 rounded-full ${
												index === currentIndex
													? `w-6 ${usesCoverMedia ? "bg-white" : "bg-primary"}`
													: `w-1.5 ${usesCoverMedia ? "bg-white/40" : "bg-foreground/25"}`
											} `}
											onClick={() => setCurrentIndex(index)}
											aria-label={`${t("announcements.show", "Show announcement")} ${index + 1}`}
										/>
									))}
								</div>
							)}
							{controls.navigation && (
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className={
										usesCoverMedia
											? "text-white hover:text-white hover:bg-white/15"
											: undefined
									}
									onClick={() =>
										setCurrentIndex(
											(index) => (index + 1) % announcements.length,
										)
									}
									aria-label={t("announcements.next", "Next announcement")}
								>
									<ArrowRight />
								</Button>
							)}
						</div>
					)}

					<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
						{controls.dismiss && (
							<Button
								type="button"
								variant="ghost"
								className={
									usesCoverMedia
										? "text-white hover:text-white hover:bg-white/15"
										: undefined
								}
								onClick={dismissCurrent}
							>
								{t("announcements.dismiss", "Dismiss")}
							</Button>
						)}
						{current.action && controls.action && (
							<Button type="button" onClick={() => void openAction()}>
								{current.action.label}
								{current.action.url ? <ArrowSquareOut /> : <ArrowRight />}
							</Button>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
