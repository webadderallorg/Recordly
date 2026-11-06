import type { WebcamShape } from "../../video-editor/types";
import { getWebcamClipPath } from "../../video-editor/webcamOverlay";
import {
	Eye,
	EyeSlash as EyeOff,
	VideoCamera as Video,
	VideoCameraSlash as VideoOff,
} from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import { DropdownItem, HudPopover } from "./PopoverScaffold";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import type { DeviceOption } from "./launchPopoverTypes";
import type { ReactElement } from "react";

import styles from "../LaunchWindow.module.css";

const POPOVER_ID = "webcam";

export function WebcamPopover({
	trigger,
	disabled,
	webcamEnabled,
	onDisableWebcam,
	canToggleFloatingPreview,
	showFloatingWebcamPreview,
	onToggleFloatingPreview,
	showWebcamControls,
	roundness,
	shape,
	setWebcamPreviewNode,
	videoDevices,
	webcamDeviceId,
	selectedVideoDeviceId,
	onSelectVideoDevice,
}: {
	trigger: ReactElement;
	disabled?: boolean;
	webcamEnabled: boolean;
	onDisableWebcam: () => void;
	canToggleFloatingPreview: boolean;
	showFloatingWebcamPreview: boolean;
	onToggleFloatingPreview: () => void;
	showWebcamControls: boolean;
	roundness: number;
	shape?: WebcamShape;
	setWebcamPreviewNode: (node: HTMLVideoElement | null) => void;
	videoDevices: DeviceOption[];
	webcamDeviceId?: string;
	selectedVideoDeviceId?: string;
	onSelectVideoDevice: (deviceId: string) => void;
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
			align="center"
		>
			<section className={styles.deviceSection} aria-label={t("recording.camera", "Camera")}>
				<div className={styles.ddLabel}>{t("recording.camera", "Camera")}</div>
				<DropdownItem
					icon={<VideoOff size={16} />}
					selected={!webcamEnabled}
					onClick={() => {
						onDisableWebcam();
						requestClose(POPOVER_ID);
					}}
				>
					{t("recording.off", "Off")}
				</DropdownItem>
				{videoDevices.map((device) => (
					<DropdownItem
						key={device.deviceId}
						icon={<Video size={16} />}
						selected={
							webcamEnabled &&
							(webcamDeviceId === device.deviceId ||
								selectedVideoDeviceId === device.deviceId)
						}
						onClick={() => onSelectVideoDevice(device.deviceId)}
					>
						{device.label}
					</DropdownItem>
				))}
				{videoDevices.length === 0 && (
					<div className={styles.deviceDescription}>{t("recording.noWebcamsFound")}</div>
				)}
			</section>
			{webcamEnabled && (canToggleFloatingPreview || showWebcamControls) && (
				<section
					className={styles.deviceSection}
					aria-label={t("recording.cameraPreview", "Preview")}
				>
					<div className={styles.ddLabel}>{t("recording.cameraPreview", "Preview")}</div>
					{canToggleFloatingPreview && (
						<DropdownItem
							icon={
								showFloatingWebcamPreview ? <EyeOff size={16} /> : <Eye size={16} />
							}
							selected={showFloatingWebcamPreview}
							onClick={onToggleFloatingPreview}
						>
							{showFloatingWebcamPreview
								? t("recording.hideFloatingWebcamPreview")
								: t("recording.showFloatingWebcamPreview")}
						</DropdownItem>
					)}
					{showWebcamControls && (
						<div className="flex justify-center px-3 py-2">
							<div
								className="h-24 w-24 overflow-hidden bg-[var(--launch-hover)]"
								style={{ clipPath: getWebcamClipPath(roundness, 96, 96, shape) }}
							>
								<video
									ref={setWebcamPreviewNode}
									className="h-full w-full object-cover"
									muted
									playsInline
									style={{ transform: "scaleX(-1)" }}
								/>
							</div>
						</div>
					)}
				</section>
			)}
		</HudPopover>
	);
}
