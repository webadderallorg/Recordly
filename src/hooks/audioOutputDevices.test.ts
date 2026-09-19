import { describe, expect, it } from "vitest";
import {
	type AudioOutputDevice,
	enrichNativeAudioOutputLabels,
	getDefaultAudioOutputLabel,
	isLatestAudioOutputDeviceRequest,
	resolveAudioOutputDeviceSelection,
} from "./audioOutputDevices";

const devices: AudioOutputDevice[] = [
	{ deviceId: "default", label: "系统默认设备", groupId: "default" },
	{ deviceId: "speakers-1", label: "扬声器 (Realtek)", groupId: "group-1" },
	{ deviceId: "headphones-1", label: "耳机 (USB Audio)", groupId: "group-2" },
];

describe("resolveAudioOutputDeviceSelection", () => {
	it("keeps a preferred output device when it is still present", () => {
		expect(
			resolveAudioOutputDeviceSelection(devices, "headphones-1", "耳机 (USB Audio)"),
		).toEqual({ deviceId: "headphones-1", label: "耳机 (USB Audio)" });
	});

	it("falls back to the matching label when a browser device id changed", () => {
		const currentDevices = [
			{ deviceId: "new-headphones-id", label: "耳机 (USB Audio)", groupId: "group-2" },
			devices[0],
		];

		expect(
			resolveAudioOutputDeviceSelection(currentDevices, "headphones-1", "耳机 (USB Audio)"),
		).toEqual({ deviceId: "new-headphones-id", label: "耳机 (USB Audio)" });
	});

	it("uses the default output when no preferred device is available", () => {
		expect(resolveAudioOutputDeviceSelection(devices, "missing", "已拔出设备")).toEqual({
			deviceId: "default",
			label: "系统默认设备",
		});
	});

	it("returns the first output when the platform does not expose a default entry", () => {
		const physicalOnly = devices.slice(1);
		expect(resolveAudioOutputDeviceSelection(physicalOnly, undefined, undefined)).toEqual({
			deviceId: "speakers-1",
			label: "扬声器 (Realtek)",
		});
	});

	it("returns the default selection when no outputs are exposed", () => {
		expect(resolveAudioOutputDeviceSelection([], "missing", "已拔出设备")).toEqual({
			deviceId: "default",
			label: "Default output",
		});
	});
});

describe("audio output device request ordering", () => {
	it("only accepts the latest request result", () => {
		expect(isLatestAudioOutputDeviceRequest(1, 2)).toBe(false);
		expect(isLatestAudioOutputDeviceRequest(2, 2)).toBe(true);
	});
});

describe("enrichNativeAudioOutputLabels", () => {
	it("uses the browser label with the USB vendor and product ID", () => {
		const nativeDevices = [{ deviceId: "native-yeti", label: "扬声器 (Yeti Nano)" }];
		const browserDevices = [
			{
				deviceId: "browser-yeti",
				label: "Default - 扬声器 (Yeti Nano) (046d:0acf)",
				groupId: "",
			},
		];

		expect(enrichNativeAudioOutputLabels(nativeDevices, browserDevices)).toEqual([
			{ deviceId: "native-yeti", label: "扬声器 (Yeti Nano) (046d:0acf)" },
		]);
	});

	it("keeps the native label when no matching USB label is available", () => {
		const nativeDevices = [{ deviceId: "native-realtek", label: "扬声器 (Realtek(R) Audio)" }];
		const browserDevices = [
			{
				deviceId: "browser-other",
				label: "扬声器 (Yeti Nano) (046d:0acf)",
				groupId: "",
			},
			{
				deviceId: "browser-realtek",
				label: "扬声器 (Realtek(R) Audio)",
				groupId: "",
			},
		];

		expect(enrichNativeAudioOutputLabels(nativeDevices, browserDevices)).toEqual([
			{ deviceId: "native-realtek", label: "扬声器 (Realtek(R) Audio)" },
		]);
	});

	it("does not confuse similarly named output devices", () => {
		const nativeDevices = [{ deviceId: "native-yeti", label: "扬声器 (Yeti Nano)" }];
		const browserDevices = [
			{
				deviceId: "browser-yeti-pro",
				label: "扬声器 (Yeti Nano Pro) (046d:0ad0)",
				groupId: "",
			},
		];

		expect(enrichNativeAudioOutputLabels(nativeDevices, browserDevices)).toEqual([
			{ deviceId: "native-yeti", label: "扬声器 (Yeti Nano)" },
		]);
	});
});

describe("getDefaultAudioOutputLabel", () => {
	it("keeps the Default role and enriches the selected output label", () => {
		const browserDevices = [
			{
				deviceId: "default",
				label: "Default - 扬声器 (Yeti Nano) (046D:0ACF)",
				groupId: "",
			},
		];

		expect(getDefaultAudioOutputLabel(browserDevices)).toBe(
			"Default - 扬声器 (Yeti Nano) (046d:0acf)",
		);
	});

	it("falls back to the generic label when the browser exposes no default output", () => {
		expect(
			getDefaultAudioOutputLabel([
				{ deviceId: "speaker-1", label: "扬声器 (Yeti Nano)", groupId: "" },
			]),
		).toBe("Default output");
	});

	it("does not treat the blank-label placeholder as a real default name", () => {
		expect(
			getDefaultAudioOutputLabel([
				{ deviceId: "default", label: "Output default", groupId: "" },
			]),
		).toBe("Default output");
	});
});
