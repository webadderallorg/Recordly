import {
	MicrophoneIcon,
	MicrophoneSlashIcon,
	SpeakerHighIcon,
	SpeakerXIcon,
} from "@phosphor-icons/react";
import type { ReactElement } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import styles from "../LaunchWindow.module.css";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import type { DeviceOption } from "./launchPopoverTypes";
import { DropdownItem, HudPopover, MicDeviceRow } from "./PopoverScaffold";

const POPOVER_ID = "mic";

export function MicPopover({
	trigger,
	disabled,
	systemAudioEnabled,
	onToggleSystemAudio,
	microphoneEnabled,
	phoneMicrophoneEnabled,
	isPhoneMicAvailable,
	phoneRemoteStatusLabel,
	onTogglePhoneMicrophone,
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
	phoneMicrophoneEnabled: boolean;
	isPhoneMicAvailable: boolean;
	phoneRemoteStatusLabel: string;
	onTogglePhoneMicrophone: () => void;
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
			<div className={styles.ddLabel}>{t("recording.microphone")}</div>
			<DropdownItem
				icon={
					systemAudioEnabled ? <SpeakerHighIcon size={16} /> : <SpeakerXIcon size={16} />
				}
				selected={systemAudioEnabled}
				onClick={onToggleSystemAudio}
			>
				{systemAudioEnabled
					? t("recording.disableSystemAudio")
					: t("recording.enableSystemAudio")}
			</DropdownItem>
			<DropdownItem
				icon={
					isPhoneMicAvailable ? (
						<MicrophoneIcon size={16} />
					) : (
						<MicrophoneSlashIcon size={16} />
					)
				}
				selected={phoneMicrophoneEnabled}
				onClick={onTogglePhoneMicrophone}
				trailing={
					<span className={styles.phoneStatusPill}>
						{isPhoneMicAvailable ? "active" : phoneRemoteStatusLabel}
					</span>
				}
			>
				Phone microphone
			</DropdownItem>
			{phoneMicrophoneEnabled && microphoneEnabled ? (
				<div className={styles.phoneRemoteWarning}>
					Both phone and laptop microphones are enabled. Echo or duplicated voice is
					likely.
				</div>
			) : null}
			{microphoneEnabled && (
				<DropdownItem
					icon={<MicrophoneSlashIcon size={16} />}
					onClick={() => {
						onDisableMicrophone();
						requestClose(POPOVER_ID);
					}}
				>
					{t("recording.turnOffMicrophone")}
				</DropdownItem>
			)}
			{!microphoneEnabled && (
				<div className="px-3 py-2 text-xs text-[var(--launch-text-muted)]">
					{t("recording.selectMicToEnable")}
				</div>
			)}
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
				<div className="text-center text-xs text-[var(--launch-text-muted)] py-4">
					{t("recording.noMicrophonesFound")}
				</div>
			)}
		</HudPopover>
	);
}
