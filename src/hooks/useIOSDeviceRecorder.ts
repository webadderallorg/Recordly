import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
	IOS_CAPTURE_CAPABILITIES,
	type IOSCaptureSnapshot,
	type IOSDeviceSource,
	type IOSRecordingOptions,
} from "@/shared/iosCapture";
import type { IOSCaptureAPI } from "@/shared/iosCaptureAPI";

export const EMPTY_IOS_SNAPSHOT: IOSCaptureSnapshot = {
	sequence: 0,
	generation: 0,
	sessionId: null,
	phase: "unavailable",
	devices: [],
	microphones: [],
	source: null,
	options: null,
	format: null,
	mode: null,
	elapsedMs: 0,
	acceptedVideoSamples: 0,
	warningCodes: [],
	error: null,
};

/** View adapter only. Session lifetime and editor handoff belong to main. */
export function createIOSRecorderAdapter(api: IOSCaptureAPI | undefined) {
	let snapshot = EMPTY_IOS_SNAPSHOT;
	const listeners = new Set<() => void>();
	const pending = new Map<string, Promise<unknown>>();
	const accept = (next: IOSCaptureSnapshot) => {
		if (next.sequence < snapshot.sequence) return;
		snapshot = next;
		listeners.forEach((listener) => listener());
	};
	const requireAPI = () => {
		if (!api) throw new Error("HELPER_UNAVAILABLE");
		return api;
	};
	const session = () => {
		if (!snapshot.sessionId) throw new Error("INVALID_REQUEST");
		return snapshot.sessionId;
	};
	const once = <T>(key: string, action: () => Promise<T>): Promise<T> => {
		const existing = pending.get(key);
		if (existing) return existing as Promise<T>;
		const promise = Promise.resolve()
			.then(action)
			.finally(() => pending.delete(key));
		pending.set(key, promise);
		return promise;
	};
	return {
		accept,
		getSnapshot: () => snapshot,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		refresh: async () => {
			accept(await requireAPI().getSnapshot());
		},
		prepare: (source: IOSDeviceSource, options: IOSRecordingOptions) =>
			once(
				`prepare:${source.deviceToken}:${source.generation}:${JSON.stringify(options)}`,
				async () => {
					const next = await requireAPI().prepare({
						deviceToken: source.deviceToken,
						generation: source.generation,
						options,
					});
					accept(next);
					return next;
				},
			),
		startPrepared: (expectedSessionId = snapshot.sessionId) =>
			once("start", async () => {
				const next = await requireAPI().getSnapshot();
				accept(next);
				if (next.sessionId !== expectedSessionId) throw new Error("INVALID_REQUEST");
				if (next.phase !== "ready" || !next.format || !next.mode || !next.sessionId)
					throw new Error("NO_VIDEO_SAMPLES");
				accept(await requireAPI().start(next.sessionId));
			}),
		stop: () => once("stop", () => requireAPI().stop(session())),
		cancel: (discardAcceptedMedia: boolean) =>
			once("cancel", () => requireAPI().cancel(session(), discardAcceptedMedia)),
		release: () => once("release", () => requireAPI().release(session())),
		capabilities: IOS_CAPTURE_CAPABILITIES,
	};
}

export function useIOSDeviceRecorder() {
	const api = window.electronAPI?.iosCapture;
	const adapter = useMemo(() => createIOSRecorderAdapter(api), [api]);
	const snapshot = useSyncExternalStore(
		adapter.subscribe,
		adapter.getSnapshot,
		adapter.getSnapshot,
	);
	const [enabled, setEnabled] = useState(false);
	useEffect(() => {
		if (!api) return;
		let live = true;
		const off = api.onState(adapter.accept);
		void api
			.getCapabilities()
			.then((value) => {
				if (live) setEnabled(value.enabled);
			})
			.catch(() => undefined);
		void adapter.refresh().catch(() => undefined);
		return () => {
			live = false;
			off();
		};
	}, [api, adapter]);
	return { ...adapter, snapshot, enabled };
}

/** Preview ownership is independent of capture ownership. Never releases the session. */
export function useIOSPreview(snapshot: IOSCaptureSnapshot, visible: boolean) {
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const api = window.electronAPI?.iosCapture;
	useEffect(() => {
		if (!api || !visible || snapshot.phase === "preparing") return;
		const off = subscribeIOSPreview(api, snapshot.generation, setPreviewUrl);
		return () => {
			off();
			setPreviewUrl(null);
		};
	}, [api, visible, snapshot.generation, snapshot.phase]);
	return previewUrl;
}

export async function startIOSRecordingAfterCountdown({
	delay,
	countdown,
	start,
	isCancelled,
	setActive,
}: {
	delay: number;
	countdown: (seconds: number) => Promise<{ success: boolean; cancelled?: boolean }>;
	start: () => Promise<void>;
	isCancelled: () => boolean;
	setActive: (active: boolean) => void;
}) {
	try {
		if (delay > 0) {
			setActive(true);
			const result = await countdown(delay);
			if (!result.success || result.cancelled) return;
		}
		if (!isCancelled()) await start();
	} finally {
		setActive(false);
	}
}

export function subscribeIOSPreview(
	api: IOSCaptureAPI,
	generation: number,
	present: (url: string) => void,
	urls: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> = URL,
) {
	let url: string | null = null;
	let sequence = -1;
	let live = true;
	const off = api.onPreview((frame) => {
		if (
			!live ||
			frame.generation !== generation ||
			frame.sequence <= sequence ||
			frame.jpeg.byteLength > 128 * 1024 ||
			frame.jpeg.byteLength === 0
		)
			return;
		sequence = frame.sequence;
		const next = urls.createObjectURL(
			new Blob([new Uint8Array(frame.jpeg)], { type: "image/jpeg" }),
		);
		if (url) urls.revokeObjectURL(url);
		url = next;
		present(next);
	});
	void api.setPreviewEnabled(true).catch(() => undefined);
	return () => {
		live = false;
		off();
		void api.setPreviewEnabled(false).catch(() => undefined);
		if (url) urls.revokeObjectURL(url);
	};
}
