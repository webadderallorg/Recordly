// encoderError also carries mux failures. Preserve error identity while keeping
// recovery eligibility specific to failures from the actual VideoEncoder API.
const encoderFailures = new WeakSet<Error>();

export function markWebCodecsEncoderFailure(error: unknown): Error {
	const failure = error instanceof Error ? error : new Error(String(error));
	encoderFailures.add(failure);
	return failure;
}

export function isWebCodecsEncoderFailure(error: unknown): boolean {
	return error instanceof Error && encoderFailures.has(error);
}
