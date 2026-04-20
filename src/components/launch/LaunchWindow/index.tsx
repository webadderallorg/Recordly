import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { RxDragHandleDots2 } from "react-icons/rx";
import { useScopedT } from "@/contexts/I18nContext";
import { useMicrophoneDevices } from "@/hooks/useMicrophoneDevices";
import { useScreenRecorder } from "@/hooks/useScreenRecorder";
import { useVideoDevices } from "@/hooks/useVideoDevices";
import ProjectBrowserDialog, {
	type ProjectLibraryEntry,
} from "@/components/video-editor/ProjectBrowserDialog";
import { DropdownContent } from "./DropdownContent";
import { useDragHandlers, useRecordingTimer, useWebcamPreview } from "./hooks";
import { IdleControls, RecordingControls, UpdateBadge } from "./HudControls";
import type { DesktopSource } from "./types";
import { useLaunchWindowActions } from "./useLaunchWindowActions";
import { useLaunchWindowSetup } from "./useLaunchWindowSetup";
import styles from "./LaunchWindow.module.css";

export function LaunchWindow() {
	const t = useScopedT("launch");

	const {
		recording,
		paused,
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
		webcamDeviceId,
		setWebcamDeviceId,
		countdownDelay,
		setCountdownDelay,
		preparePermissions,
	} = useScreenRecorder();

	const [activeDropdown, setActiveDropdown] = useState<
		"none" | "sources" | "more" | "mic" | "countdown" | "webcam"
	>("none");
	const [projectBrowserOpen, setProjectBrowserOpen] = useState(false);
	const [projectLibraryEntries, setProjectLibraryEntries] = useState<ProjectLibraryEntry[]>([]);
	const [sources, setSources] = useState<DesktopSource[]>([]);
	const [sourcesLoading, setSourcesLoading] = useState(false);
	const [showFloatingWebcamPreview, setShowFloatingWebcamPreview] = useState(true);
	const [, setRecordingsDirectory] = useState<string | null>(null);

	const dropdownRef = useRef<HTMLDivElement>(null);
	const hudContentRef = useRef<HTMLDivElement>(null);
	const hudBarRef = useRef<HTMLDivElement>(null);
	const moreButtonRef = useRef<HTMLButtonElement | null>(null);
	const recordingWebcamPreviewContainerRef = useRef<HTMLDivElement | null>(null);

	const micDropdownOpen = activeDropdown === "mic";
	const webcamDropdownOpen = activeDropdown === "webcam";
	const showWebcamControls = webcamEnabled && !recording;
	const showRecordingWebcamPreview = webcamEnabled && showFloatingWebcamPreview;
	const shouldStreamWebcamPreview =
		webcamEnabled && (showFloatingWebcamPreview || (showWebcamControls && webcamDropdownOpen));

	const { devices, selectedDeviceId, setSelectedDeviceId } = useMicrophoneDevices(
		microphoneEnabled || micDropdownOpen,
		microphoneDeviceId,
	);
	const {
		devices: videoDevices,
		selectedDeviceId: selectedVideoDeviceId,
		setSelectedDeviceId: setSelectedVideoDeviceId,
	} = useVideoDevices(webcamEnabled || webcamDropdownOpen);

	const {
		webcamPreviewOffset,
		recordingHudOffset,
		isHudDraggingRef,
		isWebcamPreviewDraggingRef,
		webcamPreviewDragStartRef,
		handleWebcamPreviewPointerDown,
		handleWebcamPreviewPointerMove,
		handleWebcamPreviewPointerUp,
		handleHudBarPointerDown,
		handleHudBarPointerMove,
		handleHudBarPointerUp,
	} = useDragHandlers({ webcamEnabled, showRecordingWebcamPreview, hudBarRef });

	const { setWebcamPreviewNode, setRecordingWebcamPreviewNode } = useWebcamPreview({
		shouldStreamWebcamPreview,
		webcamDeviceId,
	});

	const { elapsed, formatTime } = useRecordingTimer({ recording, paused });

	const {
		selectedSource,
		setSelectedSource,
		hasSelectedSource,
		setHasSelectedSource,
		platform,
		appVersion,
		updateStatus,
		updateActionPending,
		hideHudFromCapture,
		setHideHudFromCapture,
		handleUpdateButtonClick,
	} = useLaunchWindowSetup({
		preparePermissions,
		activeDropdown,
		projectBrowserOpen,
		showRecordingWebcamPreview,
		hudContentRef,
		hudBarRef,
		recordingWebcamPreviewContainerRef,
	});

	const supportsHudCaptureProtection = platform !== "linux";

	useEffect(() => {
		if (!selectedDeviceId) return;
		setMicrophoneDeviceId(selectedDeviceId === "default" ? undefined : selectedDeviceId);
	}, [selectedDeviceId, setMicrophoneDeviceId]);

	useEffect(() => {
		if (selectedVideoDeviceId && selectedVideoDeviceId !== "default") {
			setWebcamDeviceId(selectedVideoDeviceId);
		}
	}, [selectedVideoDeviceId, setWebcamDeviceId]);

	useEffect(() => {
		if (!webcamEnabled) setShowFloatingWebcamPreview(true);
	}, [webcamEnabled]);

	// Click outside dropdown
	useEffect(() => {
		const handleClick = (e: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
				setActiveDropdown("none");
				setProjectBrowserOpen(false);
			}
		};
		document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, []);

	// Recordings directory
	useEffect(() => {
		const load = async () => {
			const result = await window.electronAPI.getRecordingsDirectory();
			if (result.success) setRecordingsDirectory(result.path);
		};
		void load();
	}, []);

	const {
		toggleDropdown,
		handleSourceSelect,
		openVideoFile,
		openProjectBrowser,
		openProjectFromLibrary,
		chooseRecordingsDirectory,
		toggleHudCaptureProtection,
		toggleMicrophone,
		toggleWebcam,
	} = useLaunchWindowActions({
		activeDropdown,
		projectBrowserOpen,
		recording,
		hideHudFromCapture,
		setActiveDropdown,
		setSelectedSource,
		setHasSelectedSource,
		setSources,
		setSourcesLoading,
		setProjectLibraryEntries,
		setProjectBrowserOpen,
		setRecordingsDirectory,
		setHideHudFromCapture,
		fetchSourcesOnOpen: true,
	});

	const screenSources = sources.filter((s) => s.sourceType === "screen");
	const windowSources = sources.filter((s) => s.sourceType === "window");
	const hudStateTransition = { duration: 0.24, ease: [0.22, 1, 0.36, 1] as const };

	return (
		<div
			className="w-full flex items-end justify-center bg-transparent overflow-visible pb-5"
			style={{ height: "100vh" }}
		>
			<div
				ref={hudContentRef}
				className="flex flex-col items-center overflow-visible"
				onMouseEnter={() => window.electronAPI?.hudOverlaySetIgnoreMouse?.(false)}
				onMouseLeave={() => {
					if (
						!isHudDraggingRef.current &&
						!isWebcamPreviewDraggingRef.current &&
						!webcamPreviewDragStartRef.current
					) {
						window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
					}
				}}
			>
				<div
					className={styles.menuArea}
					ref={dropdownRef}
					style={{
						transform: `translate(${recordingHudOffset.x}px, ${recordingHudOffset.y}px)`,
					}}
				>
					{projectBrowserOpen ? (
						<div className={styles.electronNoDrag}>
							<ProjectBrowserDialog
								open={projectBrowserOpen}
								onOpenChange={setProjectBrowserOpen}
								entries={projectLibraryEntries}
								renderMode="inline"
								onOpenProject={(projectPath) => {
									void openProjectFromLibrary(projectPath);
								}}
							/>
						</div>
					) : null}
					{activeDropdown !== "none" && (
						<DropdownContent
							activeDropdown={activeDropdown}
							setActiveDropdown={setActiveDropdown}
							sourcesLoading={sourcesLoading}
							screenSources={screenSources}
							windowSources={windowSources}
							selectedSource={selectedSource}
							onSourceSelect={handleSourceSelect}
							systemAudioEnabled={systemAudioEnabled}
							setSystemAudioEnabled={setSystemAudioEnabled}
							microphoneEnabled={microphoneEnabled}
							setMicrophoneEnabled={setMicrophoneEnabled}
							microphoneDeviceId={microphoneDeviceId}
							selectedDeviceId={selectedDeviceId}
							setSelectedDeviceId={setSelectedDeviceId}
							setMicrophoneDeviceId={setMicrophoneDeviceId}
							devices={devices}
							webcamEnabled={webcamEnabled}
							setWebcamEnabled={setWebcamEnabled}
							webcamDeviceId={webcamDeviceId}
							selectedVideoDeviceId={selectedVideoDeviceId}
							setSelectedVideoDeviceId={setSelectedVideoDeviceId}
							setWebcamDeviceId={setWebcamDeviceId}
							videoDevices={videoDevices}
							showWebcamControls={showWebcamControls}
							showFloatingWebcamPreview={showFloatingWebcamPreview}
							setShowFloatingWebcamPreview={setShowFloatingWebcamPreview}
							setWebcamPreviewNode={setWebcamPreviewNode}
							countdownDelay={countdownDelay}
							setCountdownDelay={setCountdownDelay}
							supportsHudCaptureProtection={supportsHudCaptureProtection}
							hideHudFromCapture={hideHudFromCapture}
							onToggleHudCaptureProtection={toggleHudCaptureProtection}
							onChooseRecordingsDirectory={chooseRecordingsDirectory}
							onOpenVideoFile={openVideoFile}
							onOpenProjectBrowser={openProjectBrowser}
							appVersion={appVersion}
						/>
					)}
				</div>

				<div className="flex flex-col items-center pointer-events-auto">
					<div
						style={{
							transform: `translate(${recordingHudOffset.x}px, ${recordingHudOffset.y}px)`,
						}}
					>
						<motion.div
							ref={hudBarRef}
							layout={!showRecordingWebcamPreview}
							transition={hudStateTransition}
							className={`${styles.bar} mb-2`}
						>
							<div
								className="flex items-center px-0.5 cursor-grab active:cursor-grabbing"
								onPointerDown={handleHudBarPointerDown}
								onPointerMove={handleHudBarPointerMove}
								onPointerUp={handleHudBarPointerUp}
								onPointerCancel={handleHudBarPointerUp}
							>
								<RxDragHandleDots2 size={14} className="text-[#6b6b78]" />
							</div>

							<UpdateBadge
								updateStatus={updateStatus}
								updateActionPending={updateActionPending}
								onUpdateClick={() => {
									void handleUpdateButtonClick();
								}}
							/>

							<div className={styles.barStateViewport}>
								<AnimatePresence initial={false} mode="wait">
									<motion.div
										key={recording ? "recording" : "idle"}
										layout={!showRecordingWebcamPreview}
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
										{recording ? (
											<RecordingControls
												paused={paused}
												elapsed={elapsed}
												formatTime={formatTime}
												microphoneEnabled={microphoneEnabled}
												resumeRecording={resumeRecording}
												pauseRecording={pauseRecording}
												toggleRecording={toggleRecording}
												cancelRecording={cancelRecording}
											/>
										) : (
											<IdleControls
												selectedSource={selectedSource}
												activeDropdown={activeDropdown}
												toggleDropdown={toggleDropdown}
												hasSelectedSource={hasSelectedSource}
												toggleRecording={toggleRecording}
												microphoneEnabled={microphoneEnabled}
												toggleMicrophone={toggleMicrophone}
												webcamEnabled={webcamEnabled}
												toggleWebcam={toggleWebcam}
												countdownDelay={countdownDelay}
												countdownActive={countdownActive}
												moreButtonRef={moreButtonRef}
											/>
										)}
									</motion.div>
								</AnimatePresence>
							</div>
						</motion.div>
					</div>
					{showRecordingWebcamPreview && (
						<div
							ref={recordingWebcamPreviewContainerRef}
							className={`${styles.recordingWebcamPreview} ${styles.electronNoDrag}`}
							title={t("recording.webcam")}
							style={{
								transform: `translate(${webcamPreviewOffset.x}px, ${webcamPreviewOffset.y}px)`,
							}}
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
								style={{ transform: "scaleX(-1)" }}
							/>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
