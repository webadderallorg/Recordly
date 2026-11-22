import type { CompanionAudioCandidate } from "../types";

export type CaptionAudioCandidate = {
	path: string;
	label: string;
};

export function getCaptionCompanionAudioCandidates(
	companions: CompanionAudioCandidate[],
): CaptionAudioCandidate[] {
	return companions.flatMap((companion) => {
		const candidates: CaptionAudioCandidate[] = [];
		if (companion.usablePaths.includes(companion.micPath)) {
			candidates.push({ path: companion.micPath, label: "microphone audio sidecar" });
		}
		if (companion.usablePaths.includes(companion.systemPath)) {
			candidates.push({ path: companion.systemPath, label: "system audio sidecar" });
		}
		return candidates;
	});
}
