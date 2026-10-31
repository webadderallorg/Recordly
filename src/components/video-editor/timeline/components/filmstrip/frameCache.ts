import { getRenderableVideoUrl } from "@/lib/assetPath";

// One background decoder at a time; never seek the editor's playback element.
let queue: Promise<unknown> = Promise.resolve();
const frames = new Map<string, string>();
const MAX_CACHED_FRAMES = 256;

function waitForVideo(video: HTMLVideoElement, event: string, signal: AbortSignal) {
	return new Promise<void>((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timeout);
			video.removeEventListener(event, ready);
			video.removeEventListener("error", failed);
			signal.removeEventListener("abort", failed);
		};
		const ready = () => {
			cleanup();
			resolve();
		};
		const failed = () => {
			cleanup();
			reject(new Error("Frame extraction cancelled or unavailable"));
		};
		const timeout = setTimeout(failed, 8000);
		video.addEventListener(event, ready, { once: true });
		video.addEventListener("error", failed, { once: true });
		signal.addEventListener("abort", failed, { once: true });
		if (signal.aborted) failed();
	});
}

export function extractFilmstrip(
	path: string,
	times: number[],
	signal: AbortSignal,
): Promise<string[]> {
	const job = queue.then(async () => {
		if (signal.aborted) return [];
		const keys = times.map((time) => `${path}:${Math.round(time)}`);
		if (keys.every((key) => frames.has(key))) return keys.map((key) => frames.get(key)!);
		const url = await getRenderableVideoUrl(path);
		if (signal.aborted) return [];
		const video = document.createElement("video");
		video.muted = true;
		video.playsInline = true;
		video.preload = "auto";
		video.crossOrigin = "anonymous";
		const canvas = document.createElement("canvas");
		canvas.width = 160;
		canvas.height = 90;
		const context = canvas.getContext("2d");
		if (!context) return [];
		try {
			const loaded = waitForVideo(video, "loadeddata", signal);
			video.src = url;
			await loaded;
			const result: string[] = [];
			for (let index = 0; index < times.length; index++) {
				if (signal.aborted) return [];
				const cached = frames.get(keys[index]);
				if (cached) {
					result.push(cached);
					continue;
				}
				const time = Math.max(0, Math.min(times[index] / 1000, video.duration - 0.001));
				if (Math.abs(video.currentTime - time) > 0.0001) {
					const sought = waitForVideo(video, "seeked", signal);
					video.currentTime = time;
					await sought;
				}
				// Some non-seekable sources silently reset to zero; don't show misleading copies.
				if (Math.abs(video.currentTime - time) > 0.12)
					throw new Error("Source does not support accurate seeking");
				const scale = Math.max(
					canvas.width / video.videoWidth,
					canvas.height / video.videoHeight,
				);
				const width = video.videoWidth * scale;
				const height = video.videoHeight * scale;
				context.drawImage(
					video,
					(canvas.width - width) / 2,
					(canvas.height - height) / 2,
					width,
					height,
				);
				const frame = canvas.toDataURL("image/jpeg", 0.7);
				frames.set(keys[index], frame);
				if (frames.size > MAX_CACHED_FRAMES) frames.delete(frames.keys().next().value!);
				result.push(frame);
			}
			return result;
		} finally {
			video.pause();
			video.removeAttribute("src");
			video.load();
		}
	});
	queue = job.catch(() => undefined);
	return job;
}
