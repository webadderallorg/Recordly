import { afterEach, expect, it, vi } from "vitest";
import { useInitialEditorSource } from "./useInitialEditorSource";
const effects = vi.hoisted(() => [] as (() => unknown)[]);
vi.mock("react", () => ({
	useEffect: (callback: () => unknown) => effects.push(callback),
	useRef: (current: unknown) => ({ current }),
}));
const metadata = {
	version: 1 as const,
	sourceKind: "ios-device" as const,
	mode: "passthrough" as const,
	format: {
		codedWidth: 100,
		codedHeight: 200,
		displayWidth: 200,
		displayHeight: 100,
		codec: "h264",
		colorPrimaries: null,
		transferFunction: null,
		ycbcrMatrix: null,
		fullRange: null,
		transform: [0, 1, -1, 0, 200, 0] as const,
		observedFrameRate: 30,
		fingerprint: "fixture",
	},
	deviceAudioRecorded: false,
	narrationRecorded: false,
	stopReason: "user-stop",
	interrupted: false,
};
afterEach(() => {
	effects.length = 0;
	vi.unstubAllGlobals();
});
function setup(saved = false) {
	const api = {
		loadCurrentProjectFile: vi.fn(async () =>
			saved
				? {
						success: true,
						project: {
							editor: { showCursor: true, borderRadius: 12, aspectRatio: "16:9" },
						},
					}
				: { success: false },
		),
		getCurrentRecordingSession: vi.fn(async () => ({
			success: true,
			session: { videoPath: "/source.mov", captureMetadata: metadata },
		})),
		getLocalMediaUrl: vi.fn(async () => ({ success: true, url: "media-url" })),
	};
	vi.stubGlobal("window", { electronAPI: api });
	const project = new Proxy({} as Record<PropertyKey, ReturnType<typeof vi.fn>>, {
		get: (target, key) => {
			if (!target[key]) target[key] = vi.fn();
			return target[key];
		},
	});
	const appearance = {
		autoApplyFreshRecordingAutoZooms: true,
		webcam: { sourcePath: null },
		setShowCursor: vi.fn(),
		setBorderRadius: vi.fn(),
		setCropRegion: vi.fn(),
		setWebcam: vi.fn(),
		setResolvedWebcamVideoUrl: vi.fn(),
	};
	const timeline = { setCursorTelemetry: vi.fn(), setCursorTelemetrySourcePath: vi.fn() };
	const pending = { current: null as string | null };
	const applyLoadedProject = vi.fn(async () => true);
	const presentation = vi.fn();
	useInitialEditorSource({
		project,
		appearance,
		timeline,
		smokeConfig: { enabled: false },
		devConfig: {},
		videoSourcePath: null,
		pendingFreshRecordingAutoZoomPathRef: pending,
		applyLoadedProject,
		resetSourceScopedEditorState: vi.fn(),
		applySessionPresentation: presentation,
	} as unknown as Parameters<typeof useInitialEditorSource>[0]);
	effects[0]();
	return { project, appearance, pending, api, applyLoadedProject, presentation };
}
it("applies fresh mobile defaults once and carries provenance for saving", async () => {
	const s = setup();
	await vi.waitFor(() => expect(s.project.setLoading).toHaveBeenCalledWith(false));
	expect(s.appearance.setShowCursor).toHaveBeenCalledWith(false);
	expect(s.appearance.setBorderRadius).toHaveBeenCalledWith(0);
	expect(s.appearance.setCropRegion).toHaveBeenCalledWith({ x: 0, y: 0, width: 1, height: 1 });
	expect(s.project.setCaptureMetadata).toHaveBeenLastCalledWith(metadata);
	expect(s.pending.current).toBeNull();
	expect(s.presentation).toHaveBeenCalled();
	effects[0]();
	expect(s.api.loadCurrentProjectFile).toHaveBeenCalledTimes(1);
});
it("loads saved editor settings before considering fresh-session defaults", async () => {
	const s = setup(true);
	await vi.waitFor(() => expect(s.project.setLoading).toHaveBeenCalledWith(false));
	expect(s.applyLoadedProject).toHaveBeenCalled();
	expect(s.api.getCurrentRecordingSession).not.toHaveBeenCalled();
	expect(s.appearance.setShowCursor).not.toHaveBeenCalled();
	expect(s.appearance.setCropRegion).not.toHaveBeenCalled();
});
