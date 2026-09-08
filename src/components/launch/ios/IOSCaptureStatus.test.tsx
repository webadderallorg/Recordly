import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IOSCaptureStatus } from "./IOSCaptureStatus";
import { IOSDevicePanel } from "./IOSDevicePanel";
import { EMPTY_IOS_SNAPSHOT } from "@/hooks/useIOSDeviceRecorder";
vi.mock("@/contexts/I18nContext", () => ({ useScopedT: () => (key: string) => key }));
const source = {
	sourceType: "ios-device" as const,
	id: "ios-device:p",
	deviceToken: "p",
	displayName: "Phone",
	generation: 1,
	deviceAudio: "unknown" as const,
};
describe("device recording UI", () => {
	it("does not present recording or elapsed time while arming", () => {
		const html = renderToStaticMarkup(
			<IOSCaptureStatus
				snapshot={{ ...EMPTY_IOS_SNAPSHOT, phase: "starting", source, elapsedMs: 5000 }}
				onStop={() => undefined}
				onCancel={() => undefined}
			/>,
		);
		expect(html).toContain("ios.status.starting");
		expect(html).not.toContain("ios.status.recording");
		expect(html).not.toContain("ios.elapsed");
		expect(html).toContain("recording.stop");
	});
	it("announces status without announcing every native timer tick", () => {
		const html = renderToStaticMarkup(
			<IOSCaptureStatus
				snapshot={{ ...EMPTY_IOS_SNAPSHOT, phase: "recording", source, elapsedMs: 65000 }}
				onStop={() => undefined}
				onCancel={() => undefined}
			/>,
		);
		expect(html).toContain('aria-live="polite"');
		expect(html).toContain("1:05");
		expect(html).not.toContain("recording.pause");
		expect(html).not.toContain("webcam");
	});
	it("keeps duplicate device names distinguishable and fits observed preview aspect", () => {
		const html = renderToStaticMarkup(
			<IOSDevicePanel
				snapshot={{
					...EMPTY_IOS_SNAPSHOT,
					phase: "ready",
					source,
					devices: [source, { ...source, id: "ios-device:q", deviceToken: "q" }],
				}}
				previewUrl="blob:test"
				onSelectDevice={() => undefined}
				onOptionsChange={() => undefined}
				onRetry={() => undefined}
				onRelease={() => undefined}
			/>,
		);
		expect(html).toContain("Phone (1)");
		expect(html).toContain("Phone (2)");
		expect(html).toContain("object-contain");
		expect(html).toContain("ios.availability.unknown");
		expect(html).not.toContain("Phone locked");
	});
});

it("renders native warnings in the HUD and picker without an active-audio claim", () => {
	const snapshot = {
		...EMPTY_IOS_SNAPSHOT,
		phase: "recording" as const,
		source,
		options: { deviceAudio: true, microphoneToken: null },
		warningCodes: ["AUDIO_INTERRUPTED", "DISK_SPACE_LOW", "FORMAT_CHANGED"],
	};
	const status = renderToStaticMarkup(
		<IOSCaptureStatus
			snapshot={snapshot}
			onStop={() => undefined}
			onCancel={() => undefined}
		/>,
	);
	const picker = renderToStaticMarkup(
		<IOSDevicePanel
			snapshot={snapshot}
			previewUrl={null}
			onSelectDevice={() => undefined}
			onOptionsChange={() => undefined}
			onRetry={() => undefined}
			onRelease={() => undefined}
		/>,
	);
	for (const html of [status, picker]) {
		expect(html).toContain("ios.warnings.AUDIO_INTERRUPTED");
		expect(html).toContain("ios.warnings.DISK_SPACE_LOW");
		expect(html).toContain("ios.warnings.FORMAT_CHANGED");
		expect(html).toContain('aria-live="polite"');
	}
	expect(status).toContain("ios.audioInterrupted");
	expect(status).not.toContain(">ios.deviceAudio<");
});
