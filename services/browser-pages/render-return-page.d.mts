export type ReturnPageState = "auth-received" | "auth-error" | "billing-return";
export function renderReturnPage(
	state: ReturnPageState,
	protocol?: "recordly" | "recordly-dev",
	theme?: "system" | "light" | "dark",
): string;
