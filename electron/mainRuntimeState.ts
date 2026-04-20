import type { BrowserWindow, Menu, NativeImage, Notification, Tray } from "electron";

export const mainRuntimeState: {
	mainWindow: BrowserWindow | null;
	sourceSelectorWindow: BrowserWindow | null;
	tray: Tray | null;
	trayContextMenu: Menu | null;
	selectedSourceName: string;
	editorHasUnsavedChanges: boolean;
	isForceClosing: boolean;
	activeUpdateNotification: Notification | null;
	activeUpdateNotificationKey: string | null;
	defaultTrayIcon: NativeImage | null;
	recordingTrayIcon: NativeImage | null;
} = {
	mainWindow: null,
	sourceSelectorWindow: null,
	tray: null,
	trayContextMenu: null,
	selectedSourceName: "",
	editorHasUnsavedChanges: false,
	isForceClosing: false,
	activeUpdateNotification: null,
	activeUpdateNotificationKey: null,
	defaultTrayIcon: null,
	recordingTrayIcon: null,
};