import { expect, it, vi } from "vitest";
import { createAnnotationFrameStore } from "./annotationFrameStore";

it("retains the latest camera frame without a React subscriber", () => {
	const store = createAnnotationFrameStore();
	const frame = { timeMs: 42, transform: { scale: 2, x: 10, y: -5 } };
	expect(store.hasSubscribers()).toBe(false);
	store.publish(frame);
	expect(store.getSnapshot()).toBe(frame);
});

it("notifies only subscribed overlays and retains snapshot identity for an unchanged pose", () => {
	const store = createAnnotationFrameStore();
	const listener = vi.fn();
	const unsubscribe = store.subscribe(listener);
	const frame = { timeMs: 42, transform: { scale: 2, x: 10, y: -5 } };
	store.publish(frame);
	store.publish({ ...frame, transform: { ...frame.transform } });
	expect(store.getSnapshot()).toBe(frame);
	expect(listener).toHaveBeenCalledOnce();
	unsubscribe();
	store.publish({ ...frame, timeMs: 50 });
	expect(store.hasSubscribers()).toBe(false);
	expect(listener).toHaveBeenCalledOnce();
});
