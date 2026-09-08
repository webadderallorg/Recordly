import {
	parseIOSCaptureCommand,
	type IOSRecordingOptions,
} from "../../../../src/shared/iosCapture";

export function assertIOSCaptureSender(input: {
	knownWindow: boolean;
	mainFrame: boolean;
	url: string;
	trustedUrls: readonly string[];
}): void {
	let trusted = false;
	try {
		const actual = new URL(input.url);
		trusted = input.trustedUrls.some((base) => {
			const expected = new URL(base);
			return (
				actual.protocol === expected.protocol &&
				actual.host === expected.host &&
				actual.pathname === expected.pathname
			);
		});
	} catch {
		/* Malformed and foreign URLs are untrusted. */
	}
	if (!input.knownWindow || !input.mainFrame || !trusted) throw new Error("INVALID_REQUEST");
}

export function parseIOSPrepareInput(value: unknown): {
	deviceToken: string;
	generation: number;
	options: IOSRecordingOptions;
} {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("INVALID_REQUEST");
	const input = value as Record<string, unknown>;
	if (Object.keys(input).some((key) => !["deviceToken", "generation", "options"].includes(key)))
		throw new Error("INVALID_REQUEST");
	const command = parseIOSCaptureCommand({
		protocolVersion: 1,
		requestId: "ipc",
		command: "prepare",
		generation: input.generation,
		payload: { deviceToken: input.deviceToken, options: input.options },
	});
	if (command.command !== "prepare") throw new Error("INVALID_REQUEST");
	return { generation: command.generation, ...command.payload };
}
