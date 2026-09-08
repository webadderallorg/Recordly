import { afterEach, expect, it } from "vitest";
import {
	acquireRecordingLease,
	beginDesktopRecording,
	endDesktopRecording,
	getRecordingLease,
	releaseRecordingLease,
} from "./recordingLease";

afterEach(() => {
	const current = getRecordingLease();
	if (current) releaseRecordingLease(current);
});
it("rejects competing mobile and desktop capture", () => {
	const mobile = acquireRecordingLease("ios-device");
	expect(() => acquireRecordingLease("desktop")).toThrow("RECORDING_BUSY");
	expect(getRecordingLease()).toEqual(mobile);
});
it("duplicate or stale release cannot release a later owner's lease", () => {
	const old = acquireRecordingLease("desktop");
	releaseRecordingLease(old);
	releaseRecordingLease(old);
	const current = acquireRecordingLease("ios-device");
	releaseRecordingLease(old);
	expect(getRecordingLease()).toEqual(current);
	expect(() => acquireRecordingLease("ios-device")).toThrow("RECORDING_BUSY");
});
it("an old desktop helper close cannot release a new desktop recording", () => {
	const old = beginDesktopRecording();
	endDesktopRecording(old);
	const current = beginDesktopRecording();
	endDesktopRecording(old);
	expect(getRecordingLease()).toEqual(current);
	endDesktopRecording(current);
	expect(getRecordingLease()).toBeNull();
});
