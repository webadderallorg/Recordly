export function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const MAX_MARKETPLACE_ERROR_DETAIL_LENGTH = 200;

export function formatMarketplaceHttpError({
	status,
	contentType,
	body,
}: {
	status: number;
	contentType: string | null;
	body: string;
}): string {
	if (status >= 500) {
		return `Marketplace is temporarily unavailable (HTTP ${status}). Please try again later.`;
	}

	let detail: string | null = null;
	if (contentType?.toLowerCase().includes("json")) {
		try {
			const payload: unknown = JSON.parse(body);
			if (payload && typeof payload === "object") {
				const { error, message } = payload as { error?: unknown; message?: unknown };
				const value = typeof error === "string" ? error : message;
				if (typeof value === "string" && value.trim()) {
					const normalized = value.trim().replace(/\s+/g, " ");
					const codePoints = Array.from(normalized);
					detail =
						codePoints.length > MAX_MARKETPLACE_ERROR_DETAIL_LENGTH
							? `${codePoints.slice(0, MAX_MARKETPLACE_ERROR_DETAIL_LENGTH - 1).join("")}…`
							: normalized;
				}
			}
		} catch {
			// Malformed or non-API responses are intentionally not exposed to the renderer.
		}
	}

	const summary = `Marketplace request failed (HTTP ${status})`;
	return detail ? `${summary}: ${detail}` : `${summary}.`;
}
