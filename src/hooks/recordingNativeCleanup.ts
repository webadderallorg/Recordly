export type NativeCaptureStopResult = {
	success: boolean;
	path?: string;
	error?: string;
	message?: string;
};

export type DiscardNativeCaptureResult = {
	stopSucceeded: boolean;
	deleteSucceeded: boolean;
	path?: string;
	error?: unknown;
};

type DeleteRecordingFile = (path: string) => Promise<{ success: boolean; error?: string }>;

export async function deleteNativeCaptureFile(path: string, deleteRecordingFile: DeleteRecordingFile) {
	const result = await deleteRecordingFile(path);
	if (!result.success) throw new Error(result.error || "Could not delete the recording.");
}

export async function stopAndDiscardNativeCapture({
	stopNativeScreenRecording,
	deleteRecordingFile,
}: {
	stopNativeScreenRecording: () => Promise<NativeCaptureStopResult>;
	deleteRecordingFile: DeleteRecordingFile;
}): Promise<DiscardNativeCaptureResult> {
	let stoppedResult: NativeCaptureStopResult;
	try {
		stoppedResult = await stopNativeScreenRecording();
	} catch (error) {
		return { stopSucceeded: false, deleteSucceeded: false, error };
	}

	if (!stoppedResult.success) {
		return {
			stopSucceeded: false,
			deleteSucceeded: false,
			error: stoppedResult.error ?? stoppedResult.message,
		};
	}

	if (!stoppedResult.path) {
		return { stopSucceeded: true, deleteSucceeded: true };
	}

	try {
		await deleteNativeCaptureFile(stoppedResult.path, deleteRecordingFile);
		return {
			stopSucceeded: true,
			deleteSucceeded: true,
			path: stoppedResult.path,
		};
	} catch (error) {
		return {
			stopSucceeded: true,
			deleteSucceeded: false,
			path: stoppedResult.path,
			error,
		};
	}
}
