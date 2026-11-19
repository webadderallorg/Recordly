import { ipcMain, shell } from "electron";
import { isTrustedRenderer } from "../../trustedRenderer";
import {
	type CloudBillingResult,
	parseCloudBillingCatalog,
	parseCloudBillingStatus,
} from "../../../src/types/cloudBilling";
import { normalizeCloudEndpoint } from "../cloudShareContract";

const MAX_RESPONSE_BYTES = 32 * 1024;
const pendingActions = new Set<number>();
const requestsByOwner = new Map<number, Set<AbortController>>();
const latestTokens = new WeakMap<object, string>();

function hasWhitespaceOrControl(value: string): boolean {
	return Array.from(value).some((character) => {
		const code = character.charCodeAt(0);
		return code <= 32 || code === 127;
	});
}

/** Billing pages must come from Stripe itself, never a service-supplied redirect. */
export function parseStripeBillingUrl(value: unknown, action: "checkout" | "portal"): string {
	if (typeof value !== "string" || value.length > 4096 || hasWhitespaceOrControl(value))
		throw new Error("Invalid billing link.");
	const url = new URL(value);
	const origin =
		action === "checkout" ? "https://checkout.stripe.com" : "https://billing.stripe.com";
	// Stripe currently returns both checkout URL formats.
	const prefixes = action === "checkout" ? ["/c/pay/", "/g/pay/"] : ["/p/session/"];
	const sessionPath =
		prefixes.some((prefix) => url.pathname.startsWith(prefix)) ||
		(action === "portal" &&
			url.pathname === "/p/session" &&
			Boolean(url.searchParams.get("secret")));
	if (url.origin !== origin || url.username || url.password || !sessionPath)
		throw new Error("Invalid billing link.");
	return url.href;
}

async function boundedJson(response: Response): Promise<unknown> {
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Invalid billing response.");
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > MAX_RESPONSE_BYTES) {
				await reader.cancel();
				throw new Error("Billing response is too large.");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function billingError(status: number): string {
	switch (status) {
		case 401:
			return "Sign in again to manage your cloud plan.";
		case 403:
			return "This billing action is unavailable for your account.";
		case 409:
			return "A billing action is already in progress. Refresh your plan or try again shortly.";
		case 429:
			return "Too many billing requests. Try again shortly.";
		case 503:
			return "Cloud billing is not available right now. Try again later.";
		default:
			return "Could not manage your cloud plan. Refresh and try again.";
	}
}

export function registerCloudBillingHandlers() {
	ipcMain.handle("cloud-billing-cancel", (event) => {
		if (!isTrustedRenderer(event)) return { success: false };
		for (const request of requestsByOwner.get(event.sender.id) ?? []) request.abort();
		return { success: true };
	});
	ipcMain.handle("cloud-billing", async (event, input: unknown): Promise<CloudBillingResult> => {
		if (!isTrustedRenderer(event))
			return { success: false, error: "Untrusted billing request." };
		let ownsAction = false;
		const owner = event.sender;
		const controller = new AbortController();
		const abandon = () => controller.abort();
		try {
			if (!input || typeof input !== "object" || Array.isArray(input))
				return { success: false, error: "Invalid billing request." };
			const request = input as Record<string, unknown>;
			const endpoint = normalizeCloudEndpoint(request.endpoint);
			const action = request.action;
			if (
				action !== "catalog" &&
				(typeof request.token !== "string" ||
					!request.token ||
					Buffer.byteLength(request.token) > 8192 ||
					hasWhitespaceOrControl(request.token))
			)
				return { success: false, error: "Sign in to manage your cloud plan." };
			if (
				action !== "catalog" &&
				action !== "status" &&
				action !== "checkout" &&
				action !== "portal"
			)
				return { success: false, error: "Invalid billing action." };
			if (
				action === "checkout" &&
				request.interval !== "monthly" &&
				request.interval !== "yearly"
			)
				return { success: false, error: "Choose a monthly or yearly plan." };
			if (owner.isDestroyed()) return { success: false, error: "Billing window is closed." };
			if (action !== "catalog") latestTokens.set(owner, request.token as string);
			if (action !== "status" && action !== "catalog") {
				if (pendingActions.has(owner.id))
					return { success: false, error: "A billing action is already in progress." };
				pendingActions.add(owner.id);
				ownsAction = true;
			}
			owner.once("destroyed", abandon);
			const requests = requestsByOwner.get(owner.id) ?? new Set<AbortController>();
			requests.add(controller);
			requestsByOwner.set(owner.id, requests);
			const response = await fetch(
				new URL(action === "status" ? "/api/billing" : `/api/billing/${action}`, endpoint),
				{
					method: action === "status" || action === "catalog" ? "GET" : "POST",
					headers: {
						...(action === "catalog"
							? {}
							: { authorization: `Bearer ${request.token}` }),
						"content-type": "application/json",
					},
					...(action === "status" || action === "catalog"
						? {}
						: {
								body: JSON.stringify(
									action === "checkout" ? { interval: request.interval } : {},
								),
							}),
					redirect: "error",
					signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
				},
			);
			// Never reflect provider diagnostics, payment URLs or credentials from an error body.
			if (!response.ok)
				return {
					success: false,
					httpStatus: response.status,
					error: billingError(response.status),
				};
			const body = await boundedJson(response);
			if (
				controller.signal.aborted ||
				owner.isDestroyed() ||
				(action !== "catalog" && latestTokens.get(owner) !== request.token)
			)
				return { success: false, error: "Billing window is closed." };
			if (action === "catalog")
				return {
					success: true,
					...parseCloudBillingCatalog({ ...(body as object), success: true }),
				};
			if (action === "status") {
				if (!body || typeof body !== "object" || Array.isArray(body))
					throw new Error("Invalid billing response.");
				return { success: true, ...parseCloudBillingStatus({ ...body, success: true }) };
			}
			const url = parseStripeBillingUrl((body as { url?: unknown } | null)?.url, action);
			await shell.openExternal(url);
			return { success: true };
		} catch {
			return {
				success: false,
				error: "Could not manage your cloud plan. Refresh and try again.",
			};
		} finally {
			owner.removeListener("destroyed", abandon);
			const requests = requestsByOwner.get(owner.id);
			requests?.delete(controller);
			if (requests?.size === 0) requestsByOwner.delete(owner.id);
			if (ownsAction) pendingActions.delete(owner.id);
		}
	});
}
