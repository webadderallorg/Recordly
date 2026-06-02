export type WindowsCaptureSourceLike = {
	id?: string;
	display_id?: string;
	sourceType?: string;
};

export type WindowsCaptureDisplayBounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type WindowsCaptureDisplayLike = {
	id: number;
	bounds: WindowsCaptureDisplayBounds;
};

export type ResolvedWindowsCaptureDisplay = {
	displayId: number;
	bounds: WindowsCaptureDisplayBounds;
};

export type ResolvedWindowsCaptureTarget =
	| {
			kind: "window";
			windowHandle: number;
	  }
	| {
			kind: "display";
			displayId: number;
			bounds: WindowsCaptureDisplayBounds;
	  }
	| {
			kind: "invalid-window";
	  };

function parseDesktopCapturerWindowHandle(sourceId?: string) {
	if (!sourceId) {
		return null;
	}

	const match = sourceId.match(/^window:(\d+)/);
	if (!match) {
		return null;
	}

	const handle = Number.parseInt(match[1], 10);
	return Number.isFinite(handle) && handle > 0 ? handle : null;
}

function isWindowCaptureSource(source: WindowsCaptureSourceLike | null | undefined) {
	return source?.sourceType === "window" || source?.id?.startsWith("window:") === true;
}

export function resolveWindowsCaptureDisplay(
	source: WindowsCaptureSourceLike | null | undefined,
	allDisplays: WindowsCaptureDisplayLike[],
	primaryDisplay: WindowsCaptureDisplayLike,
): ResolvedWindowsCaptureDisplay {
	const requestedDisplayId = Number(source?.display_id);
	const primaryDisplayId = Number(primaryDisplay.id);
	const requestedOrPrimaryDisplayId =
		Number.isFinite(requestedDisplayId) && requestedDisplayId > 0
			? requestedDisplayId
			: primaryDisplayId;

	const matchedDisplay =
		allDisplays.find((display) => String(display.id) === String(requestedOrPrimaryDisplayId)) ??
		primaryDisplay;

	return {
		displayId: requestedOrPrimaryDisplayId,
		bounds: matchedDisplay.bounds,
	};
}

export function resolveWindowsCaptureTarget(
	source: WindowsCaptureSourceLike | null | undefined,
	allDisplays: WindowsCaptureDisplayLike[],
	primaryDisplay: WindowsCaptureDisplayLike,
): ResolvedWindowsCaptureTarget {
	if (isWindowCaptureSource(source)) {
		const windowHandle = parseDesktopCapturerWindowHandle(source?.id);
		if (windowHandle !== null) {
			return {
				kind: "window",
				windowHandle,
			};
		}

		return {
			kind: "invalid-window",
		};
	}

	const resolvedDisplay = resolveWindowsCaptureDisplay(source, allDisplays, primaryDisplay);
	return {
		kind: "display",
		...resolvedDisplay,
	};
}
