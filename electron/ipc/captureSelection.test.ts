import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
	read: vi.fn(),
	write: vi.fn(),
	windows: vi.fn(),
	sources: vi.fn(),
	current: null as unknown,
	displays: [{ id: 1, bounds: { x: 0, y: 0, width: 1440, height: 1000 } }],
}));
vi.mock("../appSettingsStore", () => ({
	readAppSetting: mocks.read,
	writeAppSetting: mocks.write,
}));
vi.mock("./capturePickerSources", () => ({ listCapturePickerWindows: mocks.windows }));
vi.mock("./register/sources", () => ({ getDesktopSources: mocks.sources }));
vi.mock("./state", () => ({
	get selectedSource() {
		return mocks.current;
	},
	setSelectedSource: (value: unknown) => {
		mocks.current = value;
	},
}));
vi.mock("./utils", () => ({ getScreen: () => ({ getAllDisplays: () => mocks.displays }) }));
import {
	rememberCaptureSource,
	restoreLastCaptureSource,
	validateCaptureSource,
} from "./captureSelection";
const platform = process.platform;
const source = { id: "window:101:0", name: "Document", windowTitle: "Document", appName: "Notes" };
beforeEach(() => {
	vi.clearAllMocks();
	Object.defineProperty(process, "platform", { value: "darwin" });
	mocks.current = null;
	mocks.read.mockReturnValue({ platform: "darwin", source });
	mocks.windows.mockResolvedValue([
		{ id: source.id, appName: "Notes", title: "Document", x: 0, y: 0, width: 100, height: 100 },
	]);
});
afterEach(() => {
	Object.defineProperty(process, "platform", { value: platform });
});
describe("remembered capture selection", () => {
	it("restores only the same available window", async () => {
		expect(await restoreLastCaptureSource()).toMatchObject(source);
		expect(mocks.current).toMatchObject(source);
	});
	it("rejects closed windows and clears stale saved selection", async () => {
		mocks.windows.mockResolvedValue([]);
		expect(await restoreLastCaptureSource()).toBeNull();
		expect(mocks.write).toHaveBeenCalledWith("recordly.capture.lastSource.v1", null);
	});
	it("rejects a recycled window ID with a different title", async () => {
		mocks.windows.mockResolvedValue([
			{ id: source.id, title: "Another document", appName: "Notes" },
		]);
		expect(await validateCaptureSource(source)).toBeNull();
	});
	it("rejects disconnected screens and areas that would be resized", async () => {
		expect(
			await validateCaptureSource({ id: "screen:2:0", name: "Gone", display_id: "2" }),
		).toBeNull();
		expect(
			await validateCaptureSource({
				id: "area:1",
				name: "Area",
				display_id: "1",
				area: { x: 1300, y: 0, width: 400, height: 300 },
			}),
		).toBeNull();
	});
	it("does not broaden window capture when detection fails", async () => {
		mocks.windows.mockRejectedValue(new Error("permission denied"));
		await expect(validateCaptureSource(source)).rejects.toThrow("permission denied");
		expect(mocks.sources).not.toHaveBeenCalled();
	});
	it("keeps a newer user selection made during restore", async () => {
		let resolve!: (value: unknown[]) => void;
		mocks.windows.mockReturnValue(
			new Promise((done) => {
				resolve = done;
			}),
		);
		const pending = restoreLastCaptureSource();
		const newer = { id: "screen:1:0", name: "Newer" };
		mocks.current = newer;
		resolve([]);
		expect(await pending).toEqual(newer);
		expect(mocks.write).not.toHaveBeenCalled();
	});
	it("saves only selection metadata, excluding thumbnails", () => {
		rememberCaptureSource({ ...source, thumbnail: "private pixels" });
		const stored = mocks.write.mock.calls[0][1];
		expect(stored.source).not.toHaveProperty("thumbnail");
		expect(stored.platform).toBe("darwin");
	});
});
