import { hasRecordlySession } from "./recordlyAuth";

/** Local-only builds skip cloud login, not OS screen/microphone permissions. */
export async function canStartLocalRecording(): Promise<boolean> {
	if (import.meta.env.VITE_SKIP_ONBOARDING === "true") return true;
	return hasRecordlySession().catch(() => false);
}
