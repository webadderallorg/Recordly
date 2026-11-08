import { CountdownDelayIcon } from "../CountdownDelayIcon";
import type { ReactElement } from "react";
import { useScopedT, useI18n } from "@/contexts/I18nContext";
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
	trigger: ReactElement;
	countdownDelay: number;
	onSelectDelay: (delay: number) => void;
}) {
	const t = useScopedT("launch");
	const { locale } = useI18n();
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
					icon={<CountdownDelayIcon seconds={delay} className="size-4" />}
					selected={countdownDelay === delay}
					onClick={() => {
						onSelectDelay(delay);
						requestClose(POPOVER_ID);
					}}
				>
					{delay === 0
						? t("recording.noDelay")
						: new Intl.NumberFormat(locale, {
								style: "unit",
								unit: "second",
								unitDisplay: "short",
							}).format(delay)}
				</DropdownItem>
			))}
		</HudPopover>
	);
}
