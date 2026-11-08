import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { loadEditorPreferences } from "../../video-editor/editorPreferences";
import { canShowFloatingWebcamPreview } from "../floatingWebcamPreview";
import { useWebcamPreviewGeometry } from "./useWebcamPreviewGeometry";
import { useWebcamPreviewPointer } from "./useWebcamPreviewPointer";

export function useWebcamPreviewOverlay({
	webcamEnabled,
	webcamDeviceId,
	showWebcamControls,
	webcamPopoverOpen,
	hudOverlayMousePassthroughSupported,
	hudBarRef,
}: {
	webcamEnabled: boolean;
	webcamDeviceId?: string;
	showWebcamControls: boolean;
	webcamPopoverOpen: boolean;
	hudOverlayMousePassthroughSupported: boolean | null;
	hudBarRef: RefObject<HTMLDivElement | null>;
}) {
	const [editorMode, setEditorMode] = useState(true);
	useEffect(() => {
		let active = true;
		let receivedEvent = false;
		const unsubscribe = window.electronAPI.onEditorModeChanged((inEditor) => {
			receivedEvent = true;
			if (active) setEditorMode(inEditor);
		});
		void window.electronAPI
			.getEditorMode()
			.then((inEditor) => {
				if (active && !receivedEvent) setEditorMode(inEditor);
			})
			.catch(() => {
				/* Keep the camera off if editor mode is unknown. */
			});
		return () => {
			active = false;
			unsubscribe();
		};
	}, []);
	const [webcamPreviewSettings, setWebcamPreviewSettings] = useState(
		() => loadEditorPreferences().webcam,
	);
	const webcamPreviewRoundness = webcamPreviewSettings.roundness;
	const webcamPreviewShape = webcamPreviewSettings.shape;
	// biome-ignore lint/correctness/useExhaustiveDependencies: Refresh saved camera settings when editor mode or webcam availability changes.
	useEffect(() => {
		setWebcamPreviewSettings(loadEditorPreferences().webcam);
	}, [editorMode, webcamEnabled]);
	const [showFloatingWebcamPreview, setShowFloatingWebcamPreview] = useState(true);
	const webcamPreviewRef = useRef<HTMLVideoElement | null>(null);
	const recordingWebcamPreviewRef = useRef<HTMLVideoElement | null>(null);
	const previewStreamRef = useRef<MediaStream | null>(null);
	const showRecordingWebcamPreview =
		webcamEnabled &&
		canShowFloatingWebcamPreview(
			showFloatingWebcamPreview,
			hudOverlayMousePassthroughSupported,
		);
	const shouldStreamWebcamPreview =
		!editorMode &&
		webcamEnabled &&
		(showRecordingWebcamPreview || (showWebcamControls && webcamPopoverOpen));
	const geometry = useWebcamPreviewGeometry({ hudBarRef, showRecordingWebcamPreview });
	const pointer = useWebcamPreviewPointer({
		webcamEnabled,
		showRecordingWebcamPreview,
		setShowFloatingWebcamPreview,
		geometry,
	});

	const attachPreviewStreamToNode = useCallback((videoElement: HTMLVideoElement | null) => {
		const previewStream = previewStreamRef.current;
		if (!videoElement || !previewStream || videoElement.srcObject === previewStream) {
			return;
		}

		videoElement.srcObject = previewStream;
		const playPromise = videoElement.play();
		if (playPromise) {
			playPromise.catch(() => {
				// Ignore autoplay interruptions while the preview element mounts.
			});
		}
	}, []);

	const setWebcamPreviewNode = useCallback(
		(node: HTMLVideoElement | null) => {
			webcamPreviewRef.current = node;
			attachPreviewStreamToNode(node);
		},
		[attachPreviewStreamToNode],
	);

	const setRecordingWebcamPreviewNode = useCallback(
		(node: HTMLVideoElement | null) => {
			recordingWebcamPreviewRef.current = node;
			attachPreviewStreamToNode(node);
		},
		[attachPreviewStreamToNode],
	);

	useEffect(() => {
		let mounted = true;

		const startPreview = async () => {
			if (!shouldStreamWebcamPreview) {
				return;
			}

			try {
				const previewStream = await navigator.mediaDevices.getUserMedia({
					video: webcamDeviceId
						? {
								deviceId: { exact: webcamDeviceId },
								width: { ideal: 320 },
								height: { ideal: 320 },
								frameRate: { ideal: 24, max: 30 },
							}
						: {
								width: { ideal: 320 },
								height: { ideal: 320 },
								frameRate: { ideal: 24, max: 30 },
							},
					audio: false,
				});

				if (!mounted) {
					previewStream.getTracks().forEach((track) => track.stop());
					return;
				}

				previewStreamRef.current = previewStream;
				attachPreviewStreamToNode(webcamPreviewRef.current);
				attachPreviewStreamToNode(recordingWebcamPreviewRef.current);
			} catch (error) {
				console.warn("Failed to start live webcam preview:", error);
			}
		};

		void startPreview();

		return () => {
			mounted = false;
			const previewNode = webcamPreviewRef.current;
			const recordingPreviewNode = recordingWebcamPreviewRef.current;
			const previewStream = previewStreamRef.current;

			[previewNode, recordingPreviewNode]
				.filter((node): node is HTMLVideoElement => Boolean(node))
				.forEach((videoElement) => {
					videoElement.pause();
					videoElement.srcObject = null;
				});
			previewStream?.getTracks().forEach((track) => track.stop());
			if (previewStreamRef.current === previewStream) {
				previewStreamRef.current = null;
			}
		};
	}, [attachPreviewStreamToNode, shouldStreamWebcamPreview, webcamDeviceId]);

	return {
		webcamPreviewRoundness,
		webcamPreviewShape,
		showFloatingWebcamPreview,
		setShowFloatingWebcamPreview,
		webcamPreviewOffset: geometry.webcamPreviewOffset,
		recordingWebcamPreviewContainerRef: geometry.recordingWebcamPreviewContainerRef,
		...pointer,
		setWebcamPreviewNode,
		setRecordingWebcamPreviewNode,
		showRecordingWebcamPreview,
	};
}
