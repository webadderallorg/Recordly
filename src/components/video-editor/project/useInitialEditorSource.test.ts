import { beforeEach, describe, expect, it, vi } from "vitest";

const react = vi.hoisted(() => {
	const slots: unknown[] = [];
	const effects: Array<() => void> = [];
	let index = 0;
	type EffectSlot = { deps?: unknown[]; cleanup?: () => void };
	return {
		reset() {
			slots.length = 0;
			effects.length = 0;
		},
		render(run: () => void) {
			index = 0;
			run();
			for (const effect of effects.splice(0)) effect();
		},
		useRef<T>(initial: T) {
			const i = index++;
			if (!(i in slots)) slots[i] = { current: initial };
			return slots[i];
		},
		useCallback<T>(callback: T) {
			const i = index++;
			if (!(i in slots)) slots[i] = callback;
			return slots[i];
		},
		useEffect(effect: () => (() => void) | undefined, deps?: unknown[]) {
			const i = index++;
			const previous = slots[i] as EffectSlot | undefined;
			if (previous?.deps && deps?.every((dep, k) => Object.is(dep, previous.deps?.[k])))
				return;
			const slot: EffectSlot = { deps };
			slots[i] = slot;
			effects.push(() => {
				previous?.cleanup?.();
				slot.cleanup = effect() ?? undefined;
			});
		},
	};
});
vi.mock("react", () => ({
	useRef: react.useRef,
	useCallback: react.useCallback,
	useEffect: react.useEffect,
}));
vi.mock("../projectPersistence", () => ({
	fromFileUrl: (value: string) => value.replace(/^file:\/\//, ""),
	resolveVideoUrl: async (value: string) => `media://${value}`,
}));

const { useInitialEditorSource } = await import("./useInitialEditorSource");

type Input = Parameters<typeof useInitialEditorSource>[0];
type Session = { videoPath: string; webcamPath?: string | null; timeOffsetMs?: number };

let listener: ((session: Session | null) => void) | null = null;

function api(session: Session | null) {
	return {
		openProjectFileAtPath: vi.fn(),
		setCurrentVideoPath: vi.fn(async () => ({ success: true })),
		setCurrentRecordingSession: vi.fn(async () => ({ success: true })),
		loadCurrentProjectFile: vi.fn(async () => ({ success: false })),
		getCurrentRecordingSession: vi.fn(async () => ({ success: Boolean(session), session })),
		getCurrentVideoPath: vi.fn(async () => ({ success: false, path: null })),
		onRecordingSessionChanged: vi.fn((callback: (next: Session | null) => void) => {
			listener = callback;
			return () => {
				listener = null;
			};
		}),
	};
}

function baseInput(overrides: Partial<Input> = {}): Input {
	return {
		project: {
			setVideoSourcePath: vi.fn(),
			setVideoPath: vi.fn(),
			setCurrentProjectPath: vi.fn(),
			setLastSavedSnapshot: vi.fn(),
			setProjectBrowserOpen: vi.fn(),
			setError: vi.fn(),
			setLoading: vi.fn(),
		},
		appearance: {
			autoApplyFreshRecordingAutoZooms: true,
			webcam: { sourcePath: null },
			setWebcam: vi.fn(),
			setResolvedWebcamVideoUrl: vi.fn(),
		},
		timeline: { setSourceAudioFallbackRefreshKey: vi.fn() },
		smokeConfig: { enabled: false },
		devConfig: { inputPath: null },
		videoSourcePath: null,
		videoPlaybackRef: { current: { pause: vi.fn() } },
		setIsPlaying: vi.fn(),
		setCurrentTime: vi.fn(),
		setDuration: vi.fn(),
		remountPreview: vi.fn(),
		pendingFreshRecordingAutoZoomPathRef: { current: null },
		pendingFreshRecordingAgentEditsPathRef: { current: null },
		applyLoadedProject: vi.fn(async () => false),
		resetSourceScopedEditorState: vi.fn(),
		applySessionPresentation: vi.fn(),
		...overrides,
	} as unknown as Input;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function mount(session: Session | null, overrides: Partial<Input> = {}) {
	const electronAPI = api(session);
	(globalThis as { window?: unknown }).window = { electronAPI };
	let input = baseInput(overrides);
	react.render(() => useInitialEditorSource(input));
	await settle();
	return {
		input,
		electronAPI,
		rerender(next: Partial<Input>) {
			input = { ...input, ...next } as Input;
			react.render(() => useInitialEditorSource(input));
		},
		async broadcast(next: Session | null) {
			listener?.(next);
			await settle();
		},
	};
}

beforeEach(() => {
	react.reset();
	listener = null;
});

describe("useInitialEditorSource", () => {
	it("loads the recording session the app starts with", async () => {
		const { input } = await mount({ videoPath: "/r/a.mp4" });
		expect(input.project.setVideoSourcePath).toHaveBeenCalledWith("/r/a.mp4");
		expect(input.project.setVideoPath).toHaveBeenCalledWith("media:///r/a.mp4");
		expect(input.resetSourceScopedEditorState).toHaveBeenCalledTimes(1);
		expect(input.project.setLoading).toHaveBeenCalledWith(false);
	});

	it("switches to a recovered recording and leaves none of the old one behind", async () => {
		const mounted = await mount({ videoPath: "/r/a.mp4" });
		mounted.rerender({ videoSourcePath: "/r/a.mp4" });
		const { input } = mounted;
		(input.resetSourceScopedEditorState as ReturnType<typeof vi.fn>).mockClear();

		await mounted.broadcast({ videoPath: "/r/b.mp4" });

		expect(input.resetSourceScopedEditorState).toHaveBeenCalledTimes(1);
		expect(input.project.setVideoSourcePath).toHaveBeenLastCalledWith("/r/b.mp4");
		expect(input.project.setVideoPath).toHaveBeenLastCalledWith("media:///r/b.mp4");
		expect(input.project.setCurrentProjectPath).toHaveBeenLastCalledWith(null);
		expect(input.project.setLastSavedSnapshot).toHaveBeenLastCalledWith(null);
		expect(input.project.setProjectBrowserOpen).toHaveBeenLastCalledWith(false);
		expect(input.setDuration).toHaveBeenLastCalledWith(0);
		expect(input.setCurrentTime).toHaveBeenLastCalledWith(0);
		expect(input.setIsPlaying).toHaveBeenLastCalledWith(false);
		expect(input.videoPlaybackRef.current?.pause).toHaveBeenCalled();
		expect(input.remountPreview).toHaveBeenCalledTimes(2);
		expect(input.pendingFreshRecordingAgentEditsPathRef.current).toBe("media:///r/b.mp4");
	});

	it("drops the webcam of the recording it switched away from", async () => {
		const mounted = await mount({ videoPath: "/r/a.mp4", webcamPath: "/r/a.webcam.mp4" });
		mounted.rerender({ videoSourcePath: "/r/a.mp4" });
		await mounted.broadcast({ videoPath: "/r/b.mp4" });
		const setWebcam = mounted.input.appearance.setWebcam as ReturnType<typeof vi.fn>;
		const updated = setWebcam.mock.lastCall?.[0]({
			sourcePath: "/r/a.webcam.mp4",
			enabled: true,
			visibleRanges: [{ startMs: 0, endMs: 1 }],
		});
		expect(updated).toMatchObject({
			enabled: false,
			sourcePath: null,
			visibleRanges: undefined,
		});
	});

	it("loads a recovered recording when the editor is showing nothing at all", async () => {
		const mounted = await mount(null);
		expect(mounted.input.project.setProjectBrowserOpen).toHaveBeenCalledWith(true);
		await mounted.broadcast({ videoPath: "/r/b.mp4" });
		expect(mounted.input.project.setVideoSourcePath).toHaveBeenCalledWith("/r/b.mp4");
		expect(mounted.input.project.setProjectBrowserOpen).toHaveBeenLastCalledWith(false);
	});

	it("only refreshes the webcam when the recording is the one already loaded", async () => {
		const mounted = await mount({ videoPath: "/r/a.mp4" });
		mounted.rerender({ videoSourcePath: "/r/a.mp4" });
		const { input } = mounted;
		(input.resetSourceScopedEditorState as ReturnType<typeof vi.fn>).mockClear();
		(input.project.setVideoSourcePath as ReturnType<typeof vi.fn>).mockClear();
		(input.remountPreview as ReturnType<typeof vi.fn>).mockClear();

		await mounted.broadcast({ videoPath: "/r/a.mp4", webcamPath: "/r/a.webcam.mp4" });

		expect(input.resetSourceScopedEditorState).not.toHaveBeenCalled();
		expect(input.project.setVideoSourcePath).not.toHaveBeenCalled();
		expect(input.remountPreview).not.toHaveBeenCalled();
		expect(input.timeline.setSourceAudioFallbackRefreshKey).toHaveBeenCalled();
	});

	it("ignores a cleared session", async () => {
		const mounted = await mount({ videoPath: "/r/a.mp4" });
		mounted.rerender({ videoSourcePath: "/r/a.mp4" });
		(mounted.input.resetSourceScopedEditorState as ReturnType<typeof vi.fn>).mockClear();
		await mounted.broadcast(null);
		expect(mounted.input.resetSourceScopedEditorState).not.toHaveBeenCalled();
		expect(mounted.input.project.setError).not.toHaveBeenCalledWith(
			expect.stringContaining("Error loading recording"),
		);
	});

	it("reports a recovered recording it cannot resolve", async () => {
		const mounted = await mount({ videoPath: "/r/a.mp4" });
		mounted.rerender({ videoSourcePath: "/r/a.mp4" });
		const persistence = await import("../projectPersistence");
		vi.spyOn(persistence, "resolveVideoUrl").mockRejectedValueOnce(
			new Error("media server is down"),
		);
		await mounted.broadcast({ videoPath: "/r/b.mp4" });
		expect(mounted.input.project.setError).toHaveBeenCalledWith(
			"Error loading recording: Error: media server is down",
		);
	});
});
