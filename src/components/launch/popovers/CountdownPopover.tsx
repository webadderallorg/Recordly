import { TimerIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import styles from "../LaunchWindow.module.css";
import { DropdownItem, HudPopover } from "./PopoverScaffold";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";

const POPOVER_ID = "countdown";
const COUNTDOWN_OPTIONS = [0, 3, 5, 10];

export function CountdownPopover({
	trigger,
	countdownDelay,
	onSelectDelay,
}: {
	trigger: ReactNode;
	countdownDelay: number;
	onSelectDelay: (delay: number) => void;
}) {
	const t = useScopedT("launch");
	const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
	const open = isOpen(POPOVER_ID);

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
			align="center"
		>
			<div className={styles.ddLabel}>{t("recording.countdownDelay")}</div>
			{COUNTDOWN_OPTIONS.map((delay) => (
				<DropdownItem
					key={delay}
					icon={<TimerIcon size={16} />}
					selected={countdownDelay === delay}
					onClick={() => {
						onSelectDelay(delay);
						requestClose(POPOVER_ID);
					}}
				>
					{delay === 0 ? t("recording.noDelay") : `${delay}s`}
				</DropdownItem>
			))}
		</HudPopover>
	);
}
