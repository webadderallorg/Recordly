import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	BUILT_IN_WALLPAPERS,
	DEFAULT_WALLPAPER_PATH,
	DEFAULT_WALLPAPER_RELATIVE_PATH,
	getAvailableWallpapers,
	resolveAvailableWallpaperPath,
} from "./wallpapers";

describe("wallpapers", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("keeps the curated wallpaper list and default path aligned", () => {
		expect(DEFAULT_WALLPAPER_PATH).toBe("/wallpapers/tahoe-light.jpg");
		expect(DEFAULT_WALLPAPER_RELATIVE_PATH).toBe("wallpapers/tahoe-light.jpg");
		expect(BUILT_IN_WALLPAPERS.at(0)?.publicPath).toBe(
			"/wallpapers/golden-gate-day-no-vignette.png",
		);
		expect(BUILT_IN_WALLPAPERS.at(1)?.publicPath).toBe("/wallpapers/windows-11-bloom.jpg");
		expect(BUILT_IN_WALLPAPERS.at(2)?.publicPath).toBe(DEFAULT_WALLPAPER_PATH);
		expect(BUILT_IN_WALLPAPERS.at(3)?.publicPath).toBe("/wallpapers/tahoe-dark.jpg");
		expect(BUILT_IN_WALLPAPERS.at(4)?.publicPath).toBe("/wallpapers/macos-hello-black.jpg");
		expect(BUILT_IN_WALLPAPERS.some((wallpaper) => wallpaper.id === "iridescent-9")).toBe(
			false,
		);
		expect(BUILT_IN_WALLPAPERS).toHaveLength(24);
	});

	it("preserves the curated order when asset discovery returns extra files", async () => {
		vi.stubGlobal("window", {
			electronAPI: {
				listAssetDirectory: vi.fn(async () => ({
					success: true,
					files: [
						"wallpaper1.jpg",
						"energy-17.jpg",
						"macos-hello-black.jpg",
						"wallpaper4.jpg",
						"wispysky.mp4",
						"golden-gate-day-no-vignette.png",
						"recordly-hero.png",
					],
				})),
			},
		});

		await expect(getAvailableWallpapers()).resolves.toEqual([
			BUILT_IN_WALLPAPERS[0],
			BUILT_IN_WALLPAPERS[4],
			BUILT_IN_WALLPAPERS[6],
			BUILT_IN_WALLPAPERS[16],
			BUILT_IN_WALLPAPERS[22],
			BUILT_IN_WALLPAPERS[23],
		]);
	});

	it("falls back to the default wallpaper when a bundled wallpaper is missing", async () => {
		vi.stubGlobal("window", {
			electronAPI: {
				listAssetDirectory: vi.fn().mockResolvedValue({
					success: true,
					files: ["wallpaper2.jpg"],
				}),
			},
		});

		await expect(resolveAvailableWallpaperPath("/wallpapers/midnight-8.jpg")).resolves.toBe(
			DEFAULT_WALLPAPER_PATH,
		);
		await expect(resolveAvailableWallpaperPath("/wallpapers/wallpaper2.jpg")).resolves.toBe(
			"/wallpapers/wallpaper2.jpg",
		);
	});

	it("strips query strings and fragments before checking bundled wallpaper files", async () => {
		vi.stubGlobal("window", {
			electronAPI: {
				listAssetDirectory: vi.fn().mockResolvedValue({
					success: true,
					files: ["wispysky.mp4"],
				}),
			},
		});

		await expect(resolveAvailableWallpaperPath("/wallpapers/wispysky.mp4#t=0.1")).resolves.toBe(
			"/wallpapers/wispysky.mp4#t=0.1",
		);
	});

	it("preserves non-bundled wallpaper values", async () => {
		await expect(resolveAvailableWallpaperPath("#123456")).resolves.toBe("#123456");
		await expect(resolveAvailableWallpaperPath("data:image/png;base64,abc")).resolves.toBe(
			"data:image/png;base64,abc",
		);
	});
});

const wallpaperHooks = vi.hoisted(() => ({
	states: [] as unknown[],
	index: 0,
	effects: [] as (() => void)[],
	prepare: vi.fn(async (file: File) => `data:image/png;base64,${file.name}`),
	save: vi.fn(),
}));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useState: (initial: unknown) => {
		const index = wallpaperHooks.index++;
		if (!(index in wallpaperHooks.states))
			wallpaperHooks.states[index] = typeof initial === "function" ? initial() : initial;
		return [
			wallpaperHooks.states[index],
			(update: unknown) => {
				wallpaperHooks.states[index] =
					typeof update === "function" ? update(wallpaperHooks.states[index]) : update;
			},
		];
	},
	useEffect: (effect: () => void) => wallpaperHooks.effects.push(effect),
	useMemo: (factory: () => unknown) => factory(),
	useRef: (value: unknown) => ({ current: value }),
}));
vi.mock("@/components/video-editor/editorPreferences", () => ({
	DEFAULT_EDITOR_PREFERENCES: { wallpaper: "#000000", backgroundBlur: 0 },
	loadEditorPreferences: () => ({ customWallpapers: [] }),
	saveEditorPreferences: wallpaperHooks.save,
}));
vi.mock("@/components/video-editor/useWallpaperPreviews", () => ({
	useWallpaperPreviews: () => ({ wallpapers: [], previews: {} }),
}));
vi.mock("@/components/video-editor/settings/useSettingsTranslations", () => ({
	useSettingsTranslations: () => ({
		te: (_key: string, fallback: string) => fallback,
		tSettings: (key: string) => key,
	}),
}));
vi.mock("@/lib/assetPath", () => ({ peekWallpaperThumbnailUrl: () => undefined }));
vi.mock("@/lib/wallpaperUpload", async (original) => ({
	...(await original<typeof import("./wallpaperUpload")>()),
	prepareWallpaperImage: wallpaperHooks.prepare,
}));
vi.mock("@/components/ui/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { useBackgroundSettings } from "@/components/video-editor/settings/useBackgroundSettings";

describe("uploaded wallpaper list", () => {
	beforeEach(() => {
		wallpaperHooks.states = [];
		wallpaperHooks.index = 0;
		wallpaperHooks.effects = [];
		vi.clearAllMocks();
	});
	afterEach(() => vi.unstubAllGlobals());

	function render(onWallpaperChange: (path: string) => void) {
		wallpaperHooks.index = 0;
		wallpaperHooks.effects = [];
		// biome-ignore lint/correctness/useHookAtTopLevel: React hooks are intentionally mocked to exercise the upload callbacks and state commits.
		const settings = useBackgroundSettings(
			{ selected: "#000000", onWallpaperChange },
			{ customWallpapers: ["older"] } as never,
			true,
		);
		for (const effect of wallpaperHooks.effects) effect();
		return settings;
	}
	it.each([
		"image",
		"video-file",
		"video-picker",
	])("keeps repeated %s imports unique without reordering existing entries", async (kind) => {
		const onWallpaperChange = vi.fn();
		const suffix = kind === "image" ? "png" : "mp4";
		const paths = ["first", "second", "first"].map((name) =>
			kind === "image"
				? `data:image/png;base64,${name}.${suffix}`
				: `/imports/${name}.${suffix}`,
		);
		const picker = vi
			.fn()
			.mockResolvedValueOnce({ success: true, path: paths[0] })
			.mockResolvedValueOnce({ success: true, path: paths[1] })
			.mockResolvedValueOnce({ success: true, path: paths[2] });
		vi.stubGlobal("window", {
			electronAPI: {
				openVideoFilePicker: picker,
				importWallpaperVideo: vi.fn(async (file: File) => ({
					success: true,
					path: `/imports/${file.name}`,
				})),
			},
		});
		let settings = render(onWallpaperChange);
		for (const name of ["first", "second", "first"]) {
			if (kind === "video-picker") await settings.handleVideoUpload();
			else
				await settings.handleImageUpload({
					target: {
						files: [
							new File([name], `${name}.${suffix}`, {
								type: kind === "image" ? "image/png" : "video/mp4",
							}),
						],
						value: "selected",
					},
				} as unknown as React.ChangeEvent<HTMLInputElement>);
			settings = render(onWallpaperChange);
		}
		const expected =
			kind === "image" ? ["older", paths[0], paths[1]] : [paths[1], paths[0], "older"];
		expect(settings.customImages).toEqual(expected);
		expect(wallpaperHooks.save).toHaveBeenLastCalledWith({ customWallpapers: expected });
		expect(onWallpaperChange.mock.calls.map(([path]) => path)).toEqual(paths);
	});
});
