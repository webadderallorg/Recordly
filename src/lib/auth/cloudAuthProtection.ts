export type AuthProtectionState = {
	ready: boolean;
	required: boolean;
	token?: string;
	failed?: boolean;
};

export function cloudAuthConfigUrl(
	endpoint = import.meta.env.VITE_CLOUD_SHARE_ENDPOINT,
): string | undefined {
	if (!endpoint?.trim()) return undefined;
	const url = new URL(endpoint, window.location.href);
	if (
		url.username ||
		url.password ||
		(url.protocol !== "https:" &&
			!(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
	)
		throw new Error("Invalid cloud sign-in configuration");
	return new URL("/cloud/config", url).href;
}

export function challengeEnabled(value: unknown): boolean {
	if (!value || typeof value !== "object") throw new Error("Invalid cloud sign-in configuration");
	const config = value as { authCaptcha?: { enabled?: unknown } };
	// Existing deployments omit this field. Ship compatible clients before the
	// cloud flag and Supabase CAPTCHA are enabled together.
	if (config.authCaptcha === undefined) return false;
	if (!config.authCaptcha || typeof config.authCaptcha.enabled !== "boolean")
		throw new Error("Invalid cloud sign-in configuration");
	return config.authCaptcha.enabled;
}

export function challengeToken(
	event: MessageEvent,
	frame: Window | null,
	origin: string,
	requestId: string,
): string | undefined {
	if (!frame || event.source !== frame || event.origin !== origin) return undefined;
	const message = event.data;
	if (
		message?.type !== "recordly-auth-challenge" ||
		message.requestId !== requestId ||
		message.status !== "verified" ||
		typeof message.token !== "string" ||
		!message.token.trim() ||
		message.token.length > 2048
	)
		return undefined;
	return message.token;
}
