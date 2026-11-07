import { Spinner } from "@heroui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	House,
	MicrophoneIcon,
	MicrophoneSlashIcon,
	MinusIcon,
	MonitorIcon,
	VideoCameraIcon,
	VideoCameraSlashIcon,
} from "@/components/ui/icons";
import { toast } from "@/components/ui/toast";
import { useScopedT } from "../../contexts/I18nContext";
import { useMicrophoneDevices } from "../../hooks/useMicrophoneDevices";
import { useScreenRecorder } from "../../hooks/useScreenRecorder";
import { useVideoDevices } from "../../hooks/useVideoDevices";
import { Button } from "../ui/button";
import { CountdownDelayIcon } from "./CountdownDelayIcon";
import { HudInteractionContext } from "./contexts/HudInteractionContext";
import { FloatingWebcamPreviewView } from "./FloatingWebcamPreviewView";
import { canToggleFloatingWebcamPreview } from "./floatingWebcamPreview";
import { useHudBarDrag } from "./hooks/useHudBarDrag";
import { useHudStateTransition } from "./hooks/useHudStateTransition";
import { useLaunchHudInteractionState } from "./hooks/useLaunchHudInteractionState";
import { useLaunchWindowActions } from "./hooks/useLaunchWindowActions";
import { useLaunchWindowSystemState } from "./hooks/useLaunchWindowSystemState";
import { useRecordingTimer } from "./hooks/useRecordingTimer";
import { useWebcamPreviewOverlay } from "./hooks/useWebcamPreviewOverlay";
import styles from "./LaunchWindow.module.css";
import { MarqueeText } from "./MarqueeText";
import { CountdownPopover } from "./popovers/CountdownPopover";
import {
	LaunchPopoverCoordinatorProvider,
	useLaunchPopoverCoordinator,
} from "./popovers/LaunchPopoverCoordinator";
import { MicPopover } from "./popovers/MicPopover";
import { WebcamPopover } from "./popovers/WebcamPopover";
import { RecordingControls } from "./RecordingControls";

export function LaunchWindow() {
	return (
		<LaunchPopoverCoordinatorProvider>
			<LaunchWindowContent />
		</LaunchPopoverCoordinatorProvider>
	);
}

function LaunchWindowContent() {
	const t = useScopedT("launch");
	const captureT = useScopedT("capture");
	const { openId } = useLaunchPopoverCoordinator();

	const {
		recording,
		paused,
		finalizing,
		restarting,
		countdownActive,
		toggleRecording,
		pauseRecording,
		resumeRecording,
		cancelRecording,
		cancelRecordingStart,
		microphoneEnabled,
		setMicrophoneEnabled,
		microphoneDeviceId,
		setMicrophoneDeviceId,
		systemAudioEnabled,
		setSystemAudioEnabled,
		webcamEnabled,
		setWebcamEnabled,
		webcamDeviceId,
		setWebcamDeviceId,
		countdownDelay,
		setCountdownDelay,
		preparePermissions,
	} = useScreenRecorder();

	const { elapsed, formatTime } = useRecordingTimer(recording, paused);
	const hudContentRef = useRef<HTMLDivElement>(null);
	const hudBarRef = useRef<HTMLDivElement>(null);

	const { selectedSource, hasSelectedSource, syncSelectedSource } = useLaunchWindowActions();

	const showWebcamControls = webcamEnabled && !recording;
	const { devices, selectedDeviceId, setSelectedDeviceId } = useMicrophoneDevices(
		microphoneEnabled || openId === "mic",
		microphoneDeviceId,
	);
	const {
		devices: videoDevices,
		selectedDeviceId: selectedVideoDeviceId,
		setSelectedDeviceId: setSelectedVideoDeviceId,
	} = useVideoDevices(webcamEnabled || openId === "webcam", webcamDeviceId);

	const { hudOverlayMousePassthroughSupported, platform } =
		useLaunchWindowSystemState(preparePermissions);

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

	const webcamPreview = useWebcamPreviewOverlay({
		webcamEnabled,
		webcamDeviceId,
		showWebcamControls,
		webcamPopoverOpen: openId === "webcam",
		hudOverlayMousePassthroughSupported,
		hudBarRef,
	});
	const {
		webcamPreviewRoundness,
		webcamPreviewShape,
		showFloatingWebcamPreview,
		setShowFloatingWebcamPreview,
		showRecordingWebcamPreview,
		recordingWebcamPreviewContainerRef,
		isWebcamPreviewDraggingRef,
		webcamPreviewDragStartRef,
		setWebcamPreviewNode,
	} = webcamPreview;

	useEffect(() => {
		window.electronAPI?.hudOverlaySetWebcamPreviewVisible?.(showRecordingWebcamPreview);
	}, [showRecordingWebcamPreview]);

	useEffect(() => {
		return () => {
			window.electronAPI?.hudOverlaySetWebcamPreviewVisible?.(false);
		};
	}, []);

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
		docked: showRecordingWebcamPreview,
	});

	const { handleHudMouseEnter, handleHudMouseLeave, beginInteractiveHudAction } =
		useLaunchHudInteractionState({
			openId,
			isHudDraggingRef,
			isWebcamPreviewDraggingRef,
			webcamPreviewDragStartRef,
		});

	const pickerPending = useRef(false);
	const [isPickerPending, setIsPickerPending] = useState(false);
	const [sourceReady, setSourceReady] = useState(false);
	const handlePickOnScreen = useCallback(async () => {
		if (pickerPending.current || recording || finalizing) return;
		pickerPending.current = true;
		setIsPickerPending(true);
		beginInteractiveHudAction();
		try {
			if (!(await cancelRecordingStart())) return;
			if (!(await preparePermissions())) return;
			const result = await window.electronAPI.pickCaptureTarget();
			if (result.success && result.source) syncSelectedSource(result.source);
			if (result.message && !result.canceled) {
				if (result.success) toast.info(result.message);
				else toast.error(result.message);
			}
		} catch {
			toast.error(captureT("pickerError"));
		} finally {
			pickerPending.current = false;
			setIsPickerPending(false);
		}
	}, [
		captureT,
		recording,
		cancelRecordingStart,
		preparePermissions,
		finalizing,
		beginInteractiveHudAction,
		syncSelectedSource,
	]);

	useEffect(() => {
		let mounted = true;
		let selectionEventSeen = false;

		void window.electronAPI
			.getSelectedSource()
			.then((source) => {
				if (mounted) setSourceReady(true);
				if (mounted && !selectionEventSeen) {
					syncSelectedSource(source);
				}
			})
			.catch(() => {
				if (mounted) {
					setSourceReady(true);
					toast.error(captureT("sourceLoadError"));
				}
			});

		const cleanup = window.electronAPI.onSelectedSourceChanged((source) => {
			selectionEventSeen = true;
			if (mounted) syncSelectedSource(source);
		});

		return () => {
			mounted = false;
			cleanup?.();
		};
	}, [syncSelectedSource, captureT]);

	const openHome = () => {
		localStorage.setItem("recordly.open-dashboard", String(Date.now()));
		void window.electronAPI.showProjectDashboard();
	};
	const homeButton = (
		<Button
			variant="ghost"
			size="icon"
			iconSize="lg"
			aria-label={t("recording.home")}
			title={t("recording.home")}
			onClick={openHome}
		>
			<House weight="fill" className="size-5" />
		</Button>
	);

	const recordingControls = (
		<RecordingControls
			busy={restarting}
			paused={paused}
			elapsed={elapsed}
			onPauseResume={paused ? resumeRecording : pauseRecording}
			onStopRecording={toggleRecording}
			onHideHud={() => window.electronAPI?.hudOverlayHide?.()}
			onCancelRecording={cancelRecording}
			formatTime={formatTime}
		/>
	);

	const idleControls = (
		<div
			role="group"
			aria-label={captureT("recordingSetup")}
			className={styles.recordingControls}
		>
			<Button
				type="button"
				variant="destructive"
				size="icon"
				className={`${styles.electronNoDrag} ${styles.recordControl}`}
				onClick={hasSelectedSource ? toggleRecording : () => void handlePickOnScreen()}
				disabled={countdownActive || isPickerPending || !sourceReady}
				title={t("recording.record")}
			>
				<div className={styles.recDot} />
			</Button>
			<Button
				variant="ghost"
				size="lg"
				className={`${styles.electronNoDrag} ${styles.sourceControl} group gap-2`}
				title={selectedSource}
				aria-label={captureT("chooseSource")}
				disabled={isPickerPending || !sourceReady || recording || finalizing}
				onClick={() => void handlePickOnScreen()}
			>
				<MonitorIcon size={18} className="size-5 shrink-0" />
				<div className="min-w-0 overflow-hidden">
					{hasSelectedSource ? (
						<MarqueeText text={selectedSource} />
					) : (
						<span>{captureT("pickSource")}</span>
					)}
				</div>
			</Button>
			<span aria-hidden="true" className={styles.sourceDivider} />
			<MicPopover
				disabled={recording}
				systemAudioEnabled={systemAudioEnabled}
				onToggleSystemAudio={() => setSystemAudioEnabled(!systemAudioEnabled)}
				microphoneEnabled={microphoneEnabled}
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
						title={
							microphoneEnabled
								? t("recording.disableMicrophone")
								: t("recording.enableMicrophone")
						}
						className={microphoneEnabled ? "text-accent" : ""}
					>
						{microphoneEnabled ? (
							<MicrophoneIcon
								weight={microphoneEnabled ? "fill" : "regular"}
								className="size-5"
								size={18}
							/>
						) : (
							<MicrophoneSlashIcon className="size-5" />
						)}
					</Button>
				}
			/>

			<WebcamPopover
				disabled={recording}
				webcamEnabled={webcamEnabled}
				onDisableWebcam={() => setWebcamEnabled(false)}
				canToggleFloatingPreview={canToggleFloatingWebcamPreview(
					hudOverlayMousePassthroughSupported,
				)}
				showFloatingWebcamPreview={showFloatingWebcamPreview}
				onToggleFloatingPreview={() => setShowFloatingWebcamPreview((current) => !current)}
				showWebcamControls={showWebcamControls && !showRecordingWebcamPreview}
				roundness={webcamPreviewRoundness}
				shape={webcamPreviewShape}
				setWebcamPreviewNode={setWebcamPreviewNode}
				videoDevices={videoDevices}
				webcamDeviceId={webcamDeviceId}
				selectedVideoDeviceId={selectedVideoDeviceId}
				onSelectVideoDevice={(deviceId) => {
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
						className={webcamEnabled ? "text-accent" : ""}
					>
						{webcamEnabled ? (
							<VideoCameraIcon
								weight={webcamEnabled ? "fill" : "regular"}
								className="size-5"
								size={18}
							/>
						) : (
							<VideoCameraSlashIcon className="size-5" />
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
						title={`${t("recording.countdownDelay")}: ${countdownDelay === 0 ? t("recording.noDelay") : `${countdownDelay}s`}`}
						className={countdownDelay > 0 ? "text-accent" : ""}
					>
						<CountdownDelayIcon seconds={countdownDelay} className="size-5" />
					</Button>
				}
			/>

			{homeButton}
			<Button
				variant="ghost"
				size="icon"
				iconSize="lg"
				onClick={() => window.electronAPI?.hudOverlayHide?.()}
				title={t("recording.hideHud")}
			>
				<MinusIcon className="size-5" />
			</Button>
		</div>
	);

	const useNativeHudBarDrag =
		platform === "linux" || hudOverlayMousePassthroughSupported === false;
	const finishHudTransition = useHudStateTransition(
		hudBarRef,
		finalizing && !restarting ? "finalizing" : recording || restarting ? "recording" : "idle",
		showRecordingWebcamPreview,
	);

	const hudBar = (
		<div
			ref={hudBarTransformRef}
			className={showRecordingWebcamPreview ? styles.webcamHudDock : undefined}
			style={{
				transform: showRecordingWebcamPreview
					? undefined
					: `translate3d(${recordingHudOffset.x}px, ${recordingHudOffset.y}px, 0)`,
			}}
		>
			<div
				ref={hudBarRef}
				onPointerDownCapture={finishHudTransition}
				data-hud-dragging={isHudDragging}
				className={`${styles.bar} ${styles.recordingBar} ${useNativeHudBarDrag ? styles.electronDrag : ""} launch-theme pointer-events-auto`}
				data-recording-state={
					finalizing
						? "finalizing"
						: recording
							? paused
								? "paused"
								: "recording"
							: "idle"
				}
				onPointerDown={
					showRecordingWebcamPreview || useNativeHudBarDrag
						? undefined
						: handleHudBarPointerDown
				}
				onPointerMove={showRecordingWebcamPreview ? undefined : handleHudBarPointerMove}
				onPointerUp={showRecordingWebcamPreview ? undefined : handleHudBarPointerUp}
				onPointerCancel={showRecordingWebcamPreview ? undefined : handleHudBarPointerUp}
				onLostPointerCapture={
					showRecordingWebcamPreview ? undefined : handleHudBarPointerUp
				}
				onMouseEnter={handleHudMouseEnter}
				onMouseLeave={handleHudMouseLeave}
			>
				<div className={styles.barStateViewport}>
					<div className={styles.barState}>
						{finalizing && !restarting ? (
							<div
								role="status"
								className={`${styles.recordingControls} ${styles.recordingFinalizing} gap-2 text-sm text-muted-foreground`}
							>
								<Spinner size="sm" />
								{captureT("finishingRecording", "Finishing recording…")}
							</div>
						) : recording || restarting ? (
							recordingControls
						) : (
							idleControls
						)}
					</div>
				</div>
			</div>
		</div>
	);

	return (
		<HudInteractionContext.Provider
			value={{ onMouseEnter: handleHudMouseEnter, onMouseLeave: handleHudMouseLeave }}
		>
			<div
				className="w-full flex justify-center bg-transparent overflow-visible items-end pb-6 pointer-events-none"
				style={{ height: "100vh" }}
			>
				<div
					ref={hudContentRef}
					className="flex items-center overflow-visible flex-col-reverse pointer-events-none"
				>
					<div className="flex flex-col items-center pointer-events-none p-2">
						{!showRecordingWebcamPreview && hudBar}
						{showRecordingWebcamPreview && (
							<FloatingWebcamPreviewView
								preview={webcamPreview}
								hudBar={hudBar}
								finishHudTransition={finishHudTransition}
								handleHudMouseEnter={handleHudMouseEnter}
								handleHudMouseLeave={handleHudMouseLeave}
								title={t("recording.webcam")}
							/>
						)}
					</div>
				</div>
			</div>
		</HudInteractionContext.Provider>
	);
}
