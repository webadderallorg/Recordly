import { useEffect, useRef } from "react";
import { toast } from "@/lib/toast";
import { BUNDLED_ANNOUNCEMENT_FEED } from "@/content/announcements";
import { useI18n } from "@/contexts/I18nContext";
import { runAnnouncementAction } from "@/lib/announcementActions";
import type { AnnouncementAudience } from "@/lib/announcements";
import { parseAnnouncementFeed, selectAnnouncements } from "@/lib/announcements";
import {
	dismissAnnouncements,
	readAnnouncementImpressionCounts,
	readDismissedAnnouncementIds,
	recordAnnouncementImpression,
} from "@/lib/announcementState";

const DEFAULT_NOTIFICATION_DURATION_SECONDS = 10;
const MAX_NOTIFICATIONS_PER_LOAD = 5;

export function LiveAnnouncementNotifications({ audience }: { audience: AnnouncementAudience }) {
	const { t } = useI18n();
	const shownThisSessionRef = useRef(new Set<string>());

	useEffect(() => {
		let cancelled = false;

		const showNotifications = async () => {
			const dismissedIds = new Set(readDismissedAnnouncementIds());
			const impressionCounts = readAnnouncementImpressionCounts();
			const [appVersion, remoteFeed] = await Promise.all([
				window.electronAPI.getAppVersion().catch(() => "0.0.0"),
				window.electronAPI.getAnnouncements().catch(() => null),
			]);
			if (cancelled) {
				return;
			}

			const notifications = selectAnnouncements({
				bundled: BUNDLED_ANNOUNCEMENT_FEED.announcements,
				remote: parseAnnouncementFeed(remoteFeed).announcements,
				dismissedIds,
				impressionCounts,
				appVersion,
				audience,
			})
				.filter((announcement) => announcement.presentation === "notification")
				.slice(0, MAX_NOTIFICATIONS_PER_LOAD);

			for (const announcement of notifications) {
				if (shownThisSessionRef.current.has(announcement.id)) {
					continue;
				}

				shownThisSessionRef.current.add(announcement.id);
				recordAnnouncementImpression(announcement.id);
				const dismiss = () => dismissAnnouncements([announcement.id]);
				const controls = {
					close: announcement.controls?.close !== false,
					action: announcement.controls?.action !== false,
				};
				const action = announcement.action;

				toast(
					<span className="cursor-text select-text font-semibold">
						{announcement.title}
					</span>,
					{
						id: `live-announcement:${announcement.id}`,
						description: (
							<div className="cursor-text select-text">
								<p className="whitespace-pre-line leading-relaxed">
									{announcement.body}
								</p>
							</div>
						),
						duration:
							(announcement.displayDurationSeconds ??
								DEFAULT_NOTIFICATION_DURATION_SECONDS) * 1_000,
						closeButton: controls.close,
						onDismiss: dismiss,
						action:
							action && controls.action
								? {
										label: action.label,
										onClick: () => {
											void runAnnouncementAction(action)
												.then((result) => {
													if (result.success) {
														dismiss();
														return;
													}
													toast.error(
														result.error ||
															t(
																"announcements.openFailed",
																"Failed to open link.",
															),
													);
												})
												.catch((error) => {
													toast.error(
														`${t("announcements.openFailed", "Failed to open link.")} ${String(error)}`,
													);
												});
										},
									}
								: undefined,
					},
				);
			}
		};

		void showNotifications();
		return () => {
			cancelled = true;
		};
	}, [audience, t]);

	return null;
}
