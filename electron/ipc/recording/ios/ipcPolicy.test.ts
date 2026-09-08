import { expect, it } from "vitest";
import { assertIOSCaptureSender, parseIOSPrepareInput } from "./ipcPolicy";
it("accepts only the known application's top-level frame at its trusted URL", () => {
	const allowed = {
		knownWindow: true,
		mainFrame: true,
		url: "http://localhost:5173/?windowType=hud-overlay",
		trustedUrls: ["http://localhost:5173/"],
	};
	expect(() => assertIOSCaptureSender(allowed)).not.toThrow();
	for (const patch of [
		{ knownWindow: false },
		{ mainFrame: false },
		{ url: "https://evil.example/" },
		{ url: "http://localhost:5173/remote" },
	]) {
		expect(() => assertIOSCaptureSender({ ...allowed, ...patch })).toThrow("INVALID_REQUEST");
	}
});
it("rejects renderer paths, shell arguments and unknown prepare fields", () => {
	const input = {
		deviceToken: "phone",
		generation: 1,
		options: { deviceAudio: false, microphoneToken: null },
	};
	expect(parseIOSPrepareInput(input)).toEqual(input);
	for (const payload of [
		{ ...input, outputPath: "/tmp/evil.mov" },
		{ ...input, args: ["-vf", "crop"] },
		{ ...input, options: { ...input.options, filter: "evil" } },
	]) {
		expect(() => parseIOSPrepareInput(payload)).toThrow();
	}
});
