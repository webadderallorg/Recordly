import type { IpcMainInvokeEvent } from "electron";
import { describe, expect, it } from "vitest";
import { validateAppLocaleRequest } from "./localeIpc";

function event(url = "http://localhost:5173/?windowType=onboarding") {
	const frame = { url };
	return {
		senderFrame: frame,
		sender: { mainFrame: frame, isDestroyed: () => false },
	} as unknown as Pick<IpcMainInvokeEvent, "sender" | "senderFrame">;
}
const trusted = ["http://localhost:5173/", "file:///Applications/Recordly/dist/index.html"];

describe("app locale IPC authorization", () => {
	it("accepts supported locales from trusted top-level app documents", () => {
		expect(validateAppLocaleRequest(event(), "zh-TW", trusted)).toBe(true);
		expect(
			validateAppLocaleRequest(
				event("file:///Applications/Recordly/dist/index.html?windowType=hud-overlay"),
				"es",
				trusted,
			),
		).toBe(true);
	});
	it.each([null, {}, "xx", "zh-Hant", "en<script>"])("rejects invalid locale %j", (locale) => {
		expect(validateAppLocaleRequest(event(), locale, trusted)).toBe(false);
	});
	it.each([
		"https://example.com/",
		"http://localhost:5174/",
		"http://localhost:5173/other",
		"http://user@localhost:5173/",
		"file:///tmp/index.html",
	])("rejects unrelated document %s", (url) => {
		expect(validateAppLocaleRequest(event(url), "en", trusted)).toBe(false);
	});
	it("rejects subframes and destroyed senders", () => {
		const subframe = event();
		subframe.senderFrame = { url: trusted[0] } as Electron.WebFrameMain;
		expect(validateAppLocaleRequest(subframe, "en", trusted)).toBe(false);
		const destroyed = event();
		destroyed.sender.isDestroyed = () => true;
		expect(validateAppLocaleRequest(destroyed, "en", trusted)).toBe(false);
	});
});
