import { describe, expect, it } from "vitest";
import {
	assertValidAppleTeamId,
	collectArchitectureErrors,
	collectCodeSigningMetadataErrors,
	collectEntitlementErrors,
	expectedMachOArchitecture,
	parseLipoArchitectures,
} from "../scripts/macos-distribution-policy.mjs";

const validCodeSigningDetails = `
Identifier=dev.recordly.app
CodeDirectory v=20500 size=123 flags=0x10000(runtime) hashes=3+7 location=embedded
Authority=Developer ID Application: Recordly Developer (A1B2C3D4E5)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
Timestamp=Aug 9, 2026 at 10:00:00
TeamIdentifier=A1B2C3D4E5
`;

describe("macOS distribution signing policy", () => {
	it("accepts a valid Developer ID signature", () => {
		expect(collectCodeSigningMetadataErrors(validCodeSigningDetails, "A1B2C3D4E5")).toEqual([]);
	});

	it("rejects a wrong identity, team, timestamp, runtime, and bundle identifier", () => {
		const details = `
Identifier=dev.example.app
CodeDirectory v=20400 size=123 flags=0x0(none)
Authority=Apple Development: Example (Z9Y8X7W6V5)
Timestamp=none
TeamIdentifier=Z9Y8X7W6V5
`;

		expect(collectCodeSigningMetadataErrors(details, "A1B2C3D4E5")).toEqual([
			"unexpected bundle identifier: dev.example.app",
			"the leaf signing authority is not Developer ID Application",
			"unexpected TeamIdentifier: Z9Y8X7W6V5",
			"secure signing timestamp is missing",
			"hardened runtime flag is missing",
		]);
	});

	it("validates the expected Apple team ID shape", () => {
		expect(() => assertValidAppleTeamId("A1B2C3D4E5")).not.toThrow();
		expect(() => assertValidAppleTeamId("short")).toThrow(/exactly 10/);
	});
});

describe("macOS distribution entitlement policy", () => {
	const validEntitlements = {
		"com.apple.security.cs.allow-jit": true,
		"com.apple.security.cs.allow-unsigned-executable-memory": true,
		"com.apple.security.cs.disable-library-validation": true,
		"com.apple.security.device.audio-input": true,
		"com.apple.security.device.camera": true,
	};

	it("accepts the intended production entitlements", () => {
		expect(collectEntitlementErrors(validEntitlements)).toEqual([]);
	});

	it("rejects missing capabilities and debug attachment", () => {
		expect(
			collectEntitlementErrors({
				...validEntitlements,
				"com.apple.security.cs.allow-jit": false,
				"com.apple.security.get-task-allow": true,
			}),
		).toEqual([
			"required entitlement is missing or disabled: com.apple.security.cs.allow-jit",
			"distribution build must not enable com.apple.security.get-task-allow",
		]);
	});

	it("rejects unreviewed root runtime exceptions", () => {
		expect(
			collectEntitlementErrors({
				...validEntitlements,
				"com.apple.security.cs.allow-dyld-environment-variables": true,
			}),
		).toEqual([
			"unexpected root application entitlement: com.apple.security.cs.allow-dyld-environment-variables",
		]);
	});

	it("rejects disabled but unreviewed entitlement keys", () => {
		expect(
			collectEntitlementErrors({
				...validEntitlements,
				"com.apple.security.get-task-allow": false,
			}),
		).toEqual(["unexpected root application entitlement: com.apple.security.get-task-allow"]);
	});
});

describe("macOS distribution architecture policy", () => {
	it("parses thin and fat lipo output", () => {
		expect(parseLipoArchitectures("Non-fat file: App is architecture: arm64")).toEqual([
			"arm64",
		]);
		expect(
			parseLipoArchitectures("Architectures in the fat file: App are: x86_64 arm64"),
		).toEqual(["x86_64", "arm64"]);
	});

	it("uses path-specific helper architecture before the build architecture", () => {
		expect(
			expectedMachOArchitecture("app/electron/native/bin/darwin-arm64/helper", "x64"),
		).toBe("arm64");
		expect(
			expectedMachOArchitecture("app/electron/native/bin/darwin-x64/helper", "arm64"),
		).toBe("x86_64");
		expect(expectedMachOArchitecture("Recordly.app/Contents/MacOS/Recordly", "x64")).toBe(
			"x86_64",
		);
	});

	it("reports a binary that lacks the required architecture", () => {
		expect(
			collectArchitectureErrors("Recordly.app/Contents/MacOS/Recordly", "arm64", "x64"),
		).toEqual(["Recordly.app/Contents/MacOS/Recordly does not contain x86_64 (found: arm64)"]);
	});
});
