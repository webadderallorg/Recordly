import { vi } from "vitest";
import { DEFAULT_WEBCAM_OVERLAY } from "../../components/video-editor/types";
import { FrameRenderer } from "./modernFrameRenderer";
export function createMockContext() {
	return {
		clearRect: vi.fn(),
		drawImage: vi.fn(),
		fillRect: vi.fn(),
		translate: vi.fn(),
		scale: vi.fn(),
		beginPath: vi.fn(),
		moveTo: vi.fn(),
		lineTo: vi.fn(),
		arcTo: vi.fn(),
		closePath: vi.fn(),
		clip: vi.fn(),
		stroke: vi.fn(),
		fill: vi.fn(),
		createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
		save: vi.fn(),
		restore: vi.fn(),
		getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(0) })),
		globalAlpha: 1,
		imageSmoothingEnabled: true,
		imageSmoothingQuality: "high",
	} as unknown as CanvasRenderingContext2D;
}

export function createMockCanvas() {
	const context = createMockContext();
	return {
		width: 0,
		height: 0,
		getContext: vi.fn(() => context),
		context,
	};
}

export function createRenderer() {
	return new FrameRenderer({
		width: 1920,
		height: 1080,
		nativeReadbackMode: "pixels",
		wallpaper: "#000000",
		zoomRegions: [],
		showShadow: false,
		shadowIntensity: 0,
		backgroundBlur: 0,
		cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		webcam: {
			...DEFAULT_WEBCAM_OVERLAY,
			enabled: false,
		},
		videoWidth: 1920,
		videoHeight: 1080,
		annotationRegions: [
			{
				id: "blur-1",
				startMs: 0,
				endMs: 1000,
				type: "blur",
				content: "",
				position: { x: 10, y: 10 },
				size: { width: 20, height: 20 },
				style: {
					color: "#ffffff",
					backgroundColor: "transparent",
					fontSize: 24,
					fontFamily: "Inter",
					fontWeight: "normal",
					fontStyle: "normal",
					textDecoration: "none",
					textAlign: "center",
					borderRadius: 0,
				},
				zIndex: 1,
				blurIntensity: 20,
			},
		],
	});
}
