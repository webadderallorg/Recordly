type LoadingResult = { error?: string };

/** Let a new editor paint its skeleton before recording persistence finishes. */
export function createRecordingEditorLoading() {
	let pending: {
		owner: number;
		promise: Promise<LoadingResult>;
		resolve: (result: LoadingResult) => void;
	} | null = null;
	let result: LoadingResult = {};
	return {
		get active() {
			return pending !== null;
		},
		begin(owner: number) {
			if (pending) return false;
			result = {};
			let resolve!: (result: LoadingResult) => void;
			const promise = new Promise<LoadingResult>((done) => {
				resolve = done;
			});
			pending = { owner, promise, resolve };
			return true;
		},
		wait() {
			return pending?.promise ?? Promise.resolve(result);
		},
		finish(owner: number, error?: string) {
			if (!pending || pending.owner !== owner) return false;
			result = error ? { error } : {};
			pending.resolve(result);
			pending = null;
			return true;
		},
		clearError() {
			result = {};
		},
	};
}

export const recordingEditorLoading = createRecordingEditorLoading();
