import type { RecordlyExtensionAPI } from "./types";
import type { ExtensionHostApiContext } from "./extensionHostShared";

interface QueryApiArgs {
	extensionId: string;
	disposables: (() => void)[];
	host: ExtensionHostApiContext;
}

export function createExtensionQueryApi({
	extensionId,
	disposables,
	host,
}: QueryApiArgs): Pick<
	RecordlyExtensionAPI,
	| "getVideoInfo"
	| "getVideoLayout"
	| "getCursorAt"
	| "getSmoothedCursor"
	| "getZoomState"
	| "getShadowConfig"
	| "getKeystrokesInRange"
	| "getAspectRatio"
	| "getActiveFrame"
	| "isExtensionActive"
	| "getPlaybackState"
	| "getCanvasDimensions"
	| "onSettingChange"
	| "getAllSettings"
> {
	return {
		getVideoInfo() {
			const videoInfo = host.getVideoInfo();
			return videoInfo ? { ...videoInfo } : null;
		},

		getVideoLayout() {
			const layout = host.getVideoLayout();
			if (!layout) return null;
			return {
				maskRect: { ...layout.maskRect },
				canvasWidth: layout.canvasWidth,
				canvasHeight: layout.canvasHeight,
				borderRadius: layout.borderRadius,
				padding: layout.padding,
			};
		},

		getCursorAt(timeMs: number) {
			const telemetry = host.getCursorTelemetry();
			if (telemetry.length === 0) return null;
			if (timeMs <= telemetry[0].timeMs) return { ...telemetry[0], timeMs };
			if (timeMs >= telemetry[telemetry.length - 1].timeMs) {
				return { ...telemetry[telemetry.length - 1], timeMs };
			}

			let low = 0;
			let high = telemetry.length - 1;
			while (low < high - 1) {
				const mid = (low + high) >> 1;
				if (telemetry[mid].timeMs <= timeMs) {
					low = mid;
				} else {
					high = mid;
				}
			}

			const start = telemetry[low];
			const end = telemetry[high];
			const span = end.timeMs - start.timeMs;
			const fraction = span > 0 ? (timeMs - start.timeMs) / span : 0;
			return {
				...start,
				cx: start.cx + (end.cx - start.cx) * fraction,
				cy: start.cy + (end.cy - start.cy) * fraction,
				timeMs,
			};
		},

		getSmoothedCursor() {
			const cursor = host.getSmoothedCursor();
			if (!cursor) return null;
			return {
				timeMs: cursor.timeMs,
				cx: cursor.cx,
				cy: cursor.cy,
				trail: cursor.trail.map((point) => ({ ...point })),
			};
		},

		getZoomState() {
			const zoomState = host.getZoomState();
			return zoomState ? { ...zoomState } : null;
		},

		getShadowConfig() {
			return { ...host.getShadowConfig() };
		},

		getKeystrokesInRange(startMs: number, endMs: number) {
			return host
				.getKeystrokeEvents()
				.filter((event) => event.timeMs >= startMs && event.timeMs <= endMs)
				.map((event) => ({ ...event }));
		},

		getAspectRatio() {
			const layout = host.getVideoLayout();
			return layout ? layout.canvasWidth / layout.canvasHeight : null;
		},

		getActiveFrame() {
			return host.getActiveFrame();
		},

		isExtensionActive(extId: string) {
			return host.activeExtensions.has(extId);
		},

		getPlaybackState() {
			const playbackState = host.getPlaybackState();
			return playbackState ? { ...playbackState } : null;
		},

		getCanvasDimensions() {
			const layout = host.getVideoLayout();
			return layout ? { width: layout.canvasWidth, height: layout.canvasHeight } : null;
		},

		onSettingChange(callback: (settingId: string, value: unknown) => void): () => void {
			if (!host.settingChangeCallbacks.has(extensionId)) {
				host.settingChangeCallbacks.set(extensionId, new Set());
			}
			host.settingChangeCallbacks.get(extensionId)!.add(callback);

			const dispose = () => {
				const callbacks = host.settingChangeCallbacks.get(extensionId);
				if (callbacks) {
					callbacks.delete(callback);
					if (callbacks.size === 0) host.settingChangeCallbacks.delete(extensionId);
				}
			};
			disposables.push(dispose);
			return dispose;
		},

		getAllSettings(): Record<string, unknown> {
			host.ensureExtensionSettingsLoaded(extensionId);
			return { ...(host.extensionSettings.get(extensionId) ?? {}) };
		},
	};
}