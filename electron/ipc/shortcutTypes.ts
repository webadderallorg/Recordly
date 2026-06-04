export const LAUNCH_SHORTCUT_ACTIONS = [
	"startRecording",
	"stopRecording",
	"pauseRecording",
	"resumeRecording",
	"muteMicrophone",
] as const;

export type LaunchShortcutAction = (typeof LAUNCH_SHORTCUT_ACTIONS)[number];

export function isLaunchShortcutAction(action: string): action is LaunchShortcutAction {
	return (LAUNCH_SHORTCUT_ACTIONS as readonly string[]).includes(action);
}

export type ShortcutBinding = {
	key: string;
	ctrl?: boolean;
	shift?: boolean;
	alt?: boolean;
};
