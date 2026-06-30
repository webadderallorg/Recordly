export function createSourcePreviewRequestGate() {
	let currentRequestId = 0;

	return {
		next() {
			currentRequestId += 1;
			return currentRequestId;
		},
		isCurrent(requestId: number) {
			return requestId === currentRequestId;
		},
	};
}
