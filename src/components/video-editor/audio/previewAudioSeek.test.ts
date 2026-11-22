import { describe, expect, it } from "vitest";
import { syncPreviewAudioTime } from "./previewAudioSeek";

class AudioFixture extends EventTarget {
	src = "http://localhost/audio.wav";
	seeking = false;
	paused = true;
	pauses = 0;
	position = 0;
	writes: number[] = [];
	pause() {
		this.pauses++;
		this.paused = true;
	}
	get currentTime() {
		return this.position;
	}
	set currentTime(time: number) {
		this.writes.push(time);
		this.position = time;
		this.seeking = true;
	}
	get element() {
		return this as unknown as HTMLAudioElement;
	}
	finishSeek() {
		this.seeking = false;
		this.dispatchEvent(new Event("seeked"));
	}
}

describe("preview audio seek serialization", () => {
	it("does not seek an aligned element even after a large time advance", () => {
		const audio = new AudioFixture();
		for (const time of [0.3, 0.6, 0.9, 1.2]) {
			audio.position = time;
			syncPreviewAudioTime(audio.element, time, 0.01);
		}
		expect(audio.writes).toEqual([]);
	});
	it("finishes an ongoing seek before applying the latest requested position", () => {
		const audio = new AudioFixture();
		syncPreviewAudioTime(audio.element, 1, 0.01);
		syncPreviewAudioTime(audio.element, 2, 0.01);
		syncPreviewAudioTime(audio.element, 3, 0.9);
		expect(audio.writes).toEqual([1]);
		audio.finishSeek();
		expect(audio.writes).toEqual([1, 3]);
		audio.finishSeek();
		expect(audio.writes).toEqual([1, 3]);
	});
	it("drops an obsolete request when the timeline returns to the current position", () => {
		const audio = new AudioFixture();
		syncPreviewAudioTime(audio.element, 1, 0.01);
		syncPreviewAudioTime(audio.element, 2, 0.01);
		syncPreviewAudioTime(audio.element, 1, 0.01);
		audio.finishSeek();
		expect(audio.writes).toEqual([1]);
	});
	it.each([
		{ initialPause: false, latestPause: true },
		{ initialPause: true, latestPause: false },
	])("uses the latest pause flag for a queued seek: $latestPause", ({
		initialPause,
		latestPause,
	}) => {
		const audio = new AudioFixture();
		audio.paused = false;
		syncPreviewAudioTime(audio.element, 1, 0.01);
		syncPreviewAudioTime(audio.element, 2, 0.01, initialPause);
		syncPreviewAudioTime(audio.element, 3, 0.01, latestPause);
		expect(audio.pauses).toBe(0);
		audio.finishSeek();
		expect(audio.writes).toEqual([1, 3]);
		expect(audio.pauses).toBe(latestPause ? 1 : 0);
		expect(audio.paused).toBe(latestPause);
	});
	it("does not replay a seek from an unloaded resource", () => {
		const audio = new AudioFixture();
		syncPreviewAudioTime(audio.element, 1, 0.01);
		syncPreviewAudioTime(audio.element, 2, 0.01);
		audio.src = "";
		audio.finishSeek();
		expect(audio.writes).toEqual([1]);
	});
	it("keeps a new resource's queued request separate from the old one", () => {
		const audio = new AudioFixture();
		syncPreviewAudioTime(audio.element, 1, 0.01);
		syncPreviewAudioTime(audio.element, 2, 0.01);
		audio.src = "http://localhost/replacement.wav";
		syncPreviewAudioTime(audio.element, 4, 0.01);
		audio.finishSeek();
		expect(audio.writes).toEqual([1, 4]);
	});
});
