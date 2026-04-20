import type { IpcRenderer } from "electron";

export function createExtensionsBridge(ipcRenderer: IpcRenderer) {
	return {
		extensionsDiscover: () => ipcRenderer.invoke("extensions:discover"),
		extensionsList: () => ipcRenderer.invoke("extensions:list"),
		extensionsGet: (id: string) => ipcRenderer.invoke("extensions:get", id),
		extensionsEnable: (id: string) => ipcRenderer.invoke("extensions:enable", id),
		extensionsDisable: (id: string) => ipcRenderer.invoke("extensions:disable", id),
		extensionsInstallFromFolder: () => ipcRenderer.invoke("extensions:install-from-folder"),
		extensionsUninstall: (id: string) => ipcRenderer.invoke("extensions:uninstall", id),
		extensionsGetDirectory: () => ipcRenderer.invoke("extensions:get-directory"),
		extensionsOpenDirectory: () => ipcRenderer.invoke("extensions:open-directory"),
		extensionsMarketplaceSearch: (params: {
			query?: string;
			tags?: string[];
			sort?: string;
			page?: number;
			pageSize?: number;
		}) => ipcRenderer.invoke("extensions:marketplace-search", params),
		extensionsMarketplaceGet: (id: string) => ipcRenderer.invoke("extensions:marketplace-get", id),
		extensionsMarketplaceInstall: (extensionId: string, downloadUrl: string) =>
			ipcRenderer.invoke("extensions:marketplace-install", extensionId, downloadUrl),
		extensionsMarketplaceSubmit: (extensionId: string) =>
			ipcRenderer.invoke("extensions:marketplace-submit", extensionId),
		extensionsReviewsList: (params: { status?: string; page?: number; pageSize?: number }) =>
			ipcRenderer.invoke("extensions:reviews-list", params),
		extensionsReviewUpdate: (reviewId: string, status: string, notes?: string) =>
			ipcRenderer.invoke("extensions:review-update", reviewId, status, notes),
	};
}