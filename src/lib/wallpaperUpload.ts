const IMAGE_TYPES: Record<string, string> = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	jfif: "image/jpeg",
	png: "image/png",
	apng: "image/apng",
	webp: "image/webp",
	avif: "image/avif",
	gif: "image/gif",
	svg: "image/svg+xml",
	bmp: "image/bmp",
	ico: "image/x-icon",
	heic: "image/heic",
	heif: "image/heif",
};
const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "m4v", "mkv", "avi"];
export const WALLPAPER_UPLOAD_ACCEPT = [
	"image/*",
	"video/*",
	...Object.keys(IMAGE_TYPES).map((ext) => `.${ext}`),
	...VIDEO_EXTENSIONS.map((ext) => `.${ext}`),
].join(",");

export function wallpaperUploadKind(file: Pick<File, "name" | "type">): "image" | "video" | null {
	const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
	if (VIDEO_EXTENSIONS.includes(extension) || file.type.startsWith("video/")) return "video";
	if (IMAGE_TYPES[extension] || file.type.startsWith("image/")) return "image";
	return null;
}

function readDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () =>
			typeof reader.result === "string"
				? resolve(reader.result)
				: reject(new Error("Unreadable image"));
		reader.onerror = () => reject(new Error("Unreadable image"));
		reader.readAsDataURL(blob);
	});
}

/** Persist a browser-decodable image, including HEIC files with an empty MIME type. */
export async function prepareWallpaperImage(file: File): Promise<string> {
	const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
	let image: Blob = file;
	if (/^(heic|heif)$/.test(extension) || /^image\/hei[cf](?:-sequence)?$/i.test(file.type)) {
		const { default: convert } = await import("heic2any");
		const converted = await convert({ blob: file, toType: "image/png" });
		image = Array.isArray(converted) ? converted[0] : converted;
		if (!image) throw new Error("No image in HEIC file");
	} else if (IMAGE_TYPES[extension] && file.type !== IMAGE_TYPES[extension]) {
		image = new Blob([file], { type: IMAGE_TYPES[extension] });
	}
	const dataUrl = await readDataUrl(image);
	const preview = new Image();
	preview.src = dataUrl;
	await preview.decode();
	return dataUrl;
}
