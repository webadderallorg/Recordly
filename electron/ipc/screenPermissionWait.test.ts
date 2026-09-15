import { describe, expect, it } from "vitest";
import { createScreenPermissionWaitController } from "./screenPermissionWait";

function createHarness(now: () => number = () => Date.now()) {
	const events: string[] = [];
	const controller = createScreenPermissionWaitController(
		{
			onWaitStarted: () => {
				events.push("started");
			},
			onWaitEnded: (granted) => {
				events.push(granted ? "ended:granted" : "ended:denied");
			},
		},
		{ now },
	);
	return { controller, events };
}

describe("createScreenPermissionWaitController", () => {
	it("reports the wait as started when begun", async () => {
		const { controller, events } = createHarness();

		const wait = controller.begin();
		expect(events).toEqual(["started"]);
		expect(controller.isPending()).toBe(true);

		controller.end(true);
		await expect(wait).resolves.toEqual({ success: true, cancelled: false });
	});

	it("rejects a second begin while a wait is already pending", async () => {
		const { controller } = createHarness();

		const wait = controller.begin();
		expect(controller.begin()).toBeNull();

		controller.end(false);
		await expect(wait).resolves.toEqual({ success: false, cancelled: true });
	});

	it("resolves granted when the renderer reports acceptance", async () => {
		const { controller, events } = createHarness();

		const wait = controller.begin();
		controller.end(true);

		await expect(wait).resolves.toEqual({ success: true, cancelled: false });
		expect(events).toEqual(["started", "ended:granted"]);
		expect(controller.isPending()).toBe(false);
	});

	it("resolves cancelled when the renderer reports denial", async () => {
		const { controller, events } = createHarness();

		const wait = controller.begin();
		controller.end(false);

		await expect(wait).resolves.toEqual({ success: false, cancelled: true });
		expect(events).toEqual(["started", "ended:denied"]);
	});

	it("resolves cancelled when the user cancels from the overlay", async () => {
		const { controller, events } = createHarness();

		const wait = controller.begin();
		controller.cancel();

		await expect(wait).resolves.toEqual({ success: false, cancelled: true });
		expect(events).toEqual(["started", "ended:denied"]);
		expect(controller.isPending()).toBe(false);
	});

	it("end and cancel are no-ops when nothing is pending", () => {
		const { controller, events } = createHarness();

		expect(controller.end(true)).toBe(false);
		expect(controller.cancel()).toBe(false);
		expect(events).toEqual([]);
	});

	it("supports a new cycle after the previous wait settles", async () => {
		const { controller } = createHarness();

		const first = controller.begin();
		controller.end(true);
		await first;

		const second = controller.begin();
		expect(controller.isPending()).toBe(true);
		controller.cancel();
		await expect(second).resolves.toEqual({ success: false, cancelled: true });
	});
});

describe("post-grant overlay cancel race", () => {
	it("blocks the next countdown start when the overlay is clicked after the grant", () => {
		const { controller, events } = createHarness();

		controller.begin();
		controller.end(true);
		// User clicks the overlay between the grant resolution and the
		// renderer calling start-countdown.
		controller.cancel();

		expect(controller.consumeCountdownStartGate()).toBe(true);
		expect(events).toEqual(["started", "ended:granted", "ended:denied"]);
	});

	it("consumes the block on the first gate check so later starts pass", () => {
		const { controller } = createHarness();

		controller.begin();
		controller.end(true);
		controller.cancel();

		expect(controller.consumeCountdownStartGate()).toBe(true);
		expect(controller.consumeCountdownStartGate()).toBe(false);
	});

	it("allows the countdown start after a clean grant", () => {
		const { controller } = createHarness();

		controller.begin();
		controller.end(true);

		expect(controller.consumeCountdownStartGate()).toBe(false);
	});

	it("an inert cancel (no wait in flight) never arms the gate", () => {
		const { controller } = createHarness();

		controller.cancel();

		expect(controller.consumeCountdownStartGate()).toBe(false);
	});

	it("expires the post-grant cancel signal after the race window", () => {
		let nowMs = 0;
		const { controller } = createHarness(() => nowMs);

		controller.begin();
		controller.end(true);
		controller.cancel();

		nowMs = 2_500;
		expect(controller.consumeCountdownStartGate()).toBe(false);
	});

	it("a new begin recycles a granted wait left pending", () => {
		const { controller } = createHarness();

		controller.begin();
		controller.end(true);

		const second = controller.begin();
		expect(second).not.toBeNull();
		controller.end(false);
	});
});

describe("awaiting overlay state", () => {
	it("reports awaiting only while the wait is pending", () => {
		const { controller } = createHarness();

		expect(controller.isAwaitingOverlay()).toBe(false);
		controller.begin();
		expect(controller.isAwaitingOverlay()).toBe(true);
		controller.end(true);
		expect(controller.isAwaitingOverlay()).toBe(false);
	});
});
