import type { IOSRecordingOptions } from "../../../../src/shared/iosCapture";

export async function prepareIOSPermissions(
	options: IOSRecordingOptions,
	permissions: {
		status: (media: "camera" | "microphone") => string;
		request: (media: "camera" | "microphone") => Promise<boolean>;
	},
): Promise<void> {
	const media: Array<"camera" | "microphone"> = ["camera"];
	if (options.deviceAudio || options.microphoneToken) media.push("microphone");
	for (const kind of media) {
		const status = permissions.status(kind);
		if (status === "granted") continue;
		if (status !== "not-determined" || !(await permissions.request(kind)))
			throw new Error("PERMISSION_DENIED");
	}
}
