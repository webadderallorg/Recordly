import type { useRecorderCaptureSetup } from "./useRecorderCaptureSetup";
import type { useRecorderClock } from "./useRecorderClock";
import type { useRecorderEditorSession } from "./useRecorderEditorSession";
import type { useRecorderMediaCleanup } from "./useRecorderMediaCleanup";
import type { useRecorderPreferences } from "./useRecorderPreferences";
import type { useRecorderStartup } from "./useRecorderStartup";
import type { useRecorderState } from "./useRecorderState";
import type { useRecorderStop } from "./useRecorderStop";
import type { useRecorderWebcam } from "./useRecorderWebcam";
export type RecorderCoreContext = ReturnType<typeof useRecorderState> &
	ReturnType<typeof useRecorderPreferences> &
	ReturnType<typeof useRecorderClock> &
	ReturnType<typeof useRecorderWebcam>;
export type RecorderServices = RecorderCoreContext &
	ReturnType<typeof useRecorderMediaCleanup> &
	ReturnType<typeof useRecorderEditorSession>;
export type RecorderContext = RecorderServices & ReturnType<typeof useRecorderCaptureSetup>;
export type RecorderStopContext = RecorderContext & ReturnType<typeof useRecorderStop>;
export type RecorderControlContext = RecorderStopContext & ReturnType<typeof useRecorderStartup>;
