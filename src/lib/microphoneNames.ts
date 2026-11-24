import { loadAppSetting } from "./appSettings";

export const MICROPHONE_NAMES_KEY = "recordly.microphoneNames.v1";

type Input = { deviceId: string; label: string; labelUnavailable?: boolean };
type MicrophoneName = Input & { name: string; origin: string; uniqueLabel: boolean };

export function canNameMicrophone({ deviceId, label, labelUnavailable }: Input) {
	return Boolean(
		deviceId &&
			label &&
			!labelUnavailable &&
			deviceId !== "default" &&
			deviceId !== "communications",
	);
}

export function loadMicrophoneNames(): MicrophoneName[] {
	const stored = loadAppSetting<unknown>(MICROPHONE_NAMES_KEY);
	if (!Array.isArray(stored)) return [];
	return stored.filter(
		(entry): entry is MicrophoneName =>
			entry &&
			typeof entry.deviceId === "string" &&
			typeof entry.label === "string" &&
			typeof entry.name === "string" &&
			typeof entry.origin === "string" &&
			typeof entry.uniqueLabel === "boolean",
	);
}

export function findMicrophoneName(
	input: Input,
	inputs: Input[],
	names: MicrophoneName[],
	origin: string,
) {
	if (!canNameMicrophone(input)) return;
	const exact = names.find((entry) => entry.deviceId === input.deviceId);
	if (exact) return exact;
	// The packaged renderer can start on a new port. Chromium scopes device IDs to its origin.
	const matches = names.filter((entry) => entry.label === input.label);
	const [match] = matches;
	if (
		matches.length === 1 &&
		match.uniqueLabel &&
		match.origin !== origin &&
		inputs.filter((other) => other.label === input.label).length === 1 &&
		!inputs.some((other) => other.deviceId === match.deviceId)
	)
		return match;
}

export function updateMicrophoneName(
	input: Input,
	inputs: Input[],
	names: MicrophoneName[],
	origin: string,
	value: string,
): MicrophoneName[] {
	const previous = findMicrophoneName(input, inputs, names, origin);
	const next = names.filter((entry) => entry !== previous);
	const name = value.trim();
	if (canNameMicrophone(input) && name && name !== input.label) {
		next.push({
			deviceId: input.deviceId,
			label: input.label,
			name,
			origin,
			uniqueLabel: inputs.filter((other) => other.label === input.label).length === 1,
		});
	}
	return next;
}
