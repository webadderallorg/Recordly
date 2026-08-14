/**
 * Shared lightweight wall-clock log prefix formatter for the main-process
 * bundle.
 *
 * This is the main-process counterpart of `src/lib/log.ts`. The renderer and
 * main bundles are compiled separately, so each ships its own copy of the same
 * small formatter. Produces a zero-padded `HH:MM:SS.mmm` prefix used as the
 * first console argument, e.g.
 * `console.log(formatLogTs(), "[stop-native] helper stopped", path)`. Never
 * wrap or modify the existing structured payloads.
 */
export function formatLogTs(date: Date = new Date()): string {
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	const seconds = String(date.getSeconds()).padStart(2, "0");
	const millis = String(date.getMilliseconds()).padStart(3, "0");
	return `${hours}:${minutes}:${seconds}.${millis}`;
}
