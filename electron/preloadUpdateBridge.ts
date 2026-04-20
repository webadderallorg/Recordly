import type { IpcRenderer, IpcRendererEvent } from "electron";

export function createUpdateBridge(ipcRenderer: IpcRenderer) {
	return {
		installDownloadedUpdate: () => ipcRenderer.invoke("install-downloaded-update"),
		downloadAvailableUpdate: () => ipcRenderer.invoke("download-available-update"),
		deferDownloadedUpdate: (delayMs?: number) =>
			ipcRenderer.invoke("defer-downloaded-update", delayMs),
		dismissUpdateToast: () => ipcRenderer.invoke("dismiss-update-toast"),
		skipUpdateVersion: () => ipcRenderer.invoke("skip-update-version"),
		getCurrentUpdateToastPayload: () => ipcRenderer.invoke("get-current-update-toast-payload"),
		getUpdateStatusSummary: () => ipcRenderer.invoke("get-update-status-summary"),
		previewUpdateToast: () => ipcRenderer.invoke("preview-update-toast"),
		checkForAppUpdates: () => ipcRenderer.invoke("check-for-app-updates"),
		onUpdateToastStateChanged: (
			callback: (payload: UpdateToastState | null) => void,
		) => {
			const listener = (_event: IpcRendererEvent, payload: UpdateToastState | null) =>
				callback(payload);
			ipcRenderer.on("update-toast-state", listener);
			return () => ipcRenderer.removeListener("update-toast-state", listener);
		},
		onUpdateReadyToast: (
			callback: (payload: {
				version: string;
				detail: string;
				delayMs: number;
				isPreview?: boolean;
			}) => void,
		) => {
			const listener = (
				_event: IpcRendererEvent,
				payload: { version: string; detail: string; delayMs: number; isPreview?: boolean },
			) => callback(payload);
			ipcRenderer.on("update-ready-toast", listener);
			return () => ipcRenderer.removeListener("update-ready-toast", listener);
		},
		onMenuLoadProject: (callback: () => void) => {
			const listener = () => callback();
			ipcRenderer.on("menu-load-project", listener);
			return () => ipcRenderer.removeListener("menu-load-project", listener);
		},
		onMenuSaveProject: (callback: () => void) => {
			const listener = () => callback();
			ipcRenderer.on("menu-save-project", listener);
			return () => ipcRenderer.removeListener("menu-save-project", listener);
		},
		onMenuSaveProjectAs: (callback: () => void) => {
			const listener = () => callback();
			ipcRenderer.on("menu-save-project-as", listener);
			return () => ipcRenderer.removeListener("menu-save-project-as", listener);
		},
	};
}