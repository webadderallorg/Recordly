import {
	CheckCircleIcon,
	MicrophoneIcon,
	MicrophoneSlashIcon,
	SpeakerHighIcon,
	SpeakerXIcon,
} from "@phosphor-icons/react";
import type { ReactElement } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import type { NoiseSuppressionMode } from "@/lib/audio/noiseSuppression";
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
	onDisableMicrophone,
	devices,
	microphoneDeviceId,
	selectedDeviceId,
	onSelectDevice,
	noiseSuppressionMode,
	onSelectNoiseSuppressionMode,
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
	noiseSuppressionMode: NoiseSuppressionMode;
	onSelectNoiseSuppressionMode: (mode: NoiseSuppressionMode) => void;
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
			<div className={styles.ddLabel}>{t("recording.noiseSuppression")}</div>
			<NoiseSuppressionOption
				mode="rnnoise"
				selectedMode={noiseSuppressionMode}
				label={t("recording.noiseSuppressionRnnoise")}
				description={t("recording.noiseSuppressionRnnoiseDescription")}
				onSelect={onSelectNoiseSuppressionMode}
			/>
			<NoiseSuppressionOption
				mode="speex"
				selectedMode={noiseSuppressionMode}
				label={t("recording.noiseSuppressionSpeex")}
				description={t("recording.noiseSuppressionSpeexDescription")}
				onSelect={onSelectNoiseSuppressionMode}
			/>
			<NoiseSuppressionOption
				mode="disabled"
				selectedMode={noiseSuppressionMode}
				label={t("recording.noiseSuppressionDisabled")}
				description={t("recording.noiseSuppressionDisabledDescription")}
				onSelect={onSelectNoiseSuppressionMode}
			/>
		</HudPopover>
	);
}

/**
 * Renders one selectable noise suppression mode in the microphone popover.
 */
function NoiseSuppressionOption({
	mode,
	selectedMode,
	label,
	description,
	onSelect,
}: {
	mode: NoiseSuppressionMode;
	selectedMode: NoiseSuppressionMode;
	label: string;
	description: string;
	onSelect: (mode: NoiseSuppressionMode) => void;
}) {
	const selected = mode === selectedMode;
	return (
		<button
			type="button"
			className={`${styles.ddItem} ${selected ? styles.ddItemSelected : ""} items-start`}
			onClick={() => onSelect(mode)}
		>
			<span className="shrink-0 mt-0.5">
				{selected ? <CheckCircleIcon size={16} /> : <MicrophoneIcon size={16} />}
			</span>
			<span className="min-w-0 flex-1 text-left">
				<span className="block truncate">{label}</span>
				<span className="block whitespace-normal text-[11px] leading-4 text-[var(--launch-text-muted)]">
					{description}
				</span>
			</span>
		</button>
	);
}
