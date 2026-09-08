import { Container, Graphics, ImageSource, Sprite, Texture } from "pixi.js";
import blackFrameUrl from "@/assets/device-frames/iphone-16-pro-black-titanium.png";
import silverFrameUrl from "@/assets/device-frames/iphone-16-pro-white-titanium.png";
import {
	type DeviceFrame,
	type DeviceFrameRect,
	type DeviceFrameOrientation,
	drawDeviceFrameLetterbox,
	getDeviceFrameGeometry,
	hasDeviceFrame,
	IPHONE_FRAME,
} from "./deviceFrame";

export async function loadDeviceFrameTexture(frame: DeviceFrame): Promise<Texture> {
	const image = new Image();
	const url = frame === "iphone-silver" ? silverFrameUrl : blackFrameUrl;
	await new Promise<void>((resolve, reject) => {
		const finish = (error?: Error) => {
			clearTimeout(timeout);
			image.onload = null;
			image.onerror = null;
			if (error) reject(error);
			else resolve();
		};
		const timeout = setTimeout(
			() => finish(new Error("The iPhone frame image took too long to load.")),
			15000,
		);
		image.onload = () => finish();
		image.onerror = () => finish(new Error("The iPhone frame image could not be loaded."));
		image.src = url;
	});
	if (image.naturalWidth !== IPHONE_FRAME.width || image.naturalHeight !== IPHONE_FRAME.height) {
		throw new Error("The iPhone frame image has unexpected dimensions.");
	}
	return new Texture({ source: new ImageSource({ resource: image }) });
}

/** Owns its decoded texture; late loads cannot reattach after a style change or teardown. */
export class DeviceFrameOverlay extends Container {
	private readonly letterbox = new Graphics();
	private readonly photo = new Sprite(Texture.EMPTY);
	private ownedTexture: Texture | null = null;
	private loadedFrame: DeviceFrame = "none";
	private requestedFrame: DeviceFrame = "none";
	private generation = 0;
	private pending: Promise<void> | null = null;

	constructor(private readonly loadTexture = loadDeviceFrameTexture) {
		super();
		this.addChild(this.letterbox, this.photo);
		this.visible = false;
	}

	async load(frame: DeviceFrame = "none"): Promise<void> {
		if (this.destroyed) return;
		if (this.requestedFrame === frame && this.pending) return this.pending;
		if (this.loadedFrame === frame && this.requestedFrame === frame) return;
		const generation = ++this.generation;
		this.requestedFrame = frame;
		this.visible = false;
		this.photo.texture = Texture.EMPTY;
		this.ownedTexture?.destroy(true);
		this.ownedTexture = null;
		this.loadedFrame = "none";
		if (!hasDeviceFrame(frame)) {
			this.pending = null;
			return;
		}
		this.pending = this.loadTexture(frame)
			.then((texture) => {
				if (this.destroyed || generation !== this.generation) {
					texture.destroy(true);
					return;
				}
				this.ownedTexture = texture;
				this.photo.texture = texture;
				this.loadedFrame = frame;
			})
			.finally(() => {
				if (generation === this.generation) this.pending = null;
			});
		return this.pending;
	}

	layout(
		frame: DeviceFrame | undefined,
		content: DeviceFrameRect,
		orientation?: DeviceFrameOrientation,
	) {
		const geometry = getDeviceFrameGeometry(frame, content, orientation);
		this.visible = !!geometry && frame === this.loadedFrame && !!this.ownedTexture;
		drawDeviceFrameLetterbox(this.letterbox, frame, content, orientation);
		if (!geometry) return;
		const { bounds, scale, portrait } = geometry;
		this.photo.scale.set(scale);
		this.photo.rotation = portrait ? 0 : Math.PI / 2;
		this.photo.position.set(portrait ? bounds.x : bounds.x + bounds.width, bounds.y);
	}

	override destroy(_options?: Parameters<Container["destroy"]>[0]) {
		if (this.destroyed) return;
		++this.generation;
		this.photo.texture = Texture.EMPTY;
		this.ownedTexture?.destroy(true);
		this.ownedTexture = null;
		super.destroy({ children: true, texture: false, textureSource: false });
	}
}
