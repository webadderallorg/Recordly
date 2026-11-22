import type { CaptionCuePayload, CaptionWordPayload } from "../types";
import { buildCaptionTextFromWords } from "./parser";

/** Keep both speakers, with microphone speech taking priority during overlap. */
export function mergeCaptionSources(
	microphone: CaptionCuePayload[],
	system: CaptionCuePayload[],
): CaptionCuePayload[] {
	// Sound-event labels are not competing microphone speech.
	const micSpeech = microphone.filter((cue) => !/^(?:\s*[[(][^\])]+[\])]\s*)+$/.test(cue.text));
	const micSpans = micSpeech.flatMap((cue) => (cue.words?.length ? cue.words : [cue]));
	const overlapsMic = (startMs: number, endMs: number) =>
		micSpans.some((span) => startMs < span.endMs && endMs > span.startMs);
	const systemCues: CaptionCuePayload[] = [];
	for (const cue of system) {
		if (!overlapsMic(cue.startMs, cue.endMs)) {
			systemCues.push(cue);
			continue;
		}
		if (!cue.words?.length) {
			let spans = [{ startMs: cue.startMs, endMs: cue.endMs }];
			for (const mic of micSpans) {
				spans = spans.flatMap((span) => {
					if (mic.endMs <= span.startMs || mic.startMs >= span.endMs) return [span];
					return [
						{ startMs: span.startMs, endMs: Math.min(span.endMs, mic.startMs) },
						{ startMs: Math.max(span.startMs, mic.endMs), endMs: span.endMs },
					].filter((part) => part.endMs > part.startMs);
				});
			}
			// SRT has no word boundaries: retain its text during the unopposed portions.
			systemCues.push(...spans.map((span) => ({ ...cue, ...span })));
			continue;
		}
		// Preserve words outside the conflict, rather than dropping a whole paragraph.
		let run: CaptionWordPayload[] = [];
		const flush = () => {
			if (run.length === 0) return;
			systemCues.push({
				id: cue.id,
				startMs: run[0].startMs,
				endMs: run[run.length - 1].endMs,
				text: buildCaptionTextFromWords(run),
				words: run,
			});
			run = [];
		};
		for (const word of cue.words ?? []) {
			if (overlapsMic(word.startMs, word.endMs)) flush();
			else run.push(word);
		}
		flush();
	}
	const micEvents = microphone.filter(
		(cue) =>
			!micSpeech.includes(cue) &&
			!system.some((other) => cue.startMs < other.endMs && cue.endMs > other.startMs),
	);
	return [...micSpeech, ...micEvents, ...systemCues]
		.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
		.map((cue, index) => ({ ...cue, id: `caption-${index + 1}` }));
}
