import { createExtensionQueryApi } from "./extensionHostQueryApi";
import { createExtensionRegistrationApi } from "./extensionHostRegistrationApi";
import type { RecordlyExtensionAPI, ExtensionEventType } from "./types";
import type { ExtensionHostApiContext } from "./extensionHostShared";

interface CreateExtensionApiArgs {
	extensionId: string;
	extensionPath: string;
	permissions: string[];
	disposables: (() => void)[];
	host: ExtensionHostApiContext;
}

function getEventPermission(event: ExtensionEventType): "cursor" | "timeline" | "export" | null {
	if (event.startsWith("cursor:")) {
		return "cursor";
	}

	if (event.startsWith("playback:") || event.startsWith("timeline:")) {
		return "timeline";
	}

	if (event.startsWith("export:")) {
		return "export";
	}

	return null;
}

export function createExtensionAPI({
	extensionId,
	extensionPath,
	permissions,
	disposables,
	host,
}: CreateExtensionApiArgs): RecordlyExtensionAPI {
	const permissionSet = new Set(permissions);
	const requirePermission = (permission: string, method: string) => {
		if (!permissionSet.has(permission)) {
			throw new Error(
				`Extension '${extensionId}' lacks '${permission}' permission required for ${method}()`,
			);
		}
	};

	return {
		...createExtensionRegistrationApi({
			extensionId,
			extensionPath,
			disposables,
			host,
			requirePermission,
			getEventPermission,
		}),
		...createExtensionQueryApi({
			extensionId,
			disposables,
			host,
		}),
	};
}