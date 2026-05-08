type NativeStaticLayoutContentSize = {
	width: number;
	height: number;
};

function toEvenFloor(value: number) {
	return Math.max(2, Math.floor(value / 2) * 2);
}

function toEvenRound(value: number) {
	return Math.max(2, Math.round(value / 2) * 2);
}

function clampEven(value: number, max: number) {
	const rounded = toEvenRound(value);
	return rounded <= max ? rounded : toEvenFloor(max);
}

function aspectError(size: NativeStaticLayoutContentSize, aspect: number) {
	return Math.abs(size.width / size.height - aspect);
}

export function roundNativeStaticLayoutContentSize(params: {
	width: number;
	height: number;
}): NativeStaticLayoutContentSize {
	const maxWidth = toEvenFloor(params.width);
	const maxHeight = toEvenFloor(params.height);
	if (
		!Number.isFinite(params.width) ||
		!Number.isFinite(params.height) ||
		params.width <= 0 ||
		params.height <= 0
	) {
		return { width: maxWidth, height: maxHeight };
	}

	const aspect = params.width / params.height;
	const fromWidth = {
		width: maxWidth,
		height: clampEven(maxWidth / aspect, maxHeight),
	};
	const fromHeight = {
		width: clampEven(maxHeight * aspect, maxWidth),
		height: maxHeight,
	};

	const widthError = aspectError(fromWidth, aspect);
	const heightError = aspectError(fromHeight, aspect);
	if (heightError < widthError) {
		return fromHeight;
	}

	if (widthError < heightError) {
		return fromWidth;
	}

	return fromHeight.width * fromHeight.height >= fromWidth.width * fromWidth.height
		? fromHeight
		: fromWidth;
}
