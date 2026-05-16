import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";

export interface VideoUploadState {
	file: File | null;
	blobUrl: string | null;
	videoTexture: THREE.VideoTexture | null;
	videoDuration: number;
	videoAspect: number;
	isReady: boolean;
}

export interface VideoUploadControls {
	loadFile: (file: File) => void;
	clear: () => void;
	/** Seek the video to a specific time (for timeline scrubbing) */
	seekTo: (time: number) => void;
	play: () => void;
	pause: () => void;
}

export function useVideoUpload(): [VideoUploadState, VideoUploadControls] {
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const textureRef = useRef<THREE.VideoTexture | null>(null);
	const blobUrlRef = useRef<string | null>(null);

	const [state, setState] = useState<VideoUploadState>({
		file: null,
		blobUrl: null,
		videoTexture: null,
		videoDuration: 0,
		videoAspect: 16 / 9,
		isReady: false,
	});

	const clear = useCallback(() => {
		if (videoRef.current) {
			videoRef.current.pause();
			videoRef.current.src = "";
		}
		if (textureRef.current) {
			textureRef.current.dispose();
			textureRef.current = null;
		}
		if (blobUrlRef.current) {
			URL.revokeObjectURL(blobUrlRef.current);
			blobUrlRef.current = null;
		}
		setState({
			file: null,
			blobUrl: null,
			videoTexture: null,
			videoDuration: 0,
			videoAspect: 16 / 9,
			isReady: false,
		});
	}, []);

	const loadFile = useCallback((file: File) => {
		clear();

		const url = URL.createObjectURL(file);
		blobUrlRef.current = url;

		const video = document.createElement("video");
		video.src = url;
		video.muted = true;
		video.playsInline = true;
		video.loop = false;
		video.crossOrigin = "anonymous";
		videoRef.current = video;

		video.addEventListener("loadedmetadata", () => {
			const texture = new THREE.VideoTexture(video);
			texture.colorSpace = THREE.SRGBColorSpace;
			texture.minFilter = THREE.LinearFilter;
			texture.magFilter = THREE.LinearFilter;
			textureRef.current = texture;

			setState({
				file,
				blobUrl: url,
				videoTexture: texture,
				videoDuration: video.duration,
				videoAspect: video.videoWidth / video.videoHeight,
				isReady: true,
			});
		});

		video.load();
	}, [clear]);

	const seekTo = useCallback((time: number) => {
		const video = videoRef.current;
		if (!video) return;
		// Only seek if difference is significant (avoids thrashing during playback)
		if (Math.abs(video.currentTime - time) > 0.05) {
			video.currentTime = Math.max(0, Math.min(time, video.duration));
		}
	}, []);

	const play = useCallback(() => videoRef.current?.play(), []);
	const pause = useCallback(() => videoRef.current?.pause(), []);

	// Cleanup on unmount
	useEffect(() => () => { clear(); }, [clear]);

	return [state, { loadFile, clear, seekTo, play, pause }];
}
