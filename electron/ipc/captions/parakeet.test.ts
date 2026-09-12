import { describe, expect, it, vi } from "vitest";
import { SHERPA_ONNX_RUNTIME_ASSETS } from "../constants";
import { getBundledSherpaOnnxExecutableCandidates, getNativeArchTag } from "../paths/binaries";
import { findExistingSherpaOnnxExecutable, getSherpaOnnxRuntimeStatus } from "./parakeet";

// Mock electron app
vi.mock("electron", () => {
	return {
		app: {
			isPackaged: false,
			getPath: vi.fn((name: string) => {
				if (name === "userData") return "C:\\MockUserData";
				if (name === "temp") return "C:\\MockTemp";
				return "C:\\Mock";
			}),
			getAppPath: vi.fn(() => "C:\\MockAppPath"),
		},
	};
});

describe("Sherpa-ONNX Runtime Configuration & Resolution", () => {
	it("has precompiled runtime asset definitions for all supported architectures", () => {
		const requiredPlatforms = [
			"win32-x64",
			"win32-arm64",
			"darwin-x64",
			"darwin-arm64",
			"linux-x64",
			"linux-arm64",
		];

		for (const tag of requiredPlatforms) {
			const asset = SHERPA_ONNX_RUNTIME_ASSETS[tag];
			expect(asset, `Asset for ${tag} should be defined`).toBeDefined();
			expect(asset.url).toMatch(
				/^https:\/\/github\.com\/k2-fsa\/sherpa-onnx\/releases\/download\//,
			);
			const platformSlug = tag.startsWith("win32")
				? "win"
				: tag.startsWith("darwin")
					? "osx"
					: "linux";
			expect(asset.archiveName).toContain(platformSlug);
			if (tag.startsWith("win32")) {
				expect(asset.binaryName).toBe("sherpa-onnx-offline.exe");
			} else {
				expect(asset.binaryName).toBe("sherpa-onnx-offline");
			}
		}
	});

	it("generates candidates that cover UserData runtime, prebundled directories, and platform folders", () => {
		const candidates = getBundledSherpaOnnxExecutableCandidates();
		expect(candidates.length).toBeGreaterThan(0);

		// Should include UserData runtime paths
		const hasUserDataRuntime = candidates.some(
			(c) =>
				c.includes("MockUserData") && (c.includes("runtime") || c.includes("sherpa-onnx")),
		);
		expect(hasUserDataRuntime).toBe(true);

		// Binary name should match the current platform convention
		const expectedBinary =
			process.platform === "win32" ? "sherpa-onnx-offline.exe" : "sherpa-onnx-offline";
		const hasBinary = candidates.some((c) => c.endsWith(expectedBinary));
		expect(hasBinary).toBe(true);
	});

	it("returns runtime status object with success and exists flags", async () => {
		const status = await getSherpaOnnxRuntimeStatus();
		expect(status).toBeDefined();
		expect(typeof status.success).toBe("boolean");
		expect(typeof status.exists).toBe("boolean");
	});
});
