import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { canShowFloatingWebcamPreview } from "../floatingWebcamPreview";

const WEBCAM_PREVIEW_DRAG_THRESHOLD = 6;
const DEFAULT_WEBCAM_PREVIEW_OFFSET = { x: 0, y: 0 };

export function useWebcamPreviewOverlay({
	webcamEnabled,
	webcamDeviceId,
	showWebcamControls,
	webcamPopoverOpen,
	hudOverlayMousePassthroughSupported,
}: {
	webcamEnabled: boolean;
	webcamDeviceId?: string;
	showWebcamControls: boolean;
	webcamPopoverOpen: boolean;
	hudOverlayMousePassthroughSupported: boolean | null;
}) {
	const [showFloatingWebcamPreview, setShowFloatingWebcamPreview] = useState(true);
	const [webcamPreviewOffset, setWebcamPreviewOffset] = useState(DEFAULT_WEBCAM_PREVIEW_OFFSET);
	const webcamPreviewRef = useRef<HTMLVideoElement | null>(null);
	const recordingWebcamPreviewRef = useRef<HTMLVideoElement | null>(null);
	const recordingWebcamPreviewContainerRef = useRef<HTMLDivElement | null>(null);
	const previewStreamRef = useRef<MediaStream | null>(null);
	const webcamPreviewDragStartRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		originX: number;
		originY: number;
		initialLeft: number;
		initialTop: number;
		previewWidth: number;
		previewHeight: number;
		dragging: boolean;
	} | null>(null);
	const isWebcamPreviewDraggingRef = useRef(false);
	const showRecordingWebcamPreview =
		webcamEnabled &&
		canShowFloatingWebcamPreview(
			showFloatingWebcamPreview,
			hudOverlayMousePassthroughSupported,
		);
	const shouldStreamWebcamPreview =
		webcamEnabled && (showRecordingWebcamPreview || (showWebcamControls && webcamPopoverOpen));

	useEffect(() => {
		if (!webcamEnabled) {
			setWebcamPreviewOffset(DEFAULT_WEBCAM_PREVIEW_OFFSET);
			webcamPreviewDragStartRef.current = null;
			isWebcamPreviewDraggingRef.current = false;
			setShowFloatingWebcamPreview(true);
		}
	}, [webcamEnabled]);

	const handleWebcamPreviewPointerDown = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			if (event.button !== 0) {
				return;
			}

			const previewRect = event.currentTarget.getBoundingClientRect();

			event.preventDefault();
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
			webcamPreviewDragStartRef.current = {
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				originX: webcamPreviewOffset.x,
				originY: webcamPreviewOffset.y,
				initialLeft: previewRect.left,
				initialTop: previewRect.top,
				previewWidth: previewRect.width,
				previewHeight: previewRect.height,
				dragging: false,
			};
			event.currentTarget.setPointerCapture(event.pointerId);
		},
		[webcamPreviewOffset.x, webcamPreviewOffset.y],
	);

	const handleWebcamPreviewPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
		const dragState = webcamPreviewDragStartRef.current;
		if (!dragState || dragState.pointerId !== event.pointerId) {
			return;
		}

		const deltaX = event.clientX - dragState.startX;
		const deltaY = event.clientY - dragState.startY;

		if (!dragState.dragging && Math.hypot(deltaX, deltaY) < WEBCAM_PREVIEW_DRAG_THRESHOLD) {
			return;
		}

		if (!dragState.dragging) {
			dragState.dragging = true;
			isWebcamPreviewDraggingRef.current = true;
		}

		const viewportWidth = Math.max(window.innerWidth, window.screen?.width ?? 0);
		const viewportHeight = Math.max(window.innerHeight, window.screen?.height ?? 0);
		const unclampedLeft = dragState.initialLeft + deltaX;
		const unclampedTop = dragState.initialTop + deltaY;
		const clampedLeft = Math.min(
			Math.max(0, unclampedLeft),
			Math.max(0, viewportWidth - dragState.previewWidth),
		);
		const clampedTop = Math.min(
			Math.max(0, unclampedTop),
			Math.max(0, viewportHeight - dragState.previewHeight),
		);

		setWebcamPreviewOffset({
			x: dragState.originX + (clampedLeft - dragState.initialLeft),
			y: dragState.originY + (clampedTop - dragState.initialTop),
		});
	}, []);

	const handleWebcamPreviewPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
		const dragState = webcamPreviewDragStartRef.current;
		if (!dragState || dragState.pointerId !== event.pointerId) {
			return;
		}

		const wasDragging = dragState.dragging;
		webcamPreviewDragStartRef.current = null;
		isWebcamPreviewDraggingRef.current = false;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		if (wasDragging) {
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
		}
	}, []);

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
		showFloatingWebcamPreview,
		setShowFloatingWebcamPreview,
		webcamPreviewOffset,
		recordingWebcamPreviewContainerRef,
		isWebcamPreviewDraggingRef,
		webcamPreviewDragStartRef,
		handleWebcamPreviewPointerDown,
		handleWebcamPreviewPointerMove,
		handleWebcamPreviewPointerUp,
		setWebcamPreviewNode,
		setRecordingWebcamPreviewNode,
		showRecordingWebcamPreview,
	};
}
