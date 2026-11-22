import { getLocalFilePathFromResource } from "@/lib/exporter/mediaResource";

type AutoCaptionSourceOptions = {
	videoSourcePath?: string | null;
	videoPath?: string | null;
	recordingSessionVideoPath?: string | null;
	currentVideoPath?: string | null;
};

export function resolveAutoCaptionSourcePath(options: AutoCaptionSourceOptions): string | null {
	if (options.videoSourcePath) {
		return getLocalFilePathFromResource(options.videoSourcePath);
	}

	if (options.videoPath) {
		return getLocalFilePathFromResource(options.videoPath);
	}

	if (options.recordingSessionVideoPath) {
		return getLocalFilePathFromResource(options.recordingSessionVideoPath);
	}

	if (options.currentVideoPath) {
		return getLocalFilePathFromResource(options.currentVideoPath);
	}

	return null;
}
