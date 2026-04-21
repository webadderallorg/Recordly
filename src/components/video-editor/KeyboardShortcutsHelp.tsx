import { Gear as Settings2, Question as HelpCircle } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { formatBinding, SHORTCUT_ACTIONS, SHORTCUT_LABELS } from "@/lib/shortcuts";
import { formatShortcut } from "@/utils/platformUtils";

export function KeyboardShortcutsHelp() {
	const { shortcuts, isMac, openConfig } = useShortcuts();
	const t = useScopedT("editor");

	const [scrollLabels, setScrollLabels] = useState({
		pan: "Shift + Ctrl + Scroll",
		zoom: "Ctrl + Scroll",
	});

	useEffect(() => {
		Promise.all([
			formatShortcut(["shift", "mod", "Scroll"]),
			formatShortcut(["mod", "Scroll"]),
		]).then(([pan, zoom]) => setScrollLabels({ pan, zoom }));
	}, []);

	return (
		<div className="relative group">
			<HelpCircle className="w-4 h-4 text-muted-foreground/70 hover:text-[#2563EB] transition-colors cursor-help" />

			<div className="absolute end-0 top-full mt-2 w-64 bg-editor-dialog border border-foreground/10 rounded-lg p-3 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 shadow-xl z-50">
				<div className="flex items-center justify-between mb-2">
					<span className="text-xs font-semibold text-foreground">
						{t("keyboardShortcuts.title")}
					</span>
					<button
						type="button"
						onClick={openConfig}
						title={t("keyboardShortcuts.customizeTooltip")}
						className="flex items-center gap-1 text-[10px] text-muted-foreground/70 hover:text-[#2563EB] transition-colors"
					>
						<Settings2 className="w-3 h-3" />
						{t("keyboardShortcuts.customize")}
					</button>
				</div>

				<div className="space-y-1.5 text-[10px]">
					{SHORTCUT_ACTIONS.map((action) => (
						<div key={action} className="flex items-center justify-between">
							<span className="text-muted-foreground">{SHORTCUT_LABELS[action]}</span>
							<kbd className="px-1 py-0.5 bg-foreground/5 border border-foreground/10 rounded text-[#2563EB] font-mono">
								{formatBinding(shortcuts[action], isMac)}
							</kbd>
						</div>
					))}

					<div className="pt-1 border-t border-foreground/5 mt-1">
						<div className="flex items-center justify-between">
							<span className="text-muted-foreground">
								{t("keyboardShortcuts.panTimeline")}
							</span>
							<kbd className="px-1 py-0.5 bg-foreground/5 border border-foreground/10 rounded text-[#2563EB] font-mono">
								{scrollLabels.pan}
							</kbd>
						</div>
						<div className="flex items-center justify-between mt-1.5">
							<span className="text-muted-foreground">
								{t("keyboardShortcuts.zoomTimeline")}
							</span>
							<kbd className="px-1 py-0.5 bg-foreground/5 border border-foreground/10 rounded text-[#2563EB] font-mono">
								{scrollLabels.zoom}
							</kbd>
						</div>
						<div className="flex items-center justify-between mt-1.5">
							<span className="text-muted-foreground">
								{t("keyboardShortcuts.cycleAnnotations")}
							</span>
							<kbd className="px-1 py-0.5 bg-foreground/5 border border-foreground/10 rounded text-[#2563EB] font-mono">
								{t("keyboardShortcuts.tab")}
							</kbd>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
