import { expect, it, vi } from "vitest";
import { subscribePreviewReadiness } from "./previewReadiness";

function setup() {
	const listeners = new Set<{ postrender(): void }>();
	const runner = {
		name: "postrender" as string | null,
		add: (listener: { postrender(): void }) => listeners.add(listener),
		remove: vi.fn((listener: { postrender(): void }) => listeners.delete(listener)),
	};
	let valid = false;
	const onChange = vi.fn();
	const dispose = subscribePreviewReadiness({ runner, isFrameReady: () => valid, onChange });
	return {
		runner,
		onChange,
		dispose,
		decode: () => {
			valid = true;
		},
		seek: () => {
			valid = false;
		},
		render: () => {
			for (const listener of listeners) listener.postrender();
		},
	};
}

it("keeps the thumbnail until a valid composed frame has actually rendered", () => {
	const s = setup();
	s.render(); // Empty GPU scene, before a decoded image was uploaded.
	expect(s.onChange.mock.calls).toEqual([[false]]);
	s.decode(); // Media readiness alone must not reveal a blank GPU surface.
	expect(s.onChange.mock.calls).toEqual([[false]]);
	s.render();
	expect(s.onChange.mock.calls).toEqual([[false], [true]]);
	s.seek(); // Keep the last composed preview through transient decoder seeks.
	s.render();
	expect(s.onChange.mock.calls).toEqual([[false], [true]]);
	s.dispose();
	expect(s.onChange).toHaveBeenLastCalledWith(false);
});

it("cannot reveal a preview after hover/unmount cleanup", () => {
	const s = setup();
	s.dispose();
	s.decode();
	s.render();
	expect(s.onChange).not.toHaveBeenCalledWith(true);
	expect(s.runner.remove).toHaveBeenCalledOnce();
});

it("cleans up safely when React has already destroyed the renderer runner", () => {
	const s = setup();
	s.runner.name = null;
	s.runner.remove.mockImplementation(() => {
		throw new Error("Runner was destroyed");
	});
	expect(() => s.dispose()).not.toThrow();
	expect(s.runner.remove).not.toHaveBeenCalled();
});
