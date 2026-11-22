export const STABLE_UPDATE_CHANNEL = "latest";
export const EXPERIMENTAL_UPDATE_CHANNEL = "beta";
export const EXPERIMENTAL_UPDATE_DESCRIPTION =
	"You've opted into experimental updates so you have the choice to test the latest update of Recordly before it's widely available.";

export interface UpdateChannelConfiguration {
	channel: typeof STABLE_UPDATE_CHANNEL | typeof EXPERIMENTAL_UPDATE_CHANNEL;
	allowPrerelease: boolean;
	allowDowngrade: false;
}

export function getUpdateChannelConfiguration(
	experimentalUpdatesEnabled: boolean,
): UpdateChannelConfiguration {
	return {
		channel: experimentalUpdatesEnabled ? EXPERIMENTAL_UPDATE_CHANNEL : STABLE_UPDATE_CHANNEL,
		allowPrerelease: experimentalUpdatesEnabled,
		allowDowngrade: false,
	};
}
