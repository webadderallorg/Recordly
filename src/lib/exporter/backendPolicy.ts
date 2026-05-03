import type { ExportRenderBackend } from "./types";

export type LightningRuntimePlatform = "darwin" | "win32" | "linux" | "unknown";

export function normalizeLightningRuntimePlatform(
	platformHint: string | null | undefined,
): LightningRuntimePlatform {
	if (!platformHint) {
		return "unknown";
	}

	if (/win/i.test(platformHint)) {
		return "win32";
	}

	if (/linux/i.test(platformHint)) {
		return "linux";
	}

	if (/mac|iphone|ipad|ipod/i.test(platformHint)) {
		return "darwin";
	}

	return "unknown";
}

export function shouldPreferNativeAutoBackend(_platform: LightningRuntimePlatform): boolean {
	return false;
}

export function getDefaultLightningRenderBackend(): ExportRenderBackend {
	return "webgl";
}
