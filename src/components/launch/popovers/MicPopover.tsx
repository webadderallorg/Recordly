import { type ReactElement, useState } from "react";
import { MicrophoneSlashIcon, SpeakerHighIcon, SpeakerXIcon } from "@/components/ui/icons";
import { toast } from "@/components/ui/toast";
import { useScopedT } from "@/contexts/I18nContext";
import { saveAppSetting } from "@/lib/appSettings";
import {
	canNameMicrophone,
	findMicrophoneName,
	loadMicrophoneNames,
	MICROPHONE_NAMES_KEY,
	updateMicrophoneName,
} from "@/lib/microphoneNames";
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
	const [names, setNames] = useState(loadMicrophoneNames);
	async function rename(device: DeviceOption, currentName: string) {
		try {
			const value = await window.electronAPI.openMicrophoneNameDialog(
				device.label,
				currentName,
			);
			if (value === null) return;
			const next = updateMicrophoneName(
				device,
				devices,
				names,
				window.location.origin,
				value,
			);
			if (saveAppSetting(MICROPHONE_NAMES_KEY, next)) {
				setNames(next);
				return;
			}
		} catch (error) {
			console.error("Could not rename microphone", error);
		}
		toast.error(t("recording.microphoneNameFailed", "Could not save the microphone name."));
	}
	const activeSources = [
		microphoneEnabled ? t("recording.microphone") : null,
		systemAudioEnabled ? t("recording.systemAudio") : null,
	].filter((source): source is string => source !== null);
	const tooltip = t("recording.settingValue", "{{setting}}: {{value}}", {
		setting: t("recording.audioSettings", "Audio settings"),
		value: activeSources.length > 0 ? activeSources.join(", ") : t("recording.off"),
	});
	const describeSource = (setting: string, enabled: boolean) =>
		t("recording.settingValue", "{{setting}}: {{value}}", {
			setting,
			value: t(enabled ? "recording.on" : "recording.off"),
		});
	const description = [
		describeSource(t("recording.microphone"), microphoneEnabled),
		describeSource(t("recording.systemAudio"), systemAudioEnabled),
	].join(". ");

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
			label={t("recording.audioSettings", "Audio settings")}
			tooltip={tooltip}
			description={description}
		>
			<DropdownItem
				icon={
					systemAudioEnabled ? <SpeakerHighIcon size={16} /> : <SpeakerXIcon size={16} />
				}
				selected={systemAudioEnabled}
				onClick={onToggleSystemAudio}
			>
				{t("recording.systemAudio")}
			</DropdownItem>
			<div className={styles.ddLabel}>{t("recording.microphone")}</div>
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
			{devices.map((device) => {
				const name = findMicrophoneName(
					device,
					devices,
					names,
					window.location.origin,
				)?.name;
				return (
					<MicDeviceRow
						key={device.deviceId}
						device={device}
						customName={name}
						onRename={
							canNameMicrophone(device)
								? () => void rename(device, name ?? "")
								: undefined
						}
						selected={
							microphoneEnabled &&
							(microphoneDeviceId === device.deviceId ||
								selectedDeviceId === device.deviceId)
						}
						onSelect={() => onSelectDevice(device.deviceId)}
					/>
				);
			})}
			{devices.length === 0 && (
				<div className="text-center text-xs text-[var(--launch-text-muted)] py-4">
					{t("recording.noMicrophonesFound")}
				</div>
			)}
		</HudPopover>
	);
}
