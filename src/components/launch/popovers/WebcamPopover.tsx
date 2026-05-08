import {
	Eye,
	EyeSlash as EyeOff,
	VideoCamera as Video,
	VideoCameraSlash as VideoOff,
} from "@phosphor-icons/react";
import type { ReactElement } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import styles from "../LaunchWindow.module.css";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import type { DeviceOption } from "./launchPopoverTypes";
import { DropdownItem, HudPopover } from "./PopoverScaffold";

const POPOVER_ID = "webcam";
type WebcamSource = "local" | "phone";
type PhoneJoinQr = { path: string; size: number } | null;

export function WebcamPopover({
	trigger,
	disabled,
	webcamEnabled,
	webcamSource,
	onDisableWebcam,
	canToggleFloatingPreview,
	showFloatingWebcamPreview,
	onToggleFloatingPreview,
	showWebcamControls,
	setWebcamPreviewNode,
	isPhoneWebcamSelected,
	phoneRemoteStatusLabel,
	phoneRemoteSession,
	phoneJoinQr,
	phoneRemoteMicActive,
	phoneRemoteSecureJoinReady,
	phoneRemoteError,
	phoneRemoteStatusDetail,
	onSelectPhoneAsCamera,
	onSelectLaptopWebcam,
	onCopyPhoneJoinLink,
	videoDevices,
	webcamDeviceId,
	selectedVideoDeviceId,
	onSelectVideoDevice,
}: {
	trigger: ReactElement;
	disabled?: boolean;
	webcamEnabled: boolean;
	webcamSource: WebcamSource;
	onDisableWebcam: () => void;
	canToggleFloatingPreview: boolean;
	showFloatingWebcamPreview: boolean;
	onToggleFloatingPreview: () => void;
	showWebcamControls: boolean;
	setWebcamPreviewNode: (node: HTMLVideoElement | null) => void;
	isPhoneWebcamSelected: boolean;
	phoneRemoteStatusLabel: string;
	phoneRemoteSession: RendererPhoneRemoteSession | null;
	phoneJoinQr: PhoneJoinQr;
	phoneRemoteMicActive: boolean;
	phoneRemoteSecureJoinReady: boolean;
	phoneRemoteError: string | null;
	phoneRemoteStatusDetail: string | null;
	onSelectPhoneAsCamera: () => void;
	onSelectLaptopWebcam: () => void;
	onCopyPhoneJoinLink: () => void;
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
			<div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--launch-label)]">
				{t("recording.webcam")}
			</div>
			<DropdownItem
				icon={isPhoneWebcamSelected ? <Video size={16} /> : <VideoOff size={16} />}
				selected={isPhoneWebcamSelected}
				onClick={onSelectPhoneAsCamera}
				trailing={<span className={styles.phoneStatusPill}>{phoneRemoteStatusLabel}</span>}
			>
				Use phone as camera
			</DropdownItem>
			{isPhoneWebcamSelected ? (
				<div className={styles.phoneRemotePanel}>
					<div className={styles.phoneRemoteHeader}>
						<span>{phoneRemoteStatusLabel}</span>
						<span>{phoneRemoteMicActive ? "Mic active" : "Mic waiting"}</span>
					</div>
					<div className={styles.phoneRemoteCode}>
						{phoneRemoteSession?.code ?? "Start pairing"}
					</div>
					{phoneRemoteSession ? (
						<>
							{phoneJoinQr ? (
								<div className={styles.phoneRemoteQr}>
									<svg
										role="img"
										aria-labelledby="phone-remote-qr-title"
										viewBox={`0 0 ${phoneJoinQr.size} ${phoneJoinQr.size}`}
										shapeRendering="crispEdges"
									>
										<title id="phone-remote-qr-title">
											Scan to connect phone
										</title>
										<rect
											width={phoneJoinQr.size}
											height={phoneJoinQr.size}
											fill="#ffffff"
										/>
										<path d={phoneJoinQr.path} fill="#111827" />
									</svg>
								</div>
							) : null}
							<div className={styles.phoneRemoteLink}>
								{phoneRemoteSession.joinUrl}
							</div>
							<button
								type="button"
								className={styles.phoneRemoteButton}
								onClick={onCopyPhoneJoinLink}
							>
								Copy join link
							</button>
							{!phoneRemoteSecureJoinReady ? (
								<div className={styles.phoneRemoteWarning}>
									Phone browsers usually require HTTPS for camera and mic access.
									A secure tunnel was unavailable, so use the LAN link only if
									your browser allows it.
								</div>
							) : null}
							{phoneRemoteError || phoneRemoteStatusDetail ? (
								<div className={styles.phoneRemoteDetail}>
									{phoneRemoteError ?? phoneRemoteStatusDetail}
								</div>
							) : null}
						</>
					) : (
						<button
							type="button"
							className={styles.phoneRemoteButton}
							onClick={onSelectPhoneAsCamera}
						>
							Create phone session
						</button>
					)}
				</div>
			) : null}
			{webcamSource === "phone" ? (
				<DropdownItem icon={<Video size={16} />} onClick={onSelectLaptopWebcam}>
					Use laptop webcam instead
				</DropdownItem>
			) : null}
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
			{!webcamEnabled && (
				<div className="px-3 py-2 text-xs text-[var(--launch-text-muted)]">
					{t("recording.selectWebcamToEnable")}
				</div>
			)}
			{showWebcamControls && (
				<div className="flex justify-center px-3 py-2">
					<div className="h-24 w-24 overflow-hidden rounded-2xl bg-[var(--launch-hover)] ring-1 ring-[var(--launch-border-strong)]">
						<video
							ref={setWebcamPreviewNode}
							className="h-full w-full object-cover"
							muted
							playsInline
							style={{
								transform: webcamSource === "local" ? "scaleX(-1)" : undefined,
							}}
						/>
					</div>
				</div>
			)}
			{webcamSource === "local"
				? videoDevices.map((device) => (
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
					))
				: null}
			{webcamSource === "local" && videoDevices.length === 0 && (
				<div className="text-center text-xs text-[var(--launch-text-muted)] py-4">
					{t("recording.noWebcamsFound")}
				</div>
			)}
		</HudPopover>
	);
}
