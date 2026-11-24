import { expect, it, vi } from "vitest";
import { loadAppSetting } from "./appSettings";
import {
	canNameMicrophone,
	findMicrophoneName,
	loadMicrophoneNames,
	updateMicrophoneName,
} from "./microphoneNames";

vi.mock("./appSettings", () => ({ loadAppSetting: vi.fn() }));

const phone = { deviceId: "phone-1", label: "iPhone Microphone" };
const laptop = { deviceId: "builtin", label: "Laptop Microphone" };
const inputs = [phone, laptop];
const origin = "http://127.0.0.1:1234";
const restarted = "http://127.0.0.1:4321";
const names = updateMicrophoneName(phone, inputs, [], origin, "  Clip mic  ");

it("stores a trimmed display name and leaves other inputs alone", () => {
	expect(findMicrophoneName(phone, inputs, names, origin)?.name).toBe("Clip mic");
	expect(findMicrophoneName(laptop, inputs, names, origin)).toBeUndefined();
	expect(
		findMicrophoneName({ ...phone, label: "New OS name" }, inputs, names, origin)?.name,
	).toBe("Clip mic");
});

it("can edit or clear the same preference after a change of renderer origin", () => {
	const returning = { ...phone, deviceId: "new-salted-id" };
	const available = [returning, laptop];
	expect(findMicrophoneName(returning, available, names, origin)).toBeUndefined();
	expect(findMicrophoneName(returning, available, names, restarted)?.name).toBe("Clip mic");
	const edited = updateMicrophoneName(returning, available, names, restarted, "Wireless");
	expect(edited).toHaveLength(1);
	expect(edited[0]).toMatchObject({ deviceId: returning.deviceId, name: "Wireless" });
	for (const clear of ["   ", returning.label]) {
		expect(updateMicrophoneName(returning, available, names, restarted, clear)).toEqual([]);
	}
});

it("uses distinct IDs for identical labels and declines ambiguous reconnections", () => {
	const second = { ...phone, deviceId: "phone-2" };
	const both = [phone, second];
	const firstNamed = updateMicrophoneName(phone, both, [], origin, "Left");
	const bothNamed = updateMicrophoneName(second, both, firstNamed, origin, "Right");
	expect(findMicrophoneName(second, both, bothNamed, origin)?.name).toBe("Right");
	const returning = { ...phone, deviceId: "new-id" };
	expect(findMicrophoneName(returning, [returning], firstNamed, restarted)).toBeUndefined();
	expect(findMicrophoneName(returning, [second, returning], names, restarted)).toBeUndefined();
	expect(findMicrophoneName(returning, [returning], bothNamed, restarted)).toBeUndefined();
});

it("does not name system routes or inputs without a device label", () => {
	for (const deviceId of ["", "default", "communications"]) {
		expect(canNameMicrophone({ ...phone, deviceId })).toBe(false);
	}
	expect(canNameMicrophone({ ...phone, labelUnavailable: true })).toBe(false);
});

it("reads old profiles and discards invalid entries without hiding valid names", () => {
	vi.mocked(loadAppSetting).mockReturnValue(null);
	expect(loadMicrophoneNames()).toEqual([]);
	vi.mocked(loadAppSetting).mockReturnValue([null, "old", { id: 3 }, ...names]);
	expect(loadMicrophoneNames()).toEqual(names);
});
