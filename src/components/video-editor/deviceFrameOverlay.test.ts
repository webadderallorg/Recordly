import { ImageSource, Sprite, Texture } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { DeviceFrameOverlay } from "./deviceFrameOverlay";

function texture() {
	return new Texture({ source: new ImageSource({ width: 450, height: 920 }) });
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("device frame texture ownership", () => {
	it("uses one uniform scale and rotates the complete photograph clockwise in landscape", async () => {
		const image = texture();
		const load = vi.fn(async () => image);
		const overlay = new DeviceFrameOverlay(load);
		await overlay.load("iphone-black");
		overlay.layout("iphone-black", { x: 100, y: 100, width: 1206, height: 2622 }, "portrait");
		const photo = overlay.children.find((child) => child instanceof Sprite) as Sprite;
		expect(photo.scale.x).toBe(3);
		expect(photo.scale.y).toBe(3);
		expect(photo.position.x).toBe(28);
		expect(photo.position.y).toBe(31);
		expect(photo.rotation).toBe(0);
		expect(overlay.visible).toBe(true);
		overlay.layout("iphone-black", { x: 100, y: 100, width: 2622, height: 1206 }, "landscape");
		expect(photo.position.x).toBe(2791);
		expect(photo.position.y).toBe(28);
		expect(photo.rotation).toBe(Math.PI / 2);
		expect(photo.scale.x).toBe(3);
		expect(photo.scale.y).toBe(3);
		await overlay.load("iphone-black");
		expect(load).toHaveBeenCalledTimes(1);
		overlay.destroy();
		expect(image.destroyed).toBe(true);
	});

	it("destroys a late image after unmount instead of reattaching it", async () => {
		const pending = deferred<Texture>();
		const overlay = new DeviceFrameOverlay(() => pending.promise);
		const loading = overlay.load("iphone-black");
		overlay.destroy();
		const image = texture();
		pending.resolve(image);
		await loading;
		expect(image.destroyed).toBe(true);
	});

	it("cannot replace a newer style with an older load and releases the previous image on None", async () => {
		const black = deferred<Texture>();
		const silver = texture();
		const overlay = new DeviceFrameOverlay((frame) =>
			frame === "iphone-black" ? black.promise : Promise.resolve(silver),
		);
		const loading = overlay.load("iphone-black");
		await overlay.load("iphone-silver");
		const stale = texture();
		black.resolve(stale);
		await loading;
		expect(stale.destroyed).toBe(true);
		expect(silver.destroyed).toBe(false);
		overlay.layout("iphone-silver", { x: 24, y: 23, width: 402, height: 874 });
		expect(overlay.visible).toBe(true);
		await overlay.load("none");
		expect(silver.destroyed).toBe(true);
		expect(overlay.visible).toBe(false);
		overlay.destroy();
	});

	it("propagates image errors so export cannot silently omit the selected frame", async () => {
		const overlay = new DeviceFrameOverlay(async () => {
			throw new Error("missing frame");
		});
		await expect(overlay.load("iphone-black")).rejects.toThrow("missing frame");
		expect(overlay.visible).toBe(false);
		overlay.destroy();
	});
});
