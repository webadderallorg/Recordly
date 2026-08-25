import {
	Eye,
	EyeSlash as EyeOff,
	VideoCamera as Video,
	VideoCameraSlash as VideoOff,
} from "@phosphor-icons/react";
import { useScopedT } from "@/contexts/I18nContext";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { WebcamBackgroundBlurPreview } from "@/components/webcam/WebcamBackgroundBlurPreview";
import { useWebcamBackgroundBlurStatus } from "@/hooks/useWebcamBackgroundBlurStatus";
import type { WebcamBackgroundBlurSettings } from "@/lib/webcamBackgroundBlur";
import { DropdownItem, HudPopover } from "./PopoverScaffold";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import type { DeviceOption } from "./launchPopoverTypes";
import type { ReactElement } from "react";

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
	setWebcamPreviewNode,
	videoDevices,
	webcamDeviceId,
	selectedVideoDeviceId,
	onSelectVideoDevice,
	backgroundBlur,
	onBackgroundBlurChange,
}: {
	trigger: ReactElement;
	disabled?: boolean;
	webcamEnabled: boolean;
	onDisableWebcam: () => void;
	canToggleFloatingPreview: boolean;
	showFloatingWebcamPreview: boolean;
	onToggleFloatingPreview: () => void;
	showWebcamControls: boolean;
	setWebcamPreviewNode: (node: HTMLVideoElement | null) => void;
	videoDevices: DeviceOption[];
	webcamDeviceId?: string;
	selectedVideoDeviceId?: string;
	onSelectVideoDevice: (deviceId: string) => void;
	backgroundBlur: WebcamBackgroundBlurSettings;
	onBackgroundBlurChange: (settings: WebcamBackgroundBlurSettings) => void;
}) {
	const t = useScopedT("launch");
	const blurStatus = useWebcamBackgroundBlurStatus();
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
					<div className="mx-2 my-1 rounded-lg bg-[var(--launch-hover)] px-2.5 py-2">
						<div className="flex items-center justify-between gap-3">
							<span className="text-xs text-[var(--launch-text)]">
								{t("recording.blurWebcamBackground")}
							</span>
							<Switch
								checked={backgroundBlur.enabled}
								onCheckedChange={(enabled) =>
									onBackgroundBlurChange({ ...backgroundBlur, enabled })
								}
								aria-label={t("recording.blurWebcamBackground")}
							/>
						</div>
						{backgroundBlur.enabled ? (
							<div className="mt-2">
								<div className="mb-1 flex items-center justify-between text-[10px] text-[var(--launch-text-muted)]">
									<span>{t("recording.backgroundBlurStrength")}</span>
									<span>{backgroundBlur.amount}</span>
								</div>
								<Slider
									min={1}
									max={20}
									step={1}
									value={[backgroundBlur.amount]}
									onValueChange={([amount]) =>
										onBackgroundBlurChange({
											...backgroundBlur,
											amount: amount ?? backgroundBlur.amount,
										})
									}
								/>
								{blurStatus.status === "loading" ? (
									<p className="mt-1.5 text-[10px] text-[var(--launch-text-muted)]">
										{t("recording.backgroundBlurLoading")}
									</p>
								) : null}
								{blurStatus.status === "error" ? (
									<div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-amber-500">
										<span>{t("recording.backgroundBlurUnavailable")}</span>
										<button
											type="button"
											className="underline"
											onClick={blurStatus.retry}
										>
											{t("recording.retryBackgroundBlur")}
										</button>
									</div>
								) : null}
							</div>
						) : null}
					</div>
				</>
			)}
			{!webcamEnabled && (
				<div className="px-3 py-2 text-xs text-[var(--launch-text-muted)]">
					{t("recording.selectWebcamToEnable")}
				</div>
			)}
			{showWebcamControls && (
				<div className="flex justify-center px-3 py-2">
					<div className="h-24 w-24 overflow-hidden rounded-2xl bg-[var(--launch-hover)] ring-1 ring-[var(--launch-border-strong)]">
						<WebcamBackgroundBlurPreview
							videoRef={setWebcamPreviewNode}
							backgroundBlur={backgroundBlur}
							sourceKey={`launch:${webcamDeviceId ?? selectedVideoDeviceId ?? "default"}`}
							className="h-full w-full object-cover"
							muted
							playsInline
							style={{ transform: "scaleX(-1)" }}
						/>
					</div>
				</div>
			)}
			{videoDevices.map((device) => (
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
			{videoDevices.length === 0 && (
				<div className="text-center text-xs text-[var(--launch-text-muted)] py-4">
					{t("recording.noWebcamsFound")}
				</div>
			)}
		</HudPopover>
	);
}
