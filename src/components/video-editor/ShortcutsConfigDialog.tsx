import { Kbd, Description, Modal } from "@heroui/react";
import { Keyboard, ArrowCounterClockwise as RotateCcw } from "@/components/ui/icons";
import { useCallback, useEffect, useState } from "react";
import { toast } from "@/components/ui/toast";
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

export function ShortcutsConfigDialog() {
	const t = useScopedT("dialogs");
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
				toast.error(t("shortcutsConfig.reserved", undefined, { label: found.label }));
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
	}, [captureFor, draft, t]);

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
			<DialogContent className="max-w-lg max-h-[85vh] overflow-hidden">
				<DialogHeader className="shrink-0">
					<DialogTitle className="flex items-center gap-2 text-base font-semibold">
						<Keyboard className="w-4 h-4 text-accent" />
						{t("shortcutsConfig.title")}
					</DialogTitle>
				</DialogHeader>

				<Modal.Body className="min-h-0 space-y-6 overflow-y-auto">
					<div className="space-y-0.5">
						<p className="mb-3 text-[13px] font-medium text-foreground">
							{t("shortcutsConfig.configurable")}
						</p>
						{SHORTCUT_ACTIONS.map((action) => {
							const isCapturing = captureFor === action;
							const hasConflict = conflict?.forAction === action;
							return (
								<div key={action}>
									<div className="flex items-center justify-between gap-4 border-b border-separator py-3">
										<span className="text-[13px] text-foreground">
											{SHORTCUT_LABELS[action]}
										</span>
										<Button
											type="button"
											variant="secondary"
											size="sm"
											aria-label={
												isCapturing
													? `${SHORTCUT_LABELS[action]}: ${t("shortcutsConfig.pressAKey")}`
													: `Change ${SHORTCUT_LABELS[action]} shortcut, currently ${formatBinding(draft[action], isMac)}`
											}
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
												"px-2 py-1 text-xs min-w-[90px] text-center select-none",
												isCapturing
													? "animate-pulse"
													: hasConflict
														? "text-warning"
														: "cursor-pointer",
											].join(" ")}
										>
											{isCapturing
												? t("shortcutsConfig.pressAKey")
												: formatBinding(draft[action], isMac)}
										</Button>
									</div>
									{hasConflict &&
										conflict?.conflictWith.type === "configurable" && (
											<div className="flex items-center justify-between px-1 py-1.5 mb-0.5 bg-warning-soft border border-warning/20 rounded text-xs">
												<span className="text-warning">
													{t("shortcutsConfig.alreadyUsedBy", undefined, {
														action: SHORTCUT_LABELS[
															conflict.conflictWith.action
														],
													})}
												</span>
												<div className="flex gap-1.5">
													<Button
														variant="ghost"
														type="button"
														onClick={handleSwap}
														className="px-2 py-0.5 text-warning"
													>
														{t("shortcutsConfig.swap")}
													</Button>
													<Button
														variant="ghost"
														type="button"
														onClick={handleCancelConflict}
														className="px-2 py-0.5"
													>
														{t("shortcutsConfig.cancel")}
													</Button>
												</div>
											</div>
										)}
								</div>
							);
						})}
					</div>

					<div className="space-y-0.5 mt-2">
						<p className="mb-3 text-[13px] font-medium text-foreground">
							{t("shortcutsConfig.fixed")}
						</p>
						{FIXED_SHORTCUTS.map(({ label, display }) => (
							<div
								key={label}
								className="flex items-center justify-between gap-4 border-b border-separator py-3 last:border-0"
							>
								<span className="text-[13px] text-foreground">{label}</span>
								<Kbd className="min-w-[90px] justify-center">{display}</Kbd>
							</div>
						))}
					</div>

					<Description className="mt-2 text-xs">
						{t("shortcutsConfig.instructions")}
					</Description>
				</Modal.Body>

				<DialogFooter className="flex shrink-0 gap-2 sm:justify-between mt-2">
					<Button
						title={t("shortcutsConfig.resetToDefaults")}
						variant="ghost"
						size="sm"
						className="gap-1.5 max-w-[200px]"
						onClick={handleReset}
					>
						<RotateCcw className="w-3 h-3" />
						<span className="truncate">{t("shortcutsConfig.resetToDefaults")}</span>
					</Button>
					<div className="flex gap-2">
						<Button variant="ghost" size="sm" onClick={handleClose}>
							{t("shortcutsConfig.cancel")}
						</Button>
						<Button size="sm" onClick={handleSave}>
							{t("shortcutsConfig.save")}
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
