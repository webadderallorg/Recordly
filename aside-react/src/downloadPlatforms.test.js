import assert from "node:assert/strict";
import test from "node:test";
import { getDownloadPlatform } from "./downloadPlatforms.js";

test("desktop download selection supports modern and legacy browser identification", () => {
	for (const [client, expected] of [
		[{ userAgentData: { platform: "Windows" }, platform: "Linux x86_64" }, "windows"],
		[{ platform: "Win32" }, "windows"],
		[{ platform: "MacIntel" }, "macos"],
		[{ platform: "Linux x86_64" }, "linux"],
		[{ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, "windows"],
		[{ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" }, "linux"],
	]) assert.equal(getDownloadPlatform(client), expected);
});

test("mobile, unknown and server-rendered clients retain the desktop fallback", () => {
	for (const client of [
		{}, { platform: "unknown" },
		{ platform: "Linux armv8l", userAgent: "Mozilla/5.0 (Linux; Android 15)" },
		{ platform: "MacIntel", maxTouchPoints: 5 },
		{ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" },
	]) assert.equal(getDownloadPlatform(client), "macos");
});
