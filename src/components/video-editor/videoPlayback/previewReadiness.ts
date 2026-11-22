type FrameListener = { postrender(): void };

/** A decoded video is not a preview until its composed GPU frame has been drawn. */
export function subscribePreviewReadiness({
	runner,
	isFrameReady,
	onChange,
}: {
	runner: {
		readonly name?: string | null;
		add(listener: FrameListener): unknown;
		remove(listener: FrameListener): unknown;
	};
	isFrameReady: () => boolean;
	onChange: (ready: boolean) => void;
}) {
	let ready = false;
	let disposed = false;
	onChange(false);
	const listener = {
		postrender() {
			if (disposed || ready || !isFrameReady()) return;
			ready = true;
			onChange(true);
		},
	};
	runner.add(listener);
	return () => {
		disposed = true;
		// React can destroy the renderer before the media effect is cleaned up.
		if (runner.name !== null) runner.remove(listener);
		onChange(false);
	};
}
