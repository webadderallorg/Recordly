import { Kbd } from "@heroui/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Gear as Settings2, Question as HelpCircle } from "@/components/ui/icons";
import { useEffect, useState } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { formatBinding, SHORTCUT_ACTIONS, SHORTCUT_LABELS } from "@/lib/shortcuts";
import { formatShortcut } from "@/utils/platformUtils";

export function KeyboardShortcutsHelp() {
	const { shortcuts, isMac, openConfig } = useShortcuts();
	const t = useScopedT("editor");

	const [scrollLabels, setScrollLabels] = useState({
		pan: "Shift + Scroll",
		zoom: "Ctrl + Scroll",
	});

	useEffect(() => {
		Promise.all([formatShortcut(["shift", "Scroll"]), formatShortcut(["mod", "Scroll"])]).then(
			([pan, zoom]) => setScrollLabels({ pan, zoom }),
		);
	}, []);

	return (
		<Popover>
			<PopoverTrigger>
				<Button variant="ghost" size="icon" aria-label={t("keyboardShortcuts.title")}>
					<HelpCircle />
				</Button>
			</PopoverTrigger>

			<PopoverContent align="end" className="w-80" aria-label={t("keyboardShortcuts.title")}>
				<div className="flex items-center justify-between mb-2">
					<span className="text-xs font-semibold text-foreground">
						{t("keyboardShortcuts.title")}
					</span>
					<Button
						variant="ghost"
						type="button"
						onClick={openConfig}
						title={t("keyboardShortcuts.customizeTooltip")}
						className="flex items-center gap-1"
					>
						<Settings2 className="w-3 h-3" />
						{t("keyboardShortcuts.customize")}
					</Button>
				</div>

				<div className="space-y-1.5 text-[10px]">
					{SHORTCUT_ACTIONS.map((action) => (
						<div key={action} className="flex items-center justify-between">
							<span className="text-muted-foreground">{SHORTCUT_LABELS[action]}</span>
							<Kbd>{formatBinding(shortcuts[action], isMac)}</Kbd>
						</div>
					))}

					<div className="pt-1 border-t border-foreground/5 mt-1">
						<div className="flex items-center justify-between">
							<span className="text-muted-foreground">
								{t("keyboardShortcuts.panTimeline")}
							</span>
							<Kbd>{scrollLabels.pan}</Kbd>
						</div>
						<div className="flex items-center justify-between mt-1.5">
							<span className="text-muted-foreground">
								{t("keyboardShortcuts.zoomTimeline")}
							</span>
							<Kbd>{scrollLabels.zoom}</Kbd>
						</div>
						<div className="flex items-center justify-between mt-1.5">
							<span className="text-muted-foreground">
								{t("keyboardShortcuts.cycleAnnotations")}
							</span>
							<Kbd>{t("keyboardShortcuts.tab")}</Kbd>
						</div>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
