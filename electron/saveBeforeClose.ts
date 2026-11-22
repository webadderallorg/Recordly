type Options = {
	requestSave: () => void;
	subscribe: (done: (saved: boolean) => void) => () => void;
	offerDiscard: () => Promise<boolean>;
	close: () => void;
	cancel: () => void;
	timeoutMs?: number;
};

/** Saves before closing, with a cancellable recovery path for failed or missing replies. */
export function createSaveBeforeCloseController(options: Options) {
	let pending = false;
	let recovering = false;
	let disposed = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let unsubscribe: (() => void) | undefined;
	const cleanup = () => {
		if (timer) clearTimeout(timer);
		timer = undefined;
		unsubscribe?.();
		unsubscribe = undefined;
	};
	const done = (saved: boolean) => {
		if (!pending || recovering || disposed) return;
		cleanup();
		if (saved) {
			pending = false;
			options.close();
			return;
		}
		recovering = true;
		void Promise.resolve()
			.then(options.offerDiscard)
			.then((discard) => {
				if (disposed) return;
				if (discard) options.close();
				else options.cancel();
			})
			.catch(() => {
				if (!disposed) options.cancel();
			})
			.finally(() => {
				pending = false;
				recovering = false;
			});
	};
	return {
		start() {
			if (pending || disposed) return;
			pending = true;
			try {
				unsubscribe = options.subscribe(done);
				timer = setTimeout(() => done(false), options.timeoutMs ?? 30_000);
				options.requestSave();
			} catch {
				done(false);
			}
		},
		dispose() {
			disposed = true;
			pending = false;
			cleanup();
		},
	};
}
