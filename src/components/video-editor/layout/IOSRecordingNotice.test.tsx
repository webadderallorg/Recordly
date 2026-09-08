import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CaptureMetadata } from "@/shared/iosCapture";
import { IOSRecordingNotice } from "./IOSRecordingNotice";
vi.mock("@/contexts/I18nContext", () => ({ useScopedT: () => (key: string) => key }));
const metadata = {
	version: 1,
	sourceKind: "ios-device",
	mode: "passthrough",
	deviceAudioRecorded: false,
	narrationRecorded: false,
	interrupted: true,
	stopReason: "FORMAT_CHANGED",
} as CaptureMetadata;
describe("retained device recording notice", () => {
	it("announces interruption and absent audio from committed metadata", () => {
		const html = renderToStaticMarkup(<IOSRecordingNotice metadata={metadata} />);
		expect(html).toContain('role="status"');
		expect(html).toContain("ios.recordingNotice.interrupted");
		expect(html).toContain("ios.recordingNotice.FORMAT_CHANGED");
		expect(html).toContain("ios.recordingNotice.deviceAudioMissing");
		expect(html).not.toContain("ios.recordingNotice.deviceAudioRecorded");
	});
	it("retains an unknown interruption without guessing a reason", () => {
		const html = renderToStaticMarkup(
			<IOSRecordingNotice metadata={{ ...metadata, stopReason: "recovered-interruption" }} />,
		);
		expect(html).toContain("ios.recordingNotice.interrupted");
		expect(html).not.toContain("FORMAT_CHANGED");
	});
	it("does not warn that an intentional video-only take was interrupted", () => {
		const html = renderToStaticMarkup(
			<IOSRecordingNotice
				metadata={{ ...metadata, interrupted: false, stopReason: "user-stop" }}
			/>,
		);
		expect(html).toContain("ios.recordingNotice.deviceAudioMissing");
		expect(html).not.toContain("ios.recordingNotice.interrupted");
	});
	it("does not alter ordinary editor sources", () => {
		expect(renderToStaticMarkup(<IOSRecordingNotice />)).toBe("");
	});
});
