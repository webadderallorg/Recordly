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
	DEFAULT_LAUNCH_SHORTCUTS,
	DEFAULT_SHORTCUTS,
	FIXED_SHORTCUTS,
	findConflict,
	findLaunchConflict,
	formatBinding,
	LAUNCH_SHORTCUT_ACTIONS,
	LAUNCH_SHORTCUT_LABELS,
	type LaunchShortcutAction,
	type LaunchShortcutConflict,
	type LaunchShortcutsConfig,
	SHORTCUT_ACTIONS,
	SHORTCUT_LABELS,
	type ShortcutAction,
	type ShortcutBinding,
	type ShortcutConflict,
	type ShortcutsConfig,
} from "@/lib/shortcuts";
import { useScopedT } from "../../contexts/I18nContext";

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

type CaptureTarget =
	| { scope: "local"; action: ShortcutAction }
	| { scope: "global"; action: LaunchShortcutAction };

type ShortcutConflictState =
	| {
			scope: "local";
			forAction: ShortcutAction;
			pending: ShortcutBinding;
			conflictWith: ShortcutConflict;
	  }
	| {
			scope: "global";
			forAction: LaunchShortcutAction;
			pending: ShortcutBinding;
			conflictWith: LaunchShortcutConflict;
	  };

export function ShortcutsConfigDialog() {
	const t = useScopedT("dialogs");
	const {
		shortcuts,
		launchShortcuts,
		isMac,
		isConfigOpen,
		closeConfig,
		setShortcuts,
		setLaunchShortcuts,
		persistShortcuts,
	} = useShortcuts();

	const [draft, setDraft] = useState<ShortcutsConfig>(shortcuts);
	const [launchDraft, setLaunchDraft] = useState<LaunchShortcutsConfig>(launchShortcuts);
	const [captureTarget, setCaptureTarget] = useState<CaptureTarget | null>(null);
	const [conflict, setConflict] = useState<ShortcutConflictState | null>(null);

	useEffect(() => {
		if (isConfigOpen) {
			setDraft(shortcuts);
			setLaunchDraft(launchShortcuts);
			setCaptureTarget(null);
			setConflict(null);
		}
	}, [isConfigOpen, shortcuts, launchShortcuts]);

	useEffect(() => {
		if (!captureTarget) return;

		const handleCapture = (e: KeyboardEvent) => {
			e.preventDefault();
			e.stopPropagation();

			if (e.key === "Escape") {
				setCaptureTarget(null);
				return;
			}

			if (MODIFIER_KEYS.has(e.key)) return;

			const binding: ShortcutBinding = {
				key: e.key.toLowerCase(),
				...(e.ctrlKey || e.metaKey ? { ctrl: true } : {}),
				...(e.shiftKey ? { shift: true } : {}),
				...(e.altKey ? { alt: true } : {}),
			};

			if (captureTarget.scope === "global") {
				const found = findLaunchConflict(binding, captureTarget.action, launchDraft);
				setCaptureTarget(null);

				if (found) {
					setConflict({
						scope: "global",
						forAction: captureTarget.action,
						pending: binding,
						conflictWith: found,
					});
					return;
				}

				setLaunchDraft((prev: LaunchShortcutsConfig) => ({
					...prev,
					[captureTarget.action]: binding,
				}));
				return;
			}

			const found = findConflict(binding, captureTarget.action, draft);
			setCaptureTarget(null);

			if (found?.type === "fixed") {
				toast.error(t("shortcutsConfig.reserved", undefined, { label: found.label }));
				return;
			}

			if (found?.type === "configurable") {
				setConflict({
					scope: "local",
					forAction: captureTarget.action,
					pending: binding,
					conflictWith: found,
				});
				return;
			}

			setDraft((prev: ShortcutsConfig) => ({
				...prev,
				[captureTarget.action]: binding,
			}));
		};

		window.addEventListener("keydown", handleCapture, { capture: true });
		return () => window.removeEventListener("keydown", handleCapture, { capture: true });
	}, [captureTarget, draft, launchDraft, t]);

	const handleSwap = useCallback(() => {
		if (!conflict || conflict.conflictWith.type !== "configurable") return;
		if (conflict.scope === "global") {
			const forAction = conflict.forAction;
			const pending = conflict.pending;
			const conflictWithAction = conflict.conflictWith.action;
			setLaunchDraft((prev: LaunchShortcutsConfig) => ({
				...prev,
				[forAction]: pending,
				[conflictWithAction]: prev[forAction],
			}));
		} else {
			const forAction = conflict.forAction;
			const pending = conflict.pending;
			const conflictWithAction = conflict.conflictWith.action;
			setDraft((prev: ShortcutsConfig) => ({
				...prev,
				[forAction]: pending,
				[conflictWithAction]: prev[forAction],
			}));
		}
		setConflict(null);
	}, [conflict]);

	const handleCancelConflict = useCallback(() => setConflict(null), []);

	const handleSave = useCallback(async () => {
		setShortcuts(draft);
		setLaunchShortcuts(launchDraft);
		await persistShortcuts(draft, launchDraft);
		toast.success(t("shortcutsConfig.saved"));
		closeConfig();
	}, [draft, launchDraft, setShortcuts, setLaunchShortcuts, persistShortcuts, closeConfig, t]);

	const handleReset = useCallback(() => {
		setDraft({ ...DEFAULT_SHORTCUTS });
		setLaunchDraft({ ...DEFAULT_LAUNCH_SHORTCUTS });
		toast.info(t("shortcutsConfig.resetNotice"));
	}, [t]);

	const handleClose = useCallback(() => {
		setCaptureTarget(null);
		setConflict(null);
		closeConfig();
	}, [closeConfig]);

	const toggleCaptureTarget = useCallback((target: CaptureTarget) => {
		setConflict(null);
		setCaptureTarget((current) =>
			current?.scope === target.scope && current.action === target.action ? null : target,
		);
	}, []);

	return (
		<Dialog
			open={isConfigOpen}
			onOpenChange={(open: boolean) => {
				if (!open) handleClose();
			}}
		>
			<DialogContent className="bg-editor-dialog border-foreground/10 text-foreground max-w-[560px] max-h-[85vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-sm">
						<Keyboard className="w-4 h-4 text-[#2563EB]" />
						{t("shortcutsConfig.title")}
					</DialogTitle>
				</DialogHeader>

				<div className="space-y-0.5">
					<p className="text-[10px] text-muted-foreground/70 mb-2 uppercase tracking-wide font-semibold">
						{t("shortcutsConfig.localShortcuts")}
					</p>
					{SHORTCUT_ACTIONS.map((action) => {
						const isCapturing =
							captureTarget?.scope === "local" && captureTarget.action === action;
						const hasConflict =
							conflict?.scope === "local" && conflict.forAction === action;
						return (
							<div key={action}>
								<div className="flex items-center justify-between py-1.5 px-1 border-b border-foreground/5">
									<span className="text-sm text-muted-foreground">
										{SHORTCUT_LABELS[action]}
									</span>
									<button
										type="button"
										onClick={() =>
											toggleCaptureTarget({ scope: "local", action })
										}
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
												action:
													conflict.scope === "local"
														? SHORTCUT_LABELS[
																conflict.conflictWith.action
															]
														: "",
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

				<div className="space-y-0.5 mt-4">
					<p className="text-[10px] text-muted-foreground/70 mb-1 uppercase tracking-wide font-semibold">
						{t("shortcutsConfig.globalShortcuts")}
					</p>
					<p className="text-[11px] text-muted-foreground/70 mb-2">
						{t("shortcutsConfig.globalDescription")}
					</p>
					{LAUNCH_SHORTCUT_ACTIONS.map((action) => {
						const isCapturing =
							captureTarget?.scope === "global" && captureTarget.action === action;
						const hasConflict =
							conflict?.scope === "global" && conflict.forAction === action;
						return (
							<div key={action}>
								<div className="flex items-center justify-between py-1.5 px-1 border-b border-foreground/5">
									<span className="text-sm text-muted-foreground">
										{LAUNCH_SHORTCUT_LABELS[action]}
									</span>
									<button
										type="button"
										onClick={() =>
											toggleCaptureTarget({ scope: "global", action })
										}
										title={
											isCapturing
												? t("shortcutsConfig.pressEscToCancel")
												: t("shortcutsConfig.clickToChange")
										}
										className={[
											"px-2 py-1 rounded text-xs font-mono border transition-all min-w-[110px] text-center select-none",
											isCapturing
												? "bg-[#2563EB]/20 border-[#2563EB] text-[#2563EB] animate-pulse"
												: hasConflict
													? "bg-amber-500/10 border-amber-500/50 text-amber-400"
													: "bg-foreground/5 border-foreground/10 text-foreground hover:border-[#2563EB]/50 hover:text-[#2563EB] cursor-pointer",
										].join(" ")}
									>
										{isCapturing
											? t("shortcutsConfig.pressAKey")
											: formatBinding(launchDraft[action], isMac)}
									</button>
								</div>
								{hasConflict && conflict?.scope === "global" && (
									<div className="flex items-center justify-between px-1 py-1.5 mb-0.5 bg-amber-500/10 border border-amber-500/20 rounded text-xs">
										<span className="text-amber-400">
											{t("shortcutsConfig.alreadyUsedBy", undefined, {
												action: LAUNCH_SHORTCUT_LABELS[
													conflict.conflictWith.action
												],
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
					{FIXED_SHORTCUTS.map(({ label, display }) => (
						<div
							key={label}
							className="flex items-center justify-between py-1.5 px-1 border-b border-foreground/5 last:border-0"
						>
							<span className="text-sm text-muted-foreground">{label}</span>
							<kbd className="px-2 py-1 bg-foreground/5 border border-foreground/10 rounded text-xs font-mono text-muted-foreground min-w-[90px] text-center">
								{display}
							</kbd>
						</div>
					))}
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
