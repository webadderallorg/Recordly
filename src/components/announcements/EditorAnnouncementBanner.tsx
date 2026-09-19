import { ArrowRight, ArrowSquareOut, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { BUNDLED_ANNOUNCEMENT_FEED } from "@/content/announcements";
import { useI18n } from "@/contexts/I18nContext";
import { runAnnouncementAction } from "@/lib/announcementActions";
import type { Announcement } from "@/lib/announcements";
import { parseAnnouncementFeed, selectAnnouncements } from "@/lib/announcements";
import {
	dismissAnnouncements,
	readAnnouncementImpressionCounts,
	readDismissedAnnouncementIds,
	recordAnnouncementImpression,
} from "@/lib/announcementState";

export function EditorAnnouncementBanner() {
	const { t } = useI18n();
	const [announcements, setAnnouncements] = useState<Announcement[]>([]);
	const countedThisSessionRef = useRef(new Set<string>());
	const current = announcements[0];

	useEffect(() => {
		let cancelled = false;

		const loadBanners = async () => {
			const dismissedIds = new Set(readDismissedAnnouncementIds());
			const impressionCounts = readAnnouncementImpressionCounts();
			const [appVersion, remoteFeed] = await Promise.all([
				window.electronAPI.getAppVersion().catch(() => "0.0.0"),
				window.electronAPI.getAnnouncements().catch(() => null),
			]);
			if (cancelled) {
				return;
			}

			setAnnouncements(
				selectAnnouncements({
					bundled: BUNDLED_ANNOUNCEMENT_FEED.announcements,
					remote: parseAnnouncementFeed(remoteFeed).announcements,
					dismissedIds,
					impressionCounts,
					appVersion,
					audience: "editor",
				}).filter((announcement) => announcement.presentation === "banner"),
			);
		};

		void loadBanners();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!current || countedThisSessionRef.current.has(current.id)) {
			return;
		}

		countedThisSessionRef.current.add(current.id);
		recordAnnouncementImpression(current.id);
	}, [current]);

	useEffect(() => {
		if (!current?.displayDurationSeconds) {
			return;
		}

		const timeout = window.setTimeout(() => {
			setAnnouncements((items) => items.slice(1));
		}, current.displayDurationSeconds * 1_000);
		return () => window.clearTimeout(timeout);
	}, [current]);

	if (!current) {
		return null;
	}

	const dismissCurrent = () => {
		dismissAnnouncements([current.id]);
		setAnnouncements((items) => items.slice(1));
	};

	const openAction = async () => {
		if (!current.action) {
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

	const showClose = current.controls?.close !== false;
	const showAction = current.action && current.controls?.action !== false;

	return (
		<div className="relative z-40 flex flex-shrink-0 items-center justify-center gap-3 border-b border-black bg-black px-12 py-2 text-white shadow-sm dark:border-white dark:bg-white dark:text-black">
			<div className="min-w-0 cursor-text select-text text-center text-xs leading-relaxed">
				<span className="font-semibold">{current.title}</span>
				<span className="mx-1.5 opacity-65" aria-hidden="true">
					—
				</span>
				<span className="opacity-80">{current.body}</span>
			</div>
			{showAction ? (
				<Button
					type="button"
					variant="link"
					size="sm"
					onClick={() => void openAction()}
					className="h-auto shrink-0 gap-1 px-1 py-0 text-xs text-white underline decoration-white/50 underline-offset-2 hover:text-white dark:text-black dark:decoration-black/50 dark:hover:text-black"
				>
					{current.action?.label}
					{current.action?.url ? (
						<ArrowSquareOut className="h-3.5 w-3.5" />
					) : (
						<ArrowRight className="h-3.5 w-3.5" />
					)}
				</Button>
			) : null}
			{showClose ? (
				<button
					type="button"
					onClick={dismissCurrent}
					className="absolute right-4 inline-flex h-6 w-6 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/15 hover:text-white dark:text-black/70 dark:hover:bg-black/10 dark:hover:text-black"
					aria-label={t("announcements.dismiss", "Dismiss")}
				>
					<X className="h-3.5 w-3.5" />
				</button>
			) : null}
		</div>
	);
}
