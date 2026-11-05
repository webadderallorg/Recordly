import { translate } from "@/i18n/runtime";

export function getErrorMessage(error: unknown) {
	if (error instanceof Error && error.message) {
		return error.message;
	}

	if (typeof error === "string" && error.trim().length > 0) {
		return error;
	}

	if (typeof error === "object" && error !== null) {
		try {
			const serialized = JSON.stringify(error);
			if (serialized && serialized !== "{}") {
				return serialized;
			}
		} catch {
			// Ignore stringify failures and fall through to a generic message.
		}

		if (typeof (error as { toString?: () => string }).toString === "function") {
			const stringified = (error as { toString: () => string }).toString();
			if (stringified && stringified !== "[object Object]") {
				return stringified;
			}
		}
	}

	return translate("notifications.unexpectedError", "An unexpected error occurred");
}
