import { afterEach, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: { getAppPath: () => "/recordly" } }));
vi.mock("./rendererServer", () => ({ getPackagedRendererBaseUrl: () => "http://127.0.0.1:43820" }));
import { isTrustedRenderer } from "./trustedRenderer";
afterEach(() => vi.unstubAllEnvs());

it.each([
	"file:///recordly/dist/index.html?windowType=editor#section",
	"http://127.0.0.1:43820/?windowType=onboarding",
	"http://localhost:5173/?windowType=hud-overlay",
])("accepts the app main document %s", (url) => {
	vi.stubEnv("APP_ROOT", "/recordly");
	vi.stubEnv("VITE_DEV_SERVER_URL", "http://localhost:5173/");
	const frame = { url };
	expect(
		isTrustedRenderer({
			sender: { mainFrame: frame },
			senderFrame: frame,
		} as Electron.IpcMainInvokeEvent),
	).toBe(true);
});

it.each([
	"https://foreign.test/",
	"http://127.0.0.1:43821/",
	"http://127.0.0.1:43820/foreign.html",
	"file://foreign/recordly/dist/index.html",
	"file:///other/index.html",
	"http://user:pass@127.0.0.1:43820/",
	"data:text/html,hello",
	"invalid-url",
])("rejects foreign main document %s", (url) => {
	const frame = { url };
	expect(
		isTrustedRenderer({
			sender: { mainFrame: frame },
			senderFrame: frame,
		} as Electron.IpcMainInvokeEvent),
	).toBe(false);
});

it("rejects missing frames and trusted-looking subframes", () => {
	const frame = { url: "http://127.0.0.1:43820/" };
	for (const senderFrame of [undefined, { ...frame }]) {
		expect(
			isTrustedRenderer({
				sender: { mainFrame: frame },
				senderFrame,
			} as Electron.IpcMainInvokeEvent),
		).toBe(false);
	}
});
