import { Keyboard, ArrowCounterClockwise as RotateCcw } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import {
	DEFAULT_SHORTCUTS,
	FIXED_SHORTCUTS,
	findConflict,
	formatBinding,
	SHORTCUT_ACTIONS,
	SHORTCUT_LABELS,
	type ShortcutAction,
	type ShortcutBinding,
	type ShortcutConflict,
	type ShortcutsConfig,
} from "@/lib/shortcuts";
import { useScopedT } from "../../contexts/I18nContext";

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);
const FIXED_SHORTCUT_LABEL_KEYS: Record<string, string> = {
	"Cycle Annotations Forward": "cycleAnnotationsForward",
	"Cycle Annotations Backward": "cycleAnnotationsBackward",
	"Delete Selected (alt)": "deleteSelectedAlt",
	"Select Zoom Blocks": "selectZoomBlocks",
	"Zoom Timeline In": "zoomTimelineIn",
	"Zoom Timeline Out": "zoomTimelineOut",
	"Fit Timeline": "fitTimeline",
	"Zoom to Selection": "zoomToSelection",
	"Toggle Timeline Snapping": "toggleTimelineSnapping",
	"Add Timeline Marker": "addTimelineMarker",
	"Trim Selection to Playhead": "trimSelectionToPlayhead",
	"Nudge Selection": "nudgeSelection",
	"Step Playhead": "stepPlayhead",
	"Jump to Timeline Edge": "jumpToTimelineEdge",
	"Pan Timeline": "panTimeline",
	"Zoom Timeline": "zoomTimeline",
};

export function ShortcutsConfigDialog() {
	const t = useScopedT("dialogs");
	const tShortcuts = useScopedT("shortcuts");
	const { shortcuts, isMac, isConfigOpen, closeConfig, setShortcuts, persistShortcuts } =
		useShortcuts();

	const [draft, setDraft] = useState<ShortcutsConfig>(shortcuts);
	const [captureFor, setCaptureFor] = useState<ShortcutAction | null>(null);
	const [conflict, setConflict] = useState<{
		forAction: ShortcutAction;
		pending: ShortcutBinding;
		conflictWith: ShortcutConflict;
	} | null>(null);

	useEffect(() => {
		if (isConfigOpen) {
			setDraft(shortcuts);
			setCaptureFor(null);
			setConflict(null);
		}
	}, [isConfigOpen, shortcuts]);

	useEffect(() => {
		if (!captureFor) return;

		const handleCapture = (e: KeyboardEvent) => {
			e.preventDefault();
			e.stopPropagation();

			if (e.key === "Escape") {
				setCaptureFor(null);
				return;
			}

			if (MODIFIER_KEYS.has(e.key)) return;

			const binding: ShortcutBinding = {
				key: e.key.toLowerCase(),
				...(e.ctrlKey || e.metaKey ? { ctrl: true } : {}),
				...(e.shiftKey ? { shift: true } : {}),
				...(e.altKey ? { alt: true } : {}),
			};

			const found = findConflict(binding, captureFor, draft);
			setCaptureFor(null);

			if (found?.type === "fixed") {
				const labelKey = FIXED_SHORTCUT_LABEL_KEYS[found.label];
				const label = labelKey ? tShortcuts(`fixed.${labelKey}`, found.label) : found.label;
				toast.error(t("shortcutsConfig.reserved", undefined, { label }));
				return;
			}

			if (found?.type === "configurable") {
				setConflict({ forAction: captureFor, pending: binding, conflictWith: found });
				return;
			}

			setDraft((prev: ShortcutsConfig) => ({ ...prev, [captureFor]: binding }));
		};

		window.addEventListener("keydown", handleCapture, { capture: true });
		return () => window.removeEventListener("keydown", handleCapture, { capture: true });
	}, [captureFor, draft, t, tShortcuts]);

	const handleSwap = useCallback(() => {
		if (!conflict || conflict.conflictWith.type !== "configurable") return;
		const { forAction, pending, conflictWith } = conflict;
		setDraft((prev: ShortcutsConfig) => ({
			...prev,
			[forAction]: pending,
			[conflictWith.action]: prev[forAction],
		}));
		setConflict(null);
	}, [conflict]);

	const handleCancelConflict = useCallback(() => setConflict(null), []);

	const handleSave = useCallback(async () => {
		setShortcuts(draft);
		await persistShortcuts(draft);
		toast.success(t("shortcutsConfig.saved"));
		closeConfig();
	}, [draft, setShortcuts, persistShortcuts, closeConfig, t]);

	const handleReset = useCallback(() => {
		setDraft({ ...DEFAULT_SHORTCUTS });
		toast.info(t("shortcutsConfig.resetNotice"));
	}, [t]);

	const handleClose = useCallback(() => {
		setCaptureFor(null);
		setConflict(null);
		closeConfig();
	}, [closeConfig]);

	return (
		<Dialog
			open={isConfigOpen}
			onOpenChange={(open: boolean) => {
				if (!open) handleClose();
			}}
		>
			<DialogContent className="bg-editor-dialog border-foreground/10 text-foreground max-w-[460px]">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-sm">
						<Keyboard className="w-4 h-4 text-[#2563EB]" />
						{t("shortcutsConfig.title")}
					</DialogTitle>
				</DialogHeader>

				<div className="space-y-0.5">
					<p className="text-[10px] text-muted-foreground/70 mb-2 uppercase tracking-wide font-semibold">
						{t("shortcutsConfig.configurable")}
					</p>
					{SHORTCUT_ACTIONS.map((action) => {
						const isCapturing = captureFor === action;
						const hasConflict = conflict?.forAction === action;
						return (
							<div key={action}>
								<div className="flex items-center justify-between py-1.5 px-1 border-b border-foreground/5">
									<span className="text-sm text-muted-foreground">
										{tShortcuts(`actions.${action}`, SHORTCUT_LABELS[action])}
									</span>
									<button
										type="button"
										onClick={() => {
											setConflict(null);
											setCaptureFor(isCapturing ? null : action);
										}}
										title={
											isCapturing
												? t("shortcutsConfig.pressEscToCancel")
												: t("shortcutsConfig.clickToChange")
										}
										className={[
											"px-2 py-1 rounded text-xs font-mono border transition-all min-w-[90px] text-center select-none",
											isCapturing
												? "bg-[#2563EB]/20 border-[#2563EB] text-[#2563EB] animate-pulse"
												: hasConflict
													? "bg-amber-500/10 border-amber-500/50 text-amber-400"
													: "bg-foreground/5 border-foreground/10 text-foreground hover:border-[#2563EB]/50 hover:text-[#2563EB] cursor-pointer",
										].join(" ")}
									>
										{isCapturing
											? t("shortcutsConfig.pressAKey")
											: formatBinding(draft[action], isMac)}
									</button>
								</div>
								{hasConflict && conflict?.conflictWith.type === "configurable" && (
									<div className="flex items-center justify-between px-1 py-1.5 mb-0.5 bg-amber-500/10 border border-amber-500/20 rounded text-xs">
										<span className="text-amber-400">
											{t("shortcutsConfig.alreadyUsedBy", undefined, {
												action: tShortcuts(
													`actions.${conflict.conflictWith.action}`,
													SHORTCUT_LABELS[conflict.conflictWith.action],
												),
											})}
										</span>
										<div className="flex gap-1.5">
											<button
												type="button"
												onClick={handleSwap}
												className="px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded text-amber-300 font-medium transition-colors"
											>
												{t("shortcutsConfig.swap")}
											</button>
											<button
												type="button"
												onClick={handleCancelConflict}
												className="px-2 py-0.5 bg-foreground/5 hover:bg-foreground/10 border border-foreground/10 rounded text-muted-foreground transition-colors"
											>
												{t("shortcutsConfig.cancel")}
											</button>
										</div>
									</div>
								)}
							</div>
						);
					})}
				</div>

				<div className="space-y-0.5 mt-2">
					<p className="text-[10px] text-muted-foreground/70 mb-2 uppercase tracking-wide font-semibold">
						{t("shortcutsConfig.fixed")}
					</p>
					{FIXED_SHORTCUTS.map(({ label, display }) => {
						const labelKey = FIXED_SHORTCUT_LABEL_KEYS[label];
						const translatedLabel = labelKey
							? tShortcuts(`fixed.${labelKey}`, label)
							: label;
						return (
							<div
								key={label}
								className="flex items-center justify-between py-1.5 px-1 border-b border-foreground/5 last:border-0"
							>
								<span className="text-sm text-muted-foreground">
									{translatedLabel}
								</span>
								<kbd className="px-2 py-1 bg-foreground/5 border border-foreground/10 rounded text-xs font-mono text-muted-foreground min-w-[90px] text-center">
									{display}
								</kbd>
							</div>
						);
					})}
				</div>

				<p className="text-[10px] text-muted-foreground/70 mt-1">
					{t("shortcutsConfig.instructions")}
				</p>

				<DialogFooter className="flex gap-2 sm:justify-between mt-2">
					<Button
						title={t("shortcutsConfig.resetToDefaults")}
						variant="ghost"
						size="sm"
						className="text-muted-foreground hover:text-foreground hover:bg-foreground/10 gap-1.5 max-w-[200px]"
						onClick={handleReset}
					>
						<RotateCcw className="w-3 h-3" />
						<span className="truncate">{t("shortcutsConfig.resetToDefaults")}</span>
					</Button>
					<div className="flex gap-2">
						<Button variant="ghost" size="sm" onClick={handleClose}>
							{t("shortcutsConfig.cancel")}
						</Button>
						<Button
							size="sm"
							className="bg-[#2563EB] hover:bg-[#1d4ed8] text-white"
							onClick={handleSave}
						>
							{t("shortcutsConfig.save")}
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
