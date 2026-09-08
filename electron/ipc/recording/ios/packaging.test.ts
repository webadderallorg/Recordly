import { expect, it } from "vitest";
import {
	decodeMachOPlistSection,
	validateIOSHelperFacts,
} from "../../../../scripts/ios-helper-policy.mjs";

const valid = {
	executable: true,
	architecture: "arm64",
	minimumOS: "14.0",
	protocolVersion: 1,
	privacy: {
		NSCameraUsageDescription: "Connected device screen",
		NSMicrophoneUsageDescription: "Narration",
	},
	entitlements: {
		"com.apple.security.device.camera": true,
		"com.apple.security.device.audio-input": true,
	},
};
it("rejects missing executable, wrong slice/floor/protocol/privacy and unsigned capture entitlements", () => {
	expect(validateIOSHelperFacts(valid, { architecture: "arm64", signed: true })).toEqual([]);
	for (const patch of [
		{ executable: false },
		{ architecture: "x86_64" },
		{ minimumOS: "26.0" },
		{ protocolVersion: 2 },
		{ privacy: {} },
		{ entitlements: {} },
	]) {
		expect(
			validateIOSHelperFacts({ ...valid, ...patch }, { architecture: "arm64", signed: true })
				.length,
		).toBeGreaterThan(0);
	}
});

it("reads both byte-oriented Intel and word-oriented arm64 otool sections", () => {
	const expected = "<plist></plist>\n";
	const intel = "0000000100044700\t3c 70 6c 69 73 74 3e 3c 2f 70 6c 69 73 74 3e 0a";
	const arm = "000000010003e790\t696c703c 3c3e7473 696c702f 0a3e7473";
	expect(decodeMachOPlistSection(intel).toString()).toBe(expected);
	expect(decodeMachOPlistSection(arm).toString()).toBe(expected);
});
