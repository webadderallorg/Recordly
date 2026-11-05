import { translate } from "@/i18n/runtime";

export function isMissingProjectRecording(error: unknown) {
	return /Project video file not found/i.test(error instanceof Error ? error.message : String(error));
}
/** Keep diagnostics available without treating every failed read as a missing project. */
export function projectLoadError(error: unknown) {
	const details = error instanceof Error ? error.message : String(error ?? "Unknown error");
	if (/EACCES|EPERM|permission denied|not permitted/i.test(details)) {
		return {
			title: translate("notifications.accessDenied", "Access to this file was denied"),
			description: translate(
				"notifications.accessDeniedDescription",
				"Check the file’s permissions and allow Recordly to access its folder, then try again.",
			),
			details,
		};
	}
	if (isMissingProjectRecording(details)) {
		return {
			title: translate(
				"notifications.recordingUnavailable",
				"The project’s recording is unavailable",
			),
			description: translate(
				"notifications.recordingUnavailableDescription",
				"Locate the original recording to reconnect it without losing your edits, or reconnect its drive and try again.",
			),
			details,
		};
	}
	if (/ENOENT|ENOTDIR/i.test(details)) {
		return {
			title: translate("notifications.fileUnavailable", "This file is unavailable"),
			description: translate(
				"notifications.fileUnavailableDescription",
				"It may have moved, or its drive may be disconnected. Restore it to its original location and try again, or open another file.",
			),
			details,
		};
	}
	if (
		/invalid project|project file.*(format|video path)|SyntaxError|(?:Unexpected|Expected).*JSON/i.test(
			details,
		)
	) {
		return {
			title: translate("notifications.projectUnreadable", "This project couldn’t be read"),
			description: translate(
				"notifications.projectUnreadableDescription",
				"Try another copy of the project, or import the original recording to start a new edit.",
			),
			details,
		};
	}
	if (/Failed to load video/i.test(details)) {
		return {
			title: translate(
				"notifications.recordingUnplayable",
				"The recording couldn’t be played",
			),
			description: /format not supported|decode error/i.test(details)
				? translate(
						"notifications.recordingFormatDescription",
						"Try opening the recording again. If it still won’t play, import a supported video or another copy of the recording.",
					)
				: translate(
						"notifications.recordingAccessDescription",
						"Check that the recording and its drive are accessible, then try again. Your edits are still in this session.",
					),
			details,
		};
	}
	return {
		title: translate("notifications.fileOpenFailed", "We couldn’t open this file"),
		description: translate(
			"notifications.fileOpenFailedDescription",
			"Try again. If it still won’t open, check that the file and its drive are accessible, or open another file.",
		),
		details,
	};
}

/** Display the failing item locally without exposing its full directory in the banner. */
export function errorSourceName(source: string) {
	const clean = source.split(/[?#]/)[0];
	const name = clean.split(/[\\/]/).filter(Boolean).pop() || source;
	try {
		return decodeURIComponent(name);
	} catch {
		return name;
	}
}
