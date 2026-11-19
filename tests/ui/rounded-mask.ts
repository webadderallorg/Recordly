import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";
import { MotionBlurFilter } from "pixi-filters/motion-blur";
import { ZoomBlurFilter } from "pixi-filters/zoom-blur";
import { createVideoBlurFilters } from "@/lib/exporter/videoBlurFilters";
import { drawSquircleOnGraphics } from "@/lib/geometry/squircle";

async function run() {
	const app = new Application();
	await app.init({
		width: 320,
		height: 180,
		background: "#000000",
		antialias: true,
		resolution: 1,
		preference: "webgl",
		autoStart: false,
	});
	document.body.append(app.canvas);
	app.stage.addChild(new Graphics().rect(0, 0, 320, 180).fill(0x000000));
	const effects = new Container();
	app.stage.addChild(effects);
	const content = new Container();
	effects.addChild(content);
	const sprite = new Sprite(Texture.WHITE);
	sprite.width = 260;
	sprite.height = 120;
	sprite.position.set(30, 30);
	content.addChild(sprite);
	const mask = new Graphics();
	app.stage.addChild(mask);
	const round = () => {
		mask.clear();
		drawSquircleOnGraphics(mask, { x: 30.25, y: 30.25, width: 260, height: 120, radius: 36 });
		mask.fill(0xffffff);
	};
	round();
	content.mask = mask;
	const zoom = new ZoomBlurFilter({ strength: 0, maxKernelSize: 13 });
	const motion = new MotionBlurFilter([0, 0], 5, 0);
	effects.filters = [motion, zoom];
	const readPixels = () => {
		app.render();
		const { pixels, width } = app.renderer.extract.pixels(app.stage);
		let blended = 0;
		for (let y = 30; y < 67; y++) {
			for (let x = 30; x < 67; x++) {
				const channel = pixels[(y * width + x) * 4];
				if (channel > 0 && channel < 255) blended++;
			}
		}
		return blended;
	};
	const defaultBlended = readPixels();
	const antialiased = createVideoBlurFilters();
	effects.filters = [antialiased.motion, antialiased.zoom];
	const blended = readPixels();
	mask.clear().rect(30, 30, 260, 120).fill(0xffffff);
	const squareBlended = readPixels();
	round();
	const replacedBlended = readPixels();
	document.body.dataset.result = JSON.stringify({
		defaultBlended,
		blended,
		squareBlended,
		replacedBlended,
	});
}
run().catch((error) => {
	document.body.dataset.error = String(error);
});
