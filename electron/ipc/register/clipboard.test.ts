import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handle: vi.fn(), writeText: vi.fn() }));
vi.mock("electron", () => ({
	app: { getAppPath: () => "/recordly" },
	clipboard: { writeText: mocks.writeText },
	ipcMain: { handle: mocks.handle },
}));
vi.mock("../../rendererServer", () => ({
	getPackagedRendererBaseUrl: () => "http://127.0.0.1:43820/",
}));
import { registerClipboardHandlers } from "./clipboard";

type Frame = { url: string };
let write: (
	event: { senderFrame: Frame; sender: { mainFrame: Frame } },
	value: unknown,
) => {
	success: boolean;
};
beforeEach(() => {
	vi.stubEnv("APP_ROOT", "/recordly");
	vi.stubEnv("VITE_DEV_SERVER_URL", "http://localhost:5173/");
	registerClipboardHandlers();
	write = mocks.handle.mock.calls.at(-1)![1];
});
afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllEnvs();
});

describe("desktop clipboard writes", () => {
	it.each([
		"http://localhost:5173/?windowType=editor",
		"http://127.0.0.1:43820/?windowType=editor",
		"file:///recordly/dist/index.html?windowType=editor",
	])("accepts the trusted app document %s", (url) => {
		const frame = { url };
		expect(
			write(
				{ senderFrame: frame, sender: { mainFrame: frame } },
				"https://recordly.test/v/a",
			),
		).toEqual({ success: true });
		expect(mocks.writeText).toHaveBeenCalledWith("https://recordly.test/v/a");
	});
	it.each([
		"https://untrusted.test/",
		"http://localhost:5173/untrusted.html",
		"http://user:password@localhost:5173/",
		"file:///other/index.html",
	])("rejects an untrusted document %s", (url) => {
		const frame = { url };
		expect(write({ senderFrame: frame, sender: { mainFrame: frame } }, "text")).toEqual({
			success: false,
		});
		expect(mocks.writeText).not.toHaveBeenCalled();
	});
	it("rejects subframes and invalid payloads", () => {
		const frame = { url: "http://localhost:5173/" };
		expect(write({ senderFrame: { ...frame }, sender: { mainFrame: frame } }, "text")).toEqual({
			success: false,
		});
		for (const value of [undefined, {}, "x".repeat(1024 * 1024 + 1)]) {
			expect(write({ senderFrame: frame, sender: { mainFrame: frame } }, value)).toEqual({
				success: false,
			});
		}
		expect(mocks.writeText).not.toHaveBeenCalled();
	});
	it("reports a native failure without throwing into the renderer", () => {
		mocks.writeText.mockImplementationOnce(() => {
			throw new Error("Unavailable");
		});
		const frame = { url: "http://localhost:5173/" };
		expect(write({ senderFrame: frame, sender: { mainFrame: frame } }, "text")).toEqual({
			success: false,
		});
	});
});
