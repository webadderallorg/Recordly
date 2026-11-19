import { useCallback } from "react";
import type { RecorderCoreContext } from "./recorderContext";
export function useRecorderMediaCleanup(
	context: Pick<
		RecorderCoreContext,
		| "stream"
		| "screenStream"
		| "microphoneStream"
		| "webcamStream"
		| "mixingContext"
		| "cleanupMicFallbackRecorder"
	>,
) {
	const {
		stream,
		screenStream,
		microphoneStream,
		webcamStream,
		mixingContext,
		cleanupMicFallbackRecorder,
	} = context;
	const cleanupCapturedMedia = useCallback(() => {
		if (stream.current) {
			stream.current.getTracks().forEach((track) => track.stop());
			stream.current = null;
		}

		if (screenStream.current) {
			screenStream.current.getTracks().forEach((track) => track.stop());
			screenStream.current = null;
		}

		if (microphoneStream.current) {
			microphoneStream.current.getTracks().forEach((track) => track.stop());
			microphoneStream.current = null;
		}

		if (webcamStream.current) {
			webcamStream.current.getTracks().forEach((track) => track.stop());
			webcamStream.current = null;
		}

		if (mixingContext.current) {
			mixingContext.current.close().catch(() => undefined);
			mixingContext.current = null;
		}

		cleanupMicFallbackRecorder();
	}, [
		cleanupMicFallbackRecorder,
		stream,
		screenStream,
		microphoneStream,
		webcamStream,
		mixingContext,
	]);

	return { cleanupCapturedMedia };
}
