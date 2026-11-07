import { describe, expect, it, vi } from "vitest";
import { createHoverCompositionGate, type HoverCompositionStatus } from "./projectHoverReadiness";

function setup() {
	const status: HoverCompositionStatus = {
		prerequisitesReady: false,
		canRetain: true,
		frameValid: true,
		key: "source:640x360",
		revision: 1,
	};
	const requestComposition = vi.fn();
	const onVisibilityChange = vi.fn();
	const gate = createHoverCompositionGate({
		read: () => status,
		requestComposition,
		onVisibilityChange,
	});
	return { status, gate, requestComposition, onVisibilityChange };
}
describe("hover composition loading", () => {
	it("never exposes the early main frame while another composition resource is loading", () => {
		const s = setup();
		s.gate.postrender();
		expect(s.onVisibilityChange.mock.calls).toEqual([[false]]);
		s.status.prerequisitesReady = true;
		s.gate.refresh();
		expect(s.requestComposition).toHaveBeenCalledOnce();
		s.gate.postrender(); // A resize/render of the old frame cannot satisfy the gate.
		expect(s.onVisibilityChange.mock.calls).toEqual([[false]]);
		s.status.revision++;
		s.gate.postrender();
		expect(s.onVisibilityChange.mock.calls).toEqual([[false], [true]]);
	});
	it("waits for the corrected viewport rather than a frame composed at fallback geometry", () => {
		const s = setup();
		s.status.prerequisitesReady = true;
		s.status.canRetain = false;
		s.gate.refresh();
		s.status.revision++;
		s.gate.postrender();
		expect(s.onVisibilityChange.mock.calls).toEqual([[false]]);
		expect(s.requestComposition).toHaveBeenCalledTimes(2);
		s.status.canRetain = true;
		s.status.revision++;
		s.gate.postrender();
		expect(s.onVisibilityChange).toHaveBeenLastCalledWith(true);
	});
	it("holds an already complete frame during decoder seeks but hides invalid geometry", () => {
		const s = setup();
		s.status.prerequisitesReady = true;
		s.gate.refresh();
		s.status.revision++;
		s.gate.postrender();
		s.status.frameValid = false;
		s.gate.postrender();
		expect(s.onVisibilityChange.mock.calls).toEqual([[false], [true]]);
		s.status.key = "source:360x640";
		s.status.canRetain = false;
		s.gate.postrender();
		expect(s.onVisibilityChange).toHaveBeenLastCalledWith(false);
		s.status.canRetain = true;
		s.status.frameValid = true;
		s.gate.postrender();
		expect(s.onVisibilityChange).toHaveBeenLastCalledWith(false);
		s.status.revision++;
		s.gate.postrender();
		expect(s.onVisibilityChange).toHaveBeenLastCalledWith(true);
	});
	it("rejects a late completion after hover exit and requires a fresh frame for new resources", () => {
		const s = setup();
		s.status.prerequisitesReady = true;
		s.gate.refresh();
		s.status.revision++;
		s.gate.postrender();
		s.status.prerequisitesReady = false;
		s.gate.refresh();
		expect(s.onVisibilityChange).toHaveBeenLastCalledWith(false);
		s.status.prerequisitesReady = true;
		s.gate.refresh();
		s.gate.postrender();
		expect(s.onVisibilityChange).toHaveBeenLastCalledWith(false);
		s.gate.dispose();
		s.status.revision++;
		s.gate.postrender();
		s.gate.refresh();
		expect(s.onVisibilityChange.mock.calls).toEqual([[false], [true], [false]]);
	});
	it("requests a fresh paused composition when a secondary decoder settles after the last draw", () => {
		const s = setup();
		s.status.prerequisitesReady = true;
		s.status.frameValid = false;
		s.gate.refresh();
		s.status.revision++;
		s.gate.postrender();
		expect(s.onVisibilityChange.mock.calls).toEqual([[false]]);
		s.status.frameValid = true;
		s.gate.refresh();
		expect(s.requestComposition).toHaveBeenCalledTimes(2);
		s.gate.refresh(); // Repeated settled notifications cannot queue duplicate draws.
		expect(s.requestComposition).toHaveBeenCalledTimes(2);
		s.gate.postrender();
		expect(s.onVisibilityChange.mock.calls).toEqual([[false]]);
		s.status.revision++;
		s.gate.postrender();
		expect(s.onVisibilityChange).toHaveBeenLastCalledWith(true);
		s.gate.refresh();
		expect(s.requestComposition).toHaveBeenCalledTimes(2);
	});
});
