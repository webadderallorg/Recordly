import { Switch } from "@/components/ui/switch";
import { useScopedT } from "@/contexts/I18nContext";
import { useEffect, useState, type ReactElement } from "react";
import {
	loadEditorPreferences,
	saveEditorPreferences,
} from "../../video-editor/editorPreferences";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import { HudPopover } from "./PopoverScaffold";
import styles from "../LaunchWindow.module.css";

const POPOVER_ID = "more";

export function MorePopover({ trigger }: { trigger: ReactElement }) {
	const t = useScopedT("launch");
	const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
	const open = isOpen(POPOVER_ID);
	const [motionAnimationEnabled, setMotionAnimationEnabled] = useState(true);

	useEffect(() => {
		if (!open) {
			return;
		}
		setMotionAnimationEnabled(loadEditorPreferences().motionAnimationEnabled);
	}, [open]);

	const handleMotionAnimationChange = (enabled: boolean) => {
		setMotionAnimationEnabled(enabled);
		saveEditorPreferences({ motionAnimationEnabled: enabled });
	};

	return (
		<HudPopover
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					requestClose(POPOVER_ID);
					return;
				}
				requestOpen(POPOVER_ID);
			}}
			trigger={trigger}
			align="start"
		>
			<div className={styles.ddLabel}>{t("recording.more")}</div>
			<div className="flex items-center justify-between gap-3 px-3 py-2">
				<div className="min-w-0">
					<div className="text-sm text-[var(--launch-text)]">
						{t("recording.motionAnimation")}
					</div>
					<div className="mt-0.5 text-xs text-[var(--launch-text-muted)]">
						{t("recording.motionAnimationDescription")}
					</div>
				</div>
				<Switch
					aria-label={
						motionAnimationEnabled
							? t("recording.motionAnimationOn")
							: t("recording.motionAnimationOff")
					}
					checked={motionAnimationEnabled}
					onCheckedChange={handleMotionAnimationChange}
				/>
			</div>
		</HudPopover>
	);
}
