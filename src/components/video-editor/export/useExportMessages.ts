import { useEffect, useMemo, useState } from "react";
import type { useI18n } from "@/contexts/I18nContext";

const EXPORT_TIP_DURATION_MS = 6_000;

export function useExportMessages({
	t,
	active,
}: {
	t: ReturnType<typeof useI18n>["t"];
	active: boolean;
}): string | null {
	const [currentIndex, setCurrentIndex] = useState(0);
	const tips = useMemo(
		() => [
			t("editor.exportTips.autoZooms", "Tip: Apply auto zooms from the Zoom layer"),
			t(
				"editor.exportTips.experimentalBuilds",
				"Tip: Try experimental builds by turning on access in settings",
			),
			t(
				"editor.exportTips.cursorAppearance",
				"Tip: You can customise your cursor appearance",
			),
		],
		[t],
	);

	useEffect(() => {
		setCurrentIndex(0);
		if (!active) return;
		const interval = window.setInterval(
			() => setCurrentIndex((index) => (index + 1) % tips.length),
			EXPORT_TIP_DURATION_MS,
		);
		return () => window.clearInterval(interval);
	}, [active, tips.length]);

	return active ? tips[currentIndex % tips.length] : null;
}
