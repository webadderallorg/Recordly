import type { BrowserWindow } from "electron";

export const permissionAccessoryWindowOwners = new WeakMap<BrowserWindow, BrowserWindow>();
