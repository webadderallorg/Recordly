import type { ReactElement } from "react";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { CountdownDelayIcon } from "../CountdownDelayIcon";
import styles from "../LaunchWindow.module.css";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import { DropdownItem, HudPopover } from "./PopoverScaffold";

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
	const formatDelay = (delay: number, unitDisplay: "short" | "long" = "short") =>
		delay === 0
			? t("recording.noDelay")
			: new Intl.NumberFormat(locale, {
					style: "unit",
					unit: "second",
					unitDisplay,
				}).format(delay);
	const tooltip = t("recording.settingValue", "{{setting}}: {{value}}", {
		setting: t("recording.countdownDelay"),
		value: formatDelay(countdownDelay),
	});

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
			label={t("recording.countdownDelay")}
			tooltip={tooltip}
			description={formatDelay(countdownDelay, "long")}
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
					{formatDelay(delay)}
				</DropdownItem>
			))}
		</HudPopover>
	);
}
