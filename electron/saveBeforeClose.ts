type Outcome = "save" | "discard" | "cancel" | "save-failed";

type Options = {
	requestSave: () => void;
	subscribe: (done: (outcome: Outcome) => void) => () => void;
	offerDiscard: () => Promise<boolean>;
	close: () => void;
	cancel: () => void;
	timeoutMs?: number;
};

/**
 * Asks the renderer to resolve unsaved changes (save/discard/cancel) before
 * closing, with a native-dialog recovery path if the renderer never replies
 * or an explicit save fails.
 */
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
	const done = (outcome: Outcome) => {
		if (!pending || recovering || disposed) return;
		cleanup();
		if (outcome === "save" || outcome === "discard") {
			pending = false;
			options.close();
			return;
		}
		if (outcome === "cancel") {
			pending = false;
			options.cancel();
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
				timer = setTimeout(() => done("save-failed"), options.timeoutMs ?? 30_000);
				options.requestSave();
			} catch {
				done("save-failed");
			}
		},
		dispose() {
			disposed = true;
			pending = false;
			cleanup();
		},
	};
}
