import { MicrophoneSlashIcon, SpeakerHighIcon, SpeakerXIcon } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import { DropdownItem, HudPopover, MicDeviceRow } from "./PopoverScaffold";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import type { DeviceOption } from "./launchPopoverTypes";
import type { ReactElement } from "react";
import styles from "../LaunchWindow.module.css";

const POPOVER_ID = "mic";

export function MicPopover({
	trigger,
	disabled,
	systemAudioEnabled,
	onToggleSystemAudio,
	microphoneEnabled,
	onDisableMicrophone,
	devices,
	microphoneDeviceId,
	selectedDeviceId,
	onSelectDevice,
}: {
	trigger: ReactElement;
	disabled?: boolean;
	systemAudioEnabled: boolean;
	onToggleSystemAudio: () => void;
	microphoneEnabled: boolean;
	onDisableMicrophone: () => void;
	devices: DeviceOption[];
	microphoneDeviceId?: string;
	selectedDeviceId?: string;
	onSelectDevice: (deviceId: string) => void;
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
				if (disabled) {
					return;
				}
				requestOpen(POPOVER_ID);
			}}
			trigger={trigger}
			align="start"
		>
			<section
				className={styles.deviceSection}
				aria-label={t("recording.systemAudio", "Computer audio")}
			>
				<div className={styles.ddLabel}>{t("recording.systemAudio", "Computer audio")}</div>
				<div className={styles.deviceDescription}>
					{t("recording.systemAudioDescription", "Apps, videos and system sounds")}
				</div>
				<DropdownItem
					icon={
						systemAudioEnabled ? (
							<SpeakerHighIcon size={16} />
						) : (
							<SpeakerXIcon size={16} />
						)
					}
					selected={systemAudioEnabled}
					onClick={onToggleSystemAudio}
				>
					{systemAudioEnabled
						? t("recording.disableSystemAudio")
						: t("recording.enableSystemAudio")}
				</DropdownItem>
			</section>
			<section className={styles.deviceSection} aria-label={t("recording.microphone")}>
				<div className={styles.ddLabel}>{t("recording.microphone")}</div>
				<DropdownItem
					icon={<MicrophoneSlashIcon size={16} />}
					selected={!microphoneEnabled}
					onClick={() => {
						onDisableMicrophone();
						requestClose(POPOVER_ID);
					}}
				>
					{t("recording.off", "Off")}
				</DropdownItem>
				{devices.map((device) => (
					<MicDeviceRow
						key={device.deviceId}
						device={device}
						selected={
							microphoneEnabled &&
							(microphoneDeviceId === device.deviceId ||
								selectedDeviceId === device.deviceId)
						}
						onSelect={() => onSelectDevice(device.deviceId)}
					/>
				))}
				{devices.length === 0 && (
					<div className={styles.deviceDescription}>
						{t("recording.noMicrophonesFound")}
					</div>
				)}
			</section>
		</HudPopover>
	);
}
