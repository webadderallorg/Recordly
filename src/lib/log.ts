/**
 * Shared lightweight wall-clock log prefix formatter for the renderer bundle.
 *
 * Produces a zero-padded `HH:MM:SS.mmm` prefix so Recordly's stop→mux→editor→
 * native-export diagnostics are sortable/correlatable across the renderer and
 * main-process bundles. Use it as the first console argument, e.g.
 * `console.log(formatLogTs(), "[video-muxer] finalize", ...)`. Never wrap or
 * modify the existing structured payloads.
 */
export function formatLogTs(date: Date = new Date()): string {
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	const seconds = String(date.getSeconds()).padStart(2, "0");
	const millis = String(date.getMilliseconds()).padStart(3, "0");
	return `${hours}:${minutes}:${seconds}.${millis}`;
}
