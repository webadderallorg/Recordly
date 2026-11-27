export async function withMediaDeadline<T>(
	work: (signal: AbortSignal) => Promise<T>,
	{ signal, timeoutMs, message }: { signal?: AbortSignal; timeoutMs: number; message: string },
): Promise<T> {
	signal?.throwIfAborted();
	const deadline = new AbortController();
	const attemptSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
	const timer = setTimeout(() => {
		deadline.abort(new DOMException(message, "TimeoutError"));
	}, timeoutMs);
	let onAbort: (() => void) | undefined;
	const interrupted = new Promise<never>((_, reject) => {
		onAbort = () => reject(attemptSignal.reason);
		attemptSignal.addEventListener("abort", onAbort, { once: true });
	});
	try {
		return await Promise.race([work(attemptSignal), interrupted]);
	} finally {
		clearTimeout(timer);
		if (onAbort) attemptSignal.removeEventListener("abort", onAbort);
	}
}
