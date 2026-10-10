import { EventEmitter } from "node:events";
import type { BrowserWindow, WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { createSourceListPicker } from "./sourceListPicker";

function fixture() {
	const win = Object.assign(new EventEmitter(), { webContents: {} as WebContents });
	const create = vi.fn(() => win as unknown as BrowserWindow);
	return { win, create, picker: createSourceListPicker(create) };
}
describe("source list picker lifecycle", () => {
	it("coalesces opens, accepts its own sender, and waits for a selection", async () => {
		const { win, create, picker } = fixture();
		const first = picker.open();
		expect(picker.open()).toBe(first);
		expect(create).toHaveBeenCalledOnce();
		expect(picker.isSender(win.webContents)).toBe(true);
		expect(picker.isSender({} as WebContents)).toBe(false);
		const source = { id: "window:101:0", name: "Document" };
		picker.complete(source);
		win.emit("closed");
		expect(await first).toEqual({ success: true, source });
		expect(picker.isSender(win.webContents)).toBe(false);
	});
	it("resolves dismissal and allows another picker afterwards", async () => {
		const { win, create, picker } = fixture();
		const first = picker.open();
		win.emit("closed");
		expect(await first).toEqual({ success: false, canceled: true });
		const second = picker.open();
		expect(create).toHaveBeenCalledTimes(2);
		win.emit("closed");
		expect(await second).toEqual({ success: false, canceled: true });
	});
});
