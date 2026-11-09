/** Inspect rendered pixels rather than the presence of a CSS mask declaration. */
export function readPreviewFeather() {
	const canvas = document.querySelector<HTMLCanvasElement>("[data-webcam-motion-blur]")!;
	const camera = document.querySelector<HTMLElement>("[data-webcam-overlay]")!;
	const density = canvas.width / parseFloat(canvas.style.width);
	const x = Math.round(
		(parseFloat(camera.style.left) -
			parseFloat(canvas.style.left) +
			parseFloat(camera.style.width) / 2) *
			density,
	);
	const y = Math.ceil((parseFloat(camera.style.top) - parseFloat(canvas.style.top)) * density);
	const height = Math.floor((parseFloat(camera.style.height) / 2) * density);
	const pixels = canvas.getContext("2d")!.getImageData(x, y, 1, height).data;
	const alpha = Array.from({ length: height }, (_, i) => pixels[i * 4 + 3]);
	return {
		transparentEdge: alpha[0] < 10,
		opaqueCenter: alpha.at(-1) === 255,
		gradualFade: alpha.filter((value) => value > 10 && value < 245).length >= 5 * density,
	};
}
