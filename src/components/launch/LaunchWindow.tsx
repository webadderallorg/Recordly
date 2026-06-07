import {
	ArrowClockwiseIcon,
	CaretUpIcon,
	DotsThreeVerticalIcon,
	MicrophoneIcon,
	MicrophoneSlashIcon,
	MinusIcon,
	MonitorIcon,
	TimerIcon,
	VideoCameraIcon,
	VideoCameraSlashIcon,
	XIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { RxDragHandleDots2 } from "react-icons/rx";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { useScopedT } from "../../contexts/I18nContext";
import { useMicrophoneDevices } from "../../hooks/useMicrophoneDevices";
import { usePhoneRemoteMedia } from "../../hooks/usePhoneRemoteMedia";
import { useScreenRecorder } from "../../hooks/useScreenRecorder";
import { useVideoDevices } from "../../hooks/useVideoDevices";
import { createQrSvgPath } from "../../lib/simpleQr";
import { Button } from "../ui/button";
import { HudInteractionContext } from "./contexts/HudInteractionContext";
import { canToggleFloatingWebcamPreview } from "./floatingWebcamPreview";
import { useHudBarDrag } from "./hooks/useHudBarDrag";
import { useLaunchHudInteractionState } from "./hooks/useLaunchHudInteractionState";
import { useLaunchWindowActions } from "./hooks/useLaunchWindowActions";
import { useLaunchWindowSystemState } from "./hooks/useLaunchWindowSystemState";
import { useRecordingTimer } from "./hooks/useRecordingTimer";
import { useWebcamPreviewOverlay } from "./hooks/useWebcamPreviewOverlay";
import styles from "./LaunchWindow.module.css";
import { CountdownPopover } from "./popovers/CountdownPopover";
import {
	LaunchPopoverCoordinatorProvider,
	useLaunchPopoverCoordinator,
} from "./popovers/LaunchPopoverCoordinator";
import { MicPopover } from "./popovers/MicPopover";
import { MorePopover } from "./popovers/MorePopover";
import { ProjectPopover } from "./popovers/ProjectPopover";
import { SourcePopover } from "./popovers/SourcePopover";
import { WebcamPopover } from "./popovers/WebcamPopover";
import { RecordingControls } from "./RecordingControls";
import { MarqueeText } from "./SourceSelector";

const SHOW_DEV_UPDATE_PREVIEW = import.meta.env.DEV;

export function LaunchWindow() {
	return (
		<LaunchPopoverCoordinatorProvider>
			<LaunchWindowContent />
		</LaunchPopoverCoordinatorProvider>
	);
}

function LaunchWindowContent() {
	const t = useScopedT("launch");
	const { openId, requestClose, requestOpen } = useLaunchPopoverCoordinator();
	const phoneRemote = usePhoneRemoteMedia();

	const {
		recording,
		paused,
		finalizing,
		countdownActive,
		toggleRecording,
		pauseRecording,
		resumeRecording,
		cancelRecording,
		microphoneEnabled,
		setMicrophoneEnabled,
		microphoneDeviceId,
		setMicrophoneDeviceId,
		systemAudioEnabled,
		setSystemAudioEnabled,
		webcamEnabled,
		setWebcamEnabled,
		webcamSource,
		setWebcamSource,
		webcamDeviceId,
		setWebcamDeviceId,
		phoneMicrophoneEnabled,
		setPhoneMicrophoneEnabled,
		countdownDelay,
		setCountdownDelay,
		preparePermissions,
	} = useScreenRecorder({
		remoteWebcamStream: phoneRemote.videoActive ? phoneRemote.videoCaptureStream : null,
		remoteMicrophoneStream: phoneRemote.micActive ? phoneRemote.audioStream : null,
	});

	const { elapsed, formatTime } = useRecordingTimer(recording, paused);
	const hudContentRef = useRef<HTMLDivElement>(null);
	const hudBarRef = useRef<HTMLDivElement>(null);
	const micPopoverOpen = openId === "mic";
	const webcamPopoverOpen = openId === "webcam";
	const isPhoneWebcamSelected = webcamEnabled && webcamSource === "phone";
	const isPhoneMicAvailable = phoneRemote.micActive && phoneMicrophoneEnabled;
	const phoneJoinUrl = phoneRemote.session?.joinUrl ?? null;
	const phoneJoinQr = useMemo(
		() => (phoneJoinUrl ? createQrSvgPath(phoneJoinUrl) : null),
		[phoneJoinUrl],
	);
	const narratorMicrophoneActive = microphoneEnabled || isPhoneMicAvailable;
	const narratorMicrophoneTitle = isPhoneMicAvailable
		? "Phone microphone active"
		: phoneMicrophoneEnabled
			? "Phone microphone waiting"
			: microphoneEnabled
				? t("recording.disableMicrophone")
				: t("recording.enableMicrophone");

	const {
		selectedSource,
		hasSelectedSource,
		projectLibraryEntries,
		handleSourceSelect,
		openVideoFile,
		openProjectFromLibrary,
		syncSelectedSource,
		refreshProjectLibrary,
	} = useLaunchWindowActions();

	const showWebcamControls = webcamEnabled && !recording;
	const { devices, selectedDeviceId, setSelectedDeviceId } = useMicrophoneDevices(
		microphoneEnabled || micPopoverOpen,
		microphoneDeviceId,
	);
	const {
		devices: videoDevices,
		selectedDeviceId: selectedVideoDeviceId,
		setSelectedDeviceId: setSelectedVideoDeviceId,
	} = useVideoDevices(webcamSource === "local" && (webcamEnabled || webcamPopoverOpen));

	const {
		hudOverlayMousePassthroughSupported,
		platform,
		appVersion,
		hideHudFromCapture,
		chooseRecordingsDirectory,
		toggleHudCaptureProtection,
	} = useLaunchWindowSystemState(preparePermissions);

	const supportsHudCaptureProtection = platform !== "linux";

	useEffect(() => {
		if (!selectedDeviceId) {
			return;
		}

		setMicrophoneDeviceId(selectedDeviceId === "default" ? undefined : selectedDeviceId);
	}, [selectedDeviceId, setMicrophoneDeviceId]);

	useEffect(() => {
		if (selectedVideoDeviceId && selectedVideoDeviceId !== "default") {
			setWebcamDeviceId(selectedVideoDeviceId);
		}
	}, [selectedVideoDeviceId, setWebcamDeviceId]);

	const {
		showFloatingWebcamPreview,
		setShowFloatingWebcamPreview,
		showRecordingWebcamPreview,
		webcamPreviewOffset,
		recordingWebcamPreviewContainerRef,
		isWebcamPreviewDraggingRef,
		webcamPreviewDragStartRef,
		handleWebcamPreviewPointerDown,
		handleWebcamPreviewPointerMove,
		handleWebcamPreviewPointerUp,
		setWebcamPreviewNode,
		setRecordingWebcamPreviewNode,
	} = useWebcamPreviewOverlay({
		webcamEnabled,
		webcamSource,
		webcamDeviceId,
		remotePreviewStream: phoneRemote.previewStream,
		showWebcamControls,
		webcamPopoverOpen,
		hudOverlayMousePassthroughSupported,
	});

	const {
		recordingHudOffset,
		isHudDragging,
		hudBarTransformRef,
		isHudDraggingRef,
		handleHudBarPointerDown,
		handleHudBarPointerMove,
		handleHudBarPointerUp,
	} = useHudBarDrag({
		hudContentRef,
		hudBarRef,
		recordingWebcamPreviewContainerRef,
	});

	const { handleHudMouseEnter, handleHudMouseLeave, beginInteractiveHudAction } =
		useLaunchHudInteractionState({
			openId,
			isHudDraggingRef,
			isWebcamPreviewDraggingRef,
			webcamPreviewDragStartRef,
		});

	useEffect(() => {
		let mounted = true;

		void window.electronAPI.getSelectedSource().then((source) => {
			if (mounted) syncSelectedSource(source);
		});

		const cleanup = window.electronAPI.onSelectedSourceChanged((source) => {
			if (mounted) syncSelectedSource(source);
		});

		return () => {
			mounted = false;
			cleanup?.();
		};
	}, [syncSelectedSource]);

	const hudStateTransition = {
		duration: 0.24,
		ease: [0.22, 1, 0.36, 1] as const,
	};

	const phoneRemoteStatusLabel = (() => {
		switch (phoneRemote.status) {
			case "idle":
				return "Not connected";
			case "waiting":
				return "Waiting for phone";
			case "phone-connected":
				return "Phone connected";
			case "preview-live":
				return "Camera live";
			case "mic-active":
				return "Mic active";
			case "reconnecting":
				return "Reconnecting";
			case "disconnected":
				return "Disconnected";
			case "error":
				return "Needs attention";
		}
	})();

	const showRecordingMicrophoneStatus = () => {
		if (isPhoneMicAvailable) {
			toast.info("Phone microphone is recording.");
			return;
		}

		if (phoneMicrophoneEnabled) {
			toast.info(
				"Phone microphone is waiting or disconnected. Screen recording is continuing.",
			);
			return;
		}

		if (microphoneEnabled) {
			toast.info("Laptop microphone is recording.");
			return;
		}

		toast.info("No narrator microphone is active.");
	};

	const togglePhoneMicrophone = () => {
		if (!phoneMicrophoneEnabled && !phoneRemote.session) {
			void selectPhoneAsCamera();
			return;
		}

		const nextEnabled = !phoneMicrophoneEnabled;
		setPhoneMicrophoneEnabled(nextEnabled);
		if (nextEnabled) {
			setMicrophoneEnabled(false);
		}
	};

	const selectPhoneAsCamera = async () => {
		if (recording) {
			return;
		}

		setWebcamSource("phone");
		setWebcamEnabled(true);
		setPhoneMicrophoneEnabled(true);
		setMicrophoneEnabled(false);
		if (!phoneRemote.session) {
			await phoneRemote.startSession();
		}
	};

	const selectLaptopWebcam = () => {
		if (recording) {
			return;
		}

		setWebcamSource("local");
		setPhoneMicrophoneEnabled(false);
		phoneRemote.stopSession();
	};

	const handleRecordClick = () => {
		if (!hasSelectedSource && platform !== "linux") {
			beginInteractiveHudAction();
			requestOpen("sources");
			return;
		}

		if (
			webcamSource === "phone" &&
			webcamEnabled &&
			!phoneRemote.videoActive &&
			!phoneRemote.micActive
		) {
			const shouldContinue = window.confirm(
				"Phone is not connected yet. Start recording the laptop screen without phone camera or phone mic?",
			);
			if (!shouldContinue) {
				beginInteractiveHudAction();
				requestOpen("webcam");
				return;
			}
		}

		toggleRecording();
	};

	const recordingControls = (
		<RecordingControls
			paused={paused}
			microphoneEnabled={narratorMicrophoneActive}
			elapsed={elapsed}
			microphoneTitle={narratorMicrophoneTitle}
			onToggleMicrophone={showRecordingMicrophoneStatus}
			onPauseResume={paused ? resumeRecording : pauseRecording}
			onStopRecording={toggleRecording}
			onHideHud={() => window.electronAPI?.hudOverlayHide?.()}
			onCancelRecording={cancelRecording}
			formatTime={formatTime}
		/>
	);

	const idleControls = (
		<>
			{platform !== "linux" && (
				<>
					<SourcePopover
						selectedSource={selectedSource}
						onSourceSelect={handleSourceSelect}
						onOpen={beginInteractiveHudAction}
						trigger={
							<Button
								variant="outline"
								size="lg"
								className={`${styles.electronNoDrag} group gap-2 px-3 min-w-0 max-w-[180px] rounded-[11px] font-medium text-[12px] shrink-0 border-[var(--launch-border)] bg-[var(--launch-surface)] text-[var(--launch-text)] hover:border-[var(--launch-border-strong)] hover:bg-[var(--launch-hover)] transition-all ${openId === "sources" ? "border-[var(--launch-border-strong)] bg-[var(--launch-hover)]" : ""}`}
								title={selectedSource}
							>
								<MonitorIcon size={16} className="shrink-0" />
								<div className="flex-1 min-w-0 overflow-hidden">
									<MarqueeText text={selectedSource} />
								</div>
								<CaretUpIcon
									size={10}
									className={`text-[#6b6b78] ml-0.5 shrink-0 transition-transform duration-200 ${
										openId === "sources" ? "" : "rotate-180"
									}`}
								/>
							</Button>
						}
					/>

					<Separator orientation="vertical" className="mx-[5px] h-6" />
				</>
			)}

			<MicPopover
				disabled={recording}
				systemAudioEnabled={systemAudioEnabled}
				onToggleSystemAudio={() => setSystemAudioEnabled(!systemAudioEnabled)}
				microphoneEnabled={microphoneEnabled}
				phoneMicrophoneEnabled={phoneMicrophoneEnabled}
				isPhoneMicAvailable={isPhoneMicAvailable}
				phoneRemoteStatusLabel={phoneRemoteStatusLabel}
				onTogglePhoneMicrophone={togglePhoneMicrophone}
				onDisableMicrophone={() => setMicrophoneEnabled(false)}
				devices={devices}
				microphoneDeviceId={microphoneDeviceId}
				selectedDeviceId={selectedDeviceId}
				onSelectDevice={(deviceId) => {
					setMicrophoneEnabled(true);
					setSelectedDeviceId(deviceId);
					setMicrophoneDeviceId(deviceId === "default" ? undefined : deviceId);
				}}
				trigger={
					<Button
						variant="ghost"
						size="icon"
						iconSize="lg"
						title={narratorMicrophoneTitle}
						className={narratorMicrophoneActive ? styles.ibActive : ""}
					>
						{narratorMicrophoneActive ? (
							<MicrophoneIcon size={18} />
						) : (
							<MicrophoneSlashIcon size={18} />
						)}
					</Button>
				}
			/>

			<WebcamPopover
				disabled={recording}
				webcamEnabled={webcamEnabled}
				webcamSource={webcamSource}
				onDisableWebcam={() => {
					setWebcamEnabled(false);
					if (webcamSource === "phone") {
						setPhoneMicrophoneEnabled(false);
						phoneRemote.stopSession();
					}
				}}
				canToggleFloatingPreview={canToggleFloatingWebcamPreview(
					hudOverlayMousePassthroughSupported,
				)}
				showFloatingWebcamPreview={showFloatingWebcamPreview}
				onToggleFloatingPreview={() => setShowFloatingWebcamPreview((current) => !current)}
				showWebcamControls={showWebcamControls}
				setWebcamPreviewNode={setWebcamPreviewNode}
				isPhoneWebcamSelected={isPhoneWebcamSelected}
				phoneRemoteStatusLabel={phoneRemoteStatusLabel}
				phoneRemoteSession={phoneRemote.session}
				phoneJoinQr={phoneJoinQr}
				phoneRemoteMicActive={phoneRemote.micActive}
				phoneRemoteSecureJoinReady={phoneRemote.secureJoinReady}
				phoneRemoteError={phoneRemote.error}
				phoneRemoteStatusDetail={phoneRemote.statusDetail}
				onSelectPhoneAsCamera={() => void selectPhoneAsCamera()}
				onSelectLaptopWebcam={selectLaptopWebcam}
				onCopyPhoneJoinLink={() => void phoneRemote.copyJoinLink()}
				videoDevices={videoDevices}
				webcamDeviceId={webcamDeviceId}
				selectedVideoDeviceId={selectedVideoDeviceId}
				onSelectVideoDevice={(deviceId) => {
					selectLaptopWebcam();
					setWebcamEnabled(true);
					setSelectedVideoDeviceId(deviceId);
					setWebcamDeviceId(deviceId);
				}}
				trigger={
					<Button
						variant="ghost"
						size="icon"
						iconSize="lg"
						title={
							webcamEnabled
								? t("recording.disableWebcam")
								: t("recording.enableWebcam")
						}
						className={webcamEnabled ? styles.ibActive : ""}
					>
						{webcamEnabled ? (
							<VideoCameraIcon size={18} />
						) : (
							<VideoCameraSlashIcon size={18} />
						)}
					</Button>
				}
			/>

			<CountdownPopover
				countdownDelay={countdownDelay}
				onSelectDelay={setCountdownDelay}
				trigger={
					<Button
						variant="ghost"
						size="icon"
						iconSize="lg"
						title={t("recording.countdownDelay")}
						className={countdownDelay > 0 ? styles.ibActive : ""}
					>
						<TimerIcon size={18} />
					</Button>
				}
			/>

			<button
				type="button"
				className={`${styles.recBtn} ${styles.electronNoDrag}`}
				onClick={handleRecordClick}
				disabled={countdownActive}
				title={t("recording.record")}
			>
				<div className={styles.recDot} />
			</button>

			<Separator orientation="vertical" className="mx-[5px] h-6" />

			<div className="relative w-0 h-0">
				<ProjectPopover
					entries={projectLibraryEntries}
					onOpenProject={openProjectFromLibrary}
					trigger={<div className="absolute inset-0 pointer-events-none opacity-0" />}
				/>
			</div>

			<MorePopover
				supportsHudCaptureProtection={supportsHudCaptureProtection}
				hideHudFromCapture={hideHudFromCapture}
				onToggleHudCaptureProtection={() => {
					void toggleHudCaptureProtection();
				}}
				onChooseRecordingsDirectory={() => {
					void chooseRecordingsDirectory();
				}}
				onOpenVideoFile={() => {
					void openVideoFile();
				}}
				onOpenProjectBrowser={() => {
					refreshProjectLibrary().then(() => {
						requestOpen("projects");
					});
				}}
				showDevUpdatePreview={SHOW_DEV_UPDATE_PREVIEW}
				onPreviewUpdateUi={() => {
					if (openId) requestClose(openId);
					void window.electronAPI.previewUpdateToast().catch((error) => {
						console.warn("Failed to preview update toast:", error);
					});
				}}
				appVersion={appVersion}
				trigger={
					<Button variant="ghost" size="icon" iconSize="lg" title={t("recording.more")}>
						<DotsThreeVerticalIcon size={18} />
					</Button>
				}
			/>

			<Button
				variant="ghost"
				size="icon"
				iconSize="lg"
				onClick={() => window.electronAPI?.hudOverlayHide?.()}
				title={t("recording.hideHud")}
			>
				<MinusIcon size={16} />
			</Button>

			<Button
				variant="ghost"
				size="icon"
				iconSize="lg"
				onClick={() => window.electronAPI?.hudOverlayClose?.()}
				title={t("recording.closeApp")}
			>
				<XIcon size={16} />
			</Button>
		</>
	);

	const finalizingControls = (
		<div className={styles.finalizingState}>
			<ArrowClockwiseIcon size={15} className={styles.finalizingSpin} />
			<div className={styles.finalizingCopy}>
				<span>{t("recording.preparing", "Preparing recording")}</span>
				<small>{t("recording.preparingSubtitle", "Opening the editor in a moment")}</small>
			</div>
		</div>
	);

	const hudMode = finalizing ? "finalizing" : recording ? "recording" : "idle";
	const useNativeHudBarDrag =
		platform === "linux" || hudOverlayMousePassthroughSupported === false;

	return (
		<HudInteractionContext.Provider
			value={{ onMouseEnter: handleHudMouseEnter, onMouseLeave: handleHudMouseLeave }}
		>
			<div
				className="w-full flex justify-center bg-transparent overflow-visible items-end pb-5 pointer-events-none"
				style={{ height: "100vh" }}
			>
				<div
					ref={hudContentRef}
					className="flex items-center overflow-visible flex-col-reverse pointer-events-none"
				>
					<div
						className="flex flex-col items-center pointer-events-auto p-2"
						onMouseEnter={handleHudMouseEnter}
						onMouseLeave={handleHudMouseLeave}
					>
						<div
							ref={hudBarTransformRef}
							style={{
								transform: `translate3d(${recordingHudOffset.x}px, ${recordingHudOffset.y}px, 0)`,
							}}
						>
							<motion.div
								ref={hudBarRef}
								layout={!showRecordingWebcamPreview && !isHudDragging}
								transition={hudStateTransition}
								className={`${styles.bar} launch-theme mb-2`}
							>
								<div
									// Linux compositors and non-passthrough Windows fallback windows
									// need native window dragging; the JS drag path only translates
									// content inside the HUD window.
									className={`flex items-center px-0.5 cursor-grab active:cursor-grabbing ${
										useNativeHudBarDrag ? styles.electronDrag : ""
									}`}
									onPointerDown={handleHudBarPointerDown}
									onPointerMove={handleHudBarPointerMove}
									onPointerUp={handleHudBarPointerUp}
									onPointerCancel={handleHudBarPointerUp}
								>
									<RxDragHandleDots2 size={14} className="text-[#6b6b78]" />
								</div>

								<div className={styles.barStateViewport}>
									<AnimatePresence initial={false} mode="wait">
										<motion.div
											key={hudMode}
											layout={!showRecordingWebcamPreview && !isHudDragging}
											className={styles.barState}
											initial={{
												opacity: 0,
												y: 10,
												scale: 0.985,
												filter: "blur(8px)",
											}}
											animate={{
												opacity: 1,
												y: 0,
												scale: 1,
												filter: "blur(0px)",
											}}
											exit={{
												opacity: 0,
												y: -10,
												scale: 0.985,
												filter: "blur(6px)",
											}}
											transition={hudStateTransition}
										>
											{finalizing
												? finalizingControls
												: recording
													? recordingControls
													: idleControls}
										</motion.div>
									</AnimatePresence>
								</div>
							</motion.div>
						</div>
						{showRecordingWebcamPreview && (
							<div
								ref={recordingWebcamPreviewContainerRef}
								className={`${styles.recordingWebcamPreview} ${styles.electronNoDrag} pointer-events-auto`}
								data-hud-interactive
								title={t("recording.webcam")}
								style={{
									transform: `translate(${webcamPreviewOffset.x}px, ${webcamPreviewOffset.y}px)`,
								}}
								onMouseEnter={handleHudMouseEnter}
								onMouseLeave={handleHudMouseLeave}
								onPointerDown={handleWebcamPreviewPointerDown}
								onPointerMove={handleWebcamPreviewPointerMove}
								onPointerUp={handleWebcamPreviewPointerUp}
								onPointerCancel={handleWebcamPreviewPointerUp}
							>
								<video
									ref={setRecordingWebcamPreviewNode}
									className={styles.recordingWebcamPreviewVideo}
									muted
									playsInline
									style={{
										transform:
											webcamSource === "local" ? "scaleX(-1)" : undefined,
									}}
								/>
							</div>
						)}
					</div>
				</div>
			</div>
		</HudInteractionContext.Provider>
	);
}
