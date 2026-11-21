import type { ReactElement } from "react";
import {
	Eye,
	EyeSlash as EyeOff,
	VideoCamera as Video,
	VideoCameraSlash as VideoOff,
} from "@/components/ui/icons";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import type { WebcamShape } from "../../video-editor/types";
import { getWebcamClipPath } from "../../video-editor/webcamOverlay";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import type { DeviceOption } from "./launchPopoverTypes";
import { DropdownItem, HudPopover } from "./PopoverScaffold";

const POPOVER_ID = "webcam";

export function WebcamPopover({
	trigger,
	disabled,
	cameraPermission,
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
	cameraPermission: string;
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
	const { t: appT } = useI18n();
	const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
	const open = isOpen(POPOVER_ID);
	const cameraAllowed = cameraPermission === "granted";

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
			label={t("recording.cameraSettings", "Camera settings")}
		>
			<div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--launch-label)]">
				{t("recording.webcam")}
			</div>
			{webcamEnabled && (
				<>
					<DropdownItem
						icon={<VideoOff size={16} />}
						onClick={() => {
							onDisableWebcam();
							requestClose(POPOVER_ID);
						}}
					>
						{t("recording.turnOffWebcam")}
					</DropdownItem>
					{canToggleFloatingPreview ? (
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
					) : null}
				</>
			)}
			{cameraAllowed && !webcamEnabled && (
				<div className="px-3 py-2 text-xs text-[var(--launch-text-muted)]">
					{t("recording.selectWebcamToEnable")}
				</div>
			)}
			{showWebcamControls && (
				<div className="flex justify-center px-3 py-2">
					<div className="relative h-24 w-24">
						<video
							ref={setWebcamPreviewNode}
							className="h-full w-full object-cover bg-[var(--launch-hover)]"
							muted
							playsInline
							style={{
								transform: "scaleX(-1)",
								clipPath: getWebcamClipPath(roundness, 96, 96, shape),
							}}
						/>
					</div>
				</div>
			)}
			{cameraAllowed &&
				videoDevices.map((device) => (
					<DropdownItem
						key={device.deviceId}
						icon={
							webcamEnabled &&
							(webcamDeviceId === device.deviceId ||
								selectedVideoDeviceId === device.deviceId) ? (
								<Video size={16} />
							) : (
								<VideoOff size={16} />
							)
						}
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
			{cameraAllowed && videoDevices.length === 0 && (
				<div className="text-center text-xs text-[var(--launch-text-muted)] py-4">
					{t("recording.noWebcamsFound")}
				</div>
			)}
			{cameraPermission === "checking" && (
				<p role="status" className="px-3 py-2 text-xs text-[var(--launch-text-muted)]">
					{appT("settings.permissions.checking")}
				</p>
			)}
			{!cameraAllowed && cameraPermission !== "checking" && (
				<DropdownItem
					icon={<VideoOff size={16} />}
					onClick={() => void window.electronAPI.openMediaPermissionPreferences("camera")}
				>
					{appT("settings.permissions.openSystemSettings")}
				</DropdownItem>
			)}
		</HudPopover>
	);
}
