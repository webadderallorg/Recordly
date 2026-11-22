import type { RecordingOwnerRecovery } from "../ownerRecovery";
import type { RecordingProcessGuard } from "../processGuard";
import type { RecordingSessionLock } from "../sessionLock";
import type { WindowsRecordingFinalizer } from "../windowsFinalizer";

/** Per-registration owners; backend state remains in the original live ESM bindings. */
export type RecordingHandlerContext = {
	sessionLock: RecordingSessionLock;
	recordingProcessGuard: RecordingProcessGuard;
	windowsFinalizer: WindowsRecordingFinalizer;
	windowsInterruptedRecovery: {
		current: ReturnType<WindowsRecordingFinalizer["recover"]> | null;
	};
	ownerRecovery: RecordingOwnerRecovery;
	setRecordingState: (recording: boolean, ownerId?: number) => void;
};
