/** Share one asynchronous operation with every caller until it settles. */
export function createSingleFlight<T>() {
	let inFlight: Promise<T> | null = null;

	return (operation: () => Promise<T>) => {
		if (inFlight) {
			return inFlight;
		}

		inFlight = (async () => {
			try {
				return await operation();
			} finally {
				inFlight = null;
			}
		})();
		return inFlight;
	};
}

/** Skip overlapping asynchronous operations and allow another after settlement. */
export function createNonOverlappingRunner() {
	let running = false;

	return async (operation: () => Promise<void>) => {
		if (running) {
			return false;
		}

		running = true;
		try {
			await operation();
			return true;
		} finally {
			running = false;
		}
	};
}
