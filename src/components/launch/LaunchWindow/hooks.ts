import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	DEFAULT_RECORDING_HUD_OFFSET,
	DEFAULT_WEBCAM_PREVIEW_OFFSET,
	WEBCAM_PREVIEW_DRAG_THRESHOLD,
} from "./types";

export function useDragHandlers({
	webcamEnabled,
	showRecordingWebcamPreview,
	hudBarRef,
}: {
	webcamEnabled: boolean;
	showRecordingWebcamPreview: boolean;
	hudBarRef: React.RefObject<HTMLDivElement | null>;
}) {
	const [webcamPreviewOffset, setWebcamPreviewOffset] = useState(DEFAULT_WEBCAM_PREVIEW_OFFSET);
	const [recordingHudOffset, setRecordingHudOffset] = useState(DEFAULT_RECORDING_HUD_OFFSET);

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

	const hudDragStartRef = useRef<
		| {
				pointerId: number;
				mode: "webcam-preview";
				startX: number;
				startY: number;
				originX: number;
				originY: number;
				initialLeft: number;
				initialTop: number;
				hudWidth: number;
				hudHeight: number;
		  }
		| {
				pointerId: number;
				mode: "overlay";
		  }
		| null
	>(null);

	const isHudDraggingRef = useRef(false);
	const isWebcamPreviewDraggingRef = useRef(false);

	useEffect(() => {
		if (!webcamEnabled) {
			setWebcamPreviewOffset(DEFAULT_WEBCAM_PREVIEW_OFFSET);
			setRecordingHudOffset(DEFAULT_RECORDING_HUD_OFFSET);
			webcamPreviewDragStartRef.current = null;
			isWebcamPreviewDraggingRef.current = false;
		}
	}, [webcamEnabled]);

	useEffect(() => {
		if (!showRecordingWebcamPreview) {
			setRecordingHudOffset(DEFAULT_RECORDING_HUD_OFFSET);
		}
	}, [showRecordingWebcamPreview]);

	const handleWebcamPreviewPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
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
	};

	const handleWebcamPreviewPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		const dragState = webcamPreviewDragStartRef.current;
		if (!dragState || dragState.pointerId !== event.pointerId) return;
		const deltaX = event.clientX - dragState.startX;
		const deltaY = event.clientY - dragState.startY;
		if (!dragState.dragging && Math.hypot(deltaX, deltaY) < WEBCAM_PREVIEW_DRAG_THRESHOLD) return;
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
	};

	const handleWebcamPreviewPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
		const dragState = webcamPreviewDragStartRef.current;
		if (!dragState || dragState.pointerId !== event.pointerId) return;
		const wasDragging = dragState.dragging;
		webcamPreviewDragStartRef.current = null;
		isWebcamPreviewDraggingRef.current = false;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		if (wasDragging) {
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
		}
	};

	const handleHudBarPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		isHudDraggingRef.current = true;
		window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);

		if (showRecordingWebcamPreview && hudBarRef.current) {
			const hudRect = hudBarRef.current.getBoundingClientRect();
			hudDragStartRef.current = {
				pointerId: event.pointerId,
				mode: "webcam-preview",
				startX: event.clientX,
				startY: event.clientY,
				originX: recordingHudOffset.x,
				originY: recordingHudOffset.y,
				initialLeft: hudRect.left,
				initialTop: hudRect.top,
				hudWidth: hudRect.width,
				hudHeight: hudRect.height,
			};
			return;
		}

		hudDragStartRef.current = { pointerId: event.pointerId, mode: "overlay" };
		window.electronAPI?.hudOverlayDrag?.("start", event.screenX, event.screenY);
	};

	const handleHudBarPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		const dragState = hudDragStartRef.current;
		if (!dragState || dragState.pointerId !== event.pointerId) return;

		if (dragState.mode === "webcam-preview") {
			const deltaX = event.clientX - dragState.startX;
			const deltaY = event.clientY - dragState.startY;
			const viewportWidth = Math.max(window.innerWidth, window.screen?.width ?? 0);
			const viewportHeight = Math.max(window.innerHeight, window.screen?.height ?? 0);
			const unclampedLeft = dragState.initialLeft + deltaX;
			const unclampedTop = dragState.initialTop + deltaY;
			const clampedLeft = Math.min(
				Math.max(0, unclampedLeft),
				Math.max(0, viewportWidth - dragState.hudWidth),
			);
			const clampedTop = Math.min(
				Math.max(0, unclampedTop),
				Math.max(0, viewportHeight - dragState.hudHeight),
			);
			setRecordingHudOffset({
				x: dragState.originX + (clampedLeft - dragState.initialLeft),
				y: dragState.originY + (clampedTop - dragState.initialTop),
			});
			return;
		}

		window.electronAPI?.hudOverlayDrag?.("move", event.screenX, event.screenY);
	};

	const handleHudBarPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
		const dragState = hudDragStartRef.current;
		if (!dragState || dragState.pointerId !== event.pointerId) return;

		if (dragState.mode === "overlay") {
			window.electronAPI?.hudOverlayDrag?.("end", 0, 0);
		}

		hudDragStartRef.current = null;
		const wasDragging = isHudDraggingRef.current;
		isHudDraggingRef.current = false;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		if (wasDragging) {
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
		}
	};

	return {
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
	};
}

export function useWebcamPreview({
	shouldStreamWebcamPreview,
	webcamDeviceId,
}: {
	shouldStreamWebcamPreview: boolean;
	webcamDeviceId: string | undefined;
}) {
	const webcamPreviewRef = useRef<HTMLVideoElement | null>(null);
	const recordingWebcamPreviewRef = useRef<HTMLVideoElement | null>(null);
	const previewStreamRef = useRef<MediaStream | null>(null);

	const attachPreviewStreamToNode = useCallback((videoElement: HTMLVideoElement | null) => {
		const previewStream = previewStreamRef.current;
		if (!videoElement || !previewStream || videoElement.srcObject === previewStream) return;
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
			if (!shouldStreamWebcamPreview) return;

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

	return { setWebcamPreviewNode, setRecordingWebcamPreviewNode };
}

export function useRecordingTimer({ recording, paused }: { recording: boolean; paused: boolean }) {
	const [recordingStart, setRecordingStart] = useState<number | null>(null);
	const [elapsed, setElapsed] = useState(0);
	const [pausedAt, setPausedAt] = useState<number | null>(null);
	const [pausedTotal, setPausedTotal] = useState(0);

	useEffect(() => {
		let timer: NodeJS.Timeout | null = null;
		if (recording) {
			if (!recordingStart) {
				setRecordingStart(Date.now());
				setPausedTotal(0);
			}
			if (paused) {
				if (!pausedAt) setPausedAt(Date.now());
				if (timer) clearInterval(timer);
			} else {
				if (pausedAt) {
					setPausedTotal((prev) => prev + (Date.now() - pausedAt));
					setPausedAt(null);
				}
				timer = setInterval(() => {
					if (recordingStart) {
						setElapsed(Math.floor((Date.now() - recordingStart - pausedTotal) / 1000));
					}
				}, 1000);
			}
		} else {
			setRecordingStart(null);
			setElapsed(0);
			setPausedAt(null);
			setPausedTotal(0);
			if (timer) clearInterval(timer);
		}
		return () => {
			if (timer) clearInterval(timer);
		};
	}, [recording, recordingStart, paused, pausedAt, pausedTotal]);

	const formatTime = (seconds: number) => {
		const m = Math.floor(seconds / 60)
			.toString()
			.padStart(2, "0");
		const s = (seconds % 60).toString().padStart(2, "0");
		return `${m}:${s}`;
	};

	return { elapsed, formatTime };
}
