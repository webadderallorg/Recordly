import { useEffect, useMemo, useRef, useState } from "react";
import { BUNDLED_ANNOUNCEMENT_FEED } from "@/content/announcements";
import type { useI18n } from "@/contexts/I18nContext";
import {
	readAnnouncementImpressionCounts,
	readDismissedAnnouncementIds,
	recordAnnouncementImpression,
} from "@/lib/announcementState";
import type { Announcement } from "@/lib/announcements";
import { parseAnnouncementFeed, selectAnnouncements } from "@/lib/announcements";

const DEFAULT_MESSAGE_DURATION_SECONDS = 6;
const MAX_EXPORT_MESSAGE_LENGTH = 220;

export type ExportMessage = {
	id: string;
	text: string;
	durationSeconds: number;
	announcementId?: string;
};

function compactMessage(value: string): string {
	const compacted = value.replace(/\s+/g, " ").trim();
	if (compacted.length <= MAX_EXPORT_MESSAGE_LENGTH) return compacted;
	return `${compacted.slice(0, MAX_EXPORT_MESSAGE_LENGTH - 1).trimEnd()}…`;
}

export function buildExportMessageStream(
	tips: ExportMessage[],
	announcements: ExportMessage[],
): ExportMessage[] {
	const stream: ExportMessage[] = [];
	const length = Math.max(tips.length, announcements.length);
	for (let index = 0; index < length; index += 1) {
		if (tips[index]) stream.push(tips[index]);
		if (announcements[index]) stream.push(announcements[index]);
	}
	return stream;
}

function toExportMessage(announcement: Announcement): ExportMessage {
	return {
		id: `announcement:${announcement.id}`,
		announcementId: announcement.id,
		text: compactMessage(`${announcement.title} — ${announcement.body}`),
		durationSeconds: announcement.displayDurationSeconds ?? DEFAULT_MESSAGE_DURATION_SECONDS,
	};
}

export function useExportMessages({
	t,
	active,
}: {
	t: ReturnType<typeof useI18n>["t"];
	active: boolean;
}): string | null {
	const [announcementMessages, setAnnouncementMessages] = useState<ExportMessage[]>([]);
	const [currentIndex, setCurrentIndex] = useState(0);
	const countedThisSessionRef = useRef(new Set<string>());
	const tips = useMemo<ExportMessage[]>(
		() => [
			{
				id: "tip:auto-zooms",
				text: t(
					"editor.exportTips.autoZooms",
					"Tip: Turn off auto-applied zooms in settings",
				),
				durationSeconds: DEFAULT_MESSAGE_DURATION_SECONDS,
			},
			{
				id: "tip:experimental-builds",
				text: t(
					"editor.exportTips.experimentalBuilds",
					"Tip: Try experimental builds by turning on access in settings",
				),
				durationSeconds: DEFAULT_MESSAGE_DURATION_SECONDS,
			},
			{
				id: "tip:cursor-appearance",
				text: t(
					"editor.exportTips.cursorAppearance",
					"Tip: You can customise your cursor appearance",
				),
				durationSeconds: DEFAULT_MESSAGE_DURATION_SECONDS,
			},
		],
		[t],
	);
	const messages = useMemo(
		() => buildExportMessageStream(tips, announcementMessages),
		[tips, announcementMessages],
	);
	const current = messages[currentIndex % messages.length];

	useEffect(() => {
		let cancelled = false;
		const loadExportAnnouncements = async () => {
			const dismissedIds = new Set(readDismissedAnnouncementIds());
			const impressionCounts = readAnnouncementImpressionCounts();
			const [appVersion, remoteFeed] = await Promise.all([
				window.electronAPI.getAppVersion().catch(() => "0.0.0"),
				window.electronAPI.getAnnouncements().catch(() => null),
			]);
			if (cancelled) return;
			setAnnouncementMessages(
				selectAnnouncements({
					bundled: BUNDLED_ANNOUNCEMENT_FEED.announcements,
					remote: parseAnnouncementFeed(remoteFeed).announcements,
					dismissedIds,
					impressionCounts,
					appVersion,
					audience: "editor",
				})
					.filter((announcement) => announcement.presentation === "export")
					.map(toExportMessage),
			);
		};
		void loadExportAnnouncements();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!active || messages.length < 2 || !current) return;
		const timeout = window.setTimeout(
			() => setCurrentIndex((index) => (index + 1) % messages.length),
			current.durationSeconds * 1_000,
		);
		return () => window.clearTimeout(timeout);
	}, [active, current, messages.length]);

	useEffect(() => {
		const announcementId = active ? current?.announcementId : undefined;
		if (!announcementId || countedThisSessionRef.current.has(announcementId)) return;
		countedThisSessionRef.current.add(announcementId);
		recordAnnouncementImpression(announcementId);
	}, [active, current]);

	return active ? (current?.text ?? null) : null;
}
