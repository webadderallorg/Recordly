import type { ExportBackendPreference, ExportRenderBackend } from "./types";

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
	return _platform === "darwin" || _platform === "win32";
}

export type LightningExportRoute = "native-static-layout" | "breeze-stream" | "webcodecs";

export interface LightningExportRouteDecision {
	route: LightningExportRoute;
	status: "selected" | "fallback" | "rejected";
	reasons: string[];
}

export interface LightningExportRoutePlan {
	selectedRoute: LightningExportRoute;
	decisions: LightningExportRouteDecision[];
}

// Disabled while stabilizing v1.3.0: the Windows auto static-layout probe can
// leave Lightning at "Preparing export..." before the stable streaming fallback.
const WINDOWS_AUTO_STATIC_LAYOUT_FIRST_ENABLED = false;

export function shouldPreferNativeStaticLayoutBeforeBreeze(
	platform: LightningRuntimePlatform,
	backendPreference: ExportBackendPreference,
): boolean {
	return (
		WINDOWS_AUTO_STATIC_LAYOUT_FIRST_ENABLED &&
		backendPreference === "auto" &&
		platform === "win32"
	);
}

export function planLightningExportRoutes(options: {
	backendPreference: ExportBackendPreference;
	platform: LightningRuntimePlatform;
	nativeStaticLayoutAvailable: boolean;
	nativeStaticLayoutSkipReasons?: string[];
}): LightningExportRoutePlan {
	const decisions: LightningExportRouteDecision[] = [];
	const nativeStaticLayoutSkipReasons = options.nativeStaticLayoutSkipReasons ?? [];
	const canUseNativeStaticLayout =
		options.nativeStaticLayoutAvailable && nativeStaticLayoutSkipReasons.length === 0;

	const addNativeStaticLayoutDecision = (status: LightningExportRouteDecision["status"]) => {
		decisions.push({
			route: "native-static-layout",
			status,
			reasons: canUseNativeStaticLayout
				? ["visually-compatible"]
				: nativeStaticLayoutSkipReasons.length > 0
					? nativeStaticLayoutSkipReasons
					: ["native-static-unavailable"],
		});
	};

	if (options.backendPreference === "webcodecs") {
		decisions.push({
			route: "webcodecs",
			status: "selected",
			reasons: ["user-selected-webcodecs"],
		});
		return { selectedRoute: "webcodecs", decisions };
	}

	const preferStaticFirst =
		options.backendPreference === "breeze" ||
		shouldPreferNativeStaticLayoutBeforeBreeze(options.platform, options.backendPreference);

	if (preferStaticFirst) {
		addNativeStaticLayoutDecision(canUseNativeStaticLayout ? "selected" : "rejected");
		decisions.push({
			route: "breeze-stream",
			status: canUseNativeStaticLayout ? "fallback" : "selected",
			reasons: [
				options.backendPreference === "breeze"
					? "user-selected-breeze"
					: "native-static-layout-not-auto-default",
			],
		});
		decisions.push({
			route: "webcodecs",
			status: "fallback",
			reasons: ["breeze-unavailable-fallback"],
		});
		return {
			selectedRoute: canUseNativeStaticLayout ? "native-static-layout" : "breeze-stream",
			decisions,
		};
	}

	if (options.backendPreference === "auto" && shouldPreferNativeAutoBackend(options.platform)) {
		decisions.push({
			route: "native-static-layout",
			status: "rejected",
			reasons: ["platform-does-not-use-native-static-layout"],
		});
		decisions.push({
			route: "breeze-stream",
			status: "selected",
			reasons: ["platform-prefers-native-streaming"],
		});
		decisions.push({
			route: "webcodecs",
			status: "fallback",
			reasons: ["breeze-unavailable-fallback"],
		});
		return { selectedRoute: "breeze-stream", decisions };
	}

	decisions.push({
		route: "webcodecs",
		status: "selected",
		reasons: ["default-webcodecs-first"],
	});
	decisions.push({
		route: "breeze-stream",
		status: "fallback",
		reasons: ["webcodecs-software-or-unavailable-fallback"],
	});
	return { selectedRoute: "webcodecs", decisions };
}

export function getDefaultLightningRenderBackend(): ExportRenderBackend {
	return "webgl";
}
