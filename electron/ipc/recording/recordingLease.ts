import { randomUUID } from "node:crypto";

export interface RecordingLease {
	owner: "desktop" | "ios-device";
	token: string;
}

let current: RecordingLease | null = null;
let desktopLease: RecordingLease | null = null;

export function acquireRecordingLease(owner: RecordingLease["owner"]): RecordingLease {
	if (current) throw new Error("RECORDING_BUSY");
	current = Object.freeze({ owner, token: randomUUID() });
	return current;
}

export function releaseRecordingLease(lease: RecordingLease): void {
	if (current?.owner === lease.owner && current.token === lease.token) current = null;
}

export function getRecordingLease(): RecordingLease | null {
	return current;
}

export function beginDesktopRecording(): RecordingLease {
	desktopLease = acquireRecordingLease("desktop");
	return desktopLease;
}
export function endDesktopRecording(expected?: RecordingLease | null): void {
	if (expected !== undefined && desktopLease?.token !== expected?.token) return;
	if (desktopLease) releaseRecordingLease(desktopLease);
	desktopLease = null;
}
