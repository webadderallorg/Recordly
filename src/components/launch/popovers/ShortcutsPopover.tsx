import { Keyboard, ArrowCounterClockwise as RotateCcw } from "@phosphor-icons/react";
import { useEffect, useState, type ReactElement } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import {
	DEFAULT_LAUNCH_SHORTCUTS,
	LAUNCH_SHORTCUT_ACTIONS,
	findLaunchConflict,
	formatBinding,
	type LaunchShortcutAction,
	type LaunchShortcutsConfig,
	type ShortcutBinding,
} from "@/lib/shortcuts";
import styles from "../LaunchWindow.module.css";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import { DropdownItem, HudPopover } from "./PopoverScaffold";

const POPOVER_ID = "shortcuts";
const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

const ACTION_I18N_KEY: Record<LaunchShortcutAction, string> = {
	startRecording: "recording.shortcuts.actions.startRecording",
	stopRecording: "recording.shortcuts.actions.stopRecording",
	pauseRecording: "recording.shortcuts.actions.pauseRecording",
	resumeRecording: "recording.shortcuts.actions.resumeRecording",
	muteMicrophone: "recording.shortcuts.actions.muteMicrophone",
};

export function ShortcutsPopover({ trigger }: { trigger: ReactElement }) {
	const t = useScopedT("launch");
	const { launchShortcuts, setLaunchShortcuts, persistShortcuts, isMac } = useShortcuts();
	const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
	const open = isOpen(POPOVER_ID);
	const [draft, setDraft] = useState<LaunchShortcutsConfig>(launchShortcuts);
	const [captureFor, setCaptureFor] = useState<LaunchShortcutAction | null>(null);
	const [conflictAction, setConflictAction] = useState<LaunchShortcutAction | null>(null);

	useEffect(() => {
		if (open) {
			setDraft(launchShortcuts);
		}
		setCaptureFor(null);
		setConflictAction(null);
	}, [open, launchShortcuts]);

	useEffect(() => {
		if (!captureFor) return;
		const onKeyDown = (e: KeyboardEvent) => {
			e.preventDefault();
			e.stopPropagation();
			if (e.key === "Escape") {
				setCaptureFor(null);
				return;
			}
			if (MODIFIER_KEYS.has(e.key)) return;
			const nextBinding: ShortcutBinding = {
				key: e.key.toLowerCase(),
				...((isMac ? e.metaKey : e.ctrlKey) ? { ctrl: true } : {}),
				...(e.shiftKey ? { shift: true } : {}),
				...(e.altKey ? { alt: true } : {}),
			};
			const conflict = findLaunchConflict(nextBinding, captureFor, draft);
			setCaptureFor(null);
			if (conflict) {
				setConflictAction(conflict.action);
				return;
			}
			setConflictAction(null);
			setDraft((prev) => ({ ...prev, [captureFor]: nextBinding }));
		};
		window.addEventListener("keydown", onKeyDown, { capture: true });
		return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
	}, [captureFor, draft]);

	const save = async () => {
		setLaunchShortcuts(draft);
		await persistShortcuts(undefined, draft);
		requestClose(POPOVER_ID);
	};

	return (
		<HudPopover
			open={open}
			onOpenChange={(nextOpen) => (nextOpen ? requestOpen(POPOVER_ID) : requestClose(POPOVER_ID))}
			trigger={trigger}
			align="end"
			contentClassName={styles.shortcutsMenuCard}
		>
			<div className={styles.ddLabel}>{t("recording.shortcuts.title")}</div>
			{LAUNCH_SHORTCUT_ACTIONS.map((action) => {
				const isCapturing = captureFor === action;
				return (
					<DropdownItem
						key={action}
						icon={<Keyboard size={16} />}
						onClick={() => {
							setConflictAction(null);
							setCaptureFor(isCapturing ? null : action);
						}}
						trailing={
							<kbd className="ml-auto rounded border border-[var(--launch-border)] bg-[var(--launch-panel)] px-2 py-0.5 font-mono text-[11px] text-[var(--launch-text)]">
								{isCapturing
									? t("recording.shortcuts.pressKeys")
									: formatBinding(draft[action], isMac)}
							</kbd>
						}
					>
						{t(ACTION_I18N_KEY[action])}
					</DropdownItem>
				);
			})}
			{conflictAction && (
				<div className="px-2 py-1 text-xs text-amber-500">
					{t("recording.shortcuts.conflict", undefined, {
						action: t(ACTION_I18N_KEY[conflictAction]),
					})}
				</div>
			)}
			<div className="mt-1 flex gap-1">
				<button
					type="button"
					className={`${styles.ddItem} justify-center`}
					onClick={() => setDraft({ ...DEFAULT_LAUNCH_SHORTCUTS })}
				>
					<RotateCcw size={14} />
					{t("recording.shortcuts.reset")}
				</button>
				<button
					type="button"
					className={`${styles.ddItem} ${styles.ddItemSelected} justify-center`}
					onClick={() => {
						void save();
					}}
				>
					{t("recording.shortcuts.save")}
				</button>
			</div>
		</HudPopover>
	);
}
