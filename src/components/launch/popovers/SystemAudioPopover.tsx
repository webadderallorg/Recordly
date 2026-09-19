import { SpeakerHighIcon, SpeakerXIcon } from "@phosphor-icons/react";
import type { ReactElement } from "react";
import { AudioLevelMeter } from "@/components/ui/audio-level-meter";
import { useScopedT } from "@/contexts/I18nContext";
import type { AudioOutputDevice } from "@/hooks/audioOutputDevices";
import { useAudioOutputLevels } from "@/hooks/useAudioOutputLevels";
import styles from "../LaunchWindow.module.css";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import { DropdownItem, HudPopover } from "./PopoverScaffold";

const POPOVER_ID = "system-audio";

export function getSystemAudioLevel(levels: Record<string, number>, deviceId: string) {
	return levels[deviceId] ?? 0;
}

export function SystemAudioPopover({
	trigger,
	disabled,
	deviceSelectionSupported = true,
	systemAudioEnabled,
	onToggleSystemAudio,
	devices,
	selectedDeviceId,
	onSelectDevice,
}: {
	trigger: ReactElement;
	disabled?: boolean;
	deviceSelectionSupported?: boolean;
	systemAudioEnabled: boolean;
	onToggleSystemAudio: () => void;
	devices: AudioOutputDevice[];
	selectedDeviceId?: string;
	onSelectDevice: (device: AudioOutputDevice) => void;
}) {
	const t = useScopedT("launch");
	const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
	const open = isOpen(POPOVER_ID);
	const levels = useAudioOutputLevels({
		enabled: open && deviceSelectionSupported,
		deviceIds: devices.map((device) => device.deviceId),
	});

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
			<div className={styles.ddLabel}>{t("recording.systemAudio", "System audio")}</div>
			<DropdownItem
				icon={
					systemAudioEnabled ? <SpeakerHighIcon size={16} /> : <SpeakerXIcon size={16} />
				}
				onClick={onToggleSystemAudio}
			>
				{systemAudioEnabled
					? t("recording.turnOffSystemAudio", "Turn Off System Audio")
					: t("recording.enableSystemAudio")}
			</DropdownItem>
			{deviceSelectionSupported && !systemAudioEnabled && (
				<div className="px-3 py-2 text-xs text-[var(--launch-text-muted)]">
					{t("recording.selectAudioOutputToEnable", "Select an output to enable")}
				</div>
			)}
			{deviceSelectionSupported &&
				devices.map((device) => (
					<DropdownItem
						key={device.deviceId}
						icon={
							selectedDeviceId === device.deviceId ? (
								<SpeakerHighIcon size={16} />
							) : (
								<SpeakerXIcon size={16} />
							)
						}
						selected={selectedDeviceId === device.deviceId}
						onClick={() => {
							onSelectDevice(device);
							requestClose(POPOVER_ID);
						}}
						trailing={
							<AudioLevelMeter
								level={getSystemAudioLevel(levels, device.deviceId)}
								className="w-16 shrink-0"
							/>
						}
					>
						{device.label}
					</DropdownItem>
				))}
			{deviceSelectionSupported && devices.length === 0 && (
				<div className="text-center text-xs text-[var(--launch-text-muted)] py-4">
					{t("recording.noAudioOutputsFound", "No audio outputs found")}
				</div>
			)}
		</HudPopover>
	);
}
