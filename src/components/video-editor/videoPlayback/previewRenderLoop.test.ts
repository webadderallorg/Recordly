import { describe, expect, it, vi } from "vitest";
import { createPreviewRenderLoop } from "./previewRenderLoop";

function setup() {
	const callbacks = new Map<number, FrameRequestCallback>();
	let nextId = 0;
	const ticker = {
		started: false,
		start: vi.fn(() => {
			ticker.started = true;
		}),
		stop: vi.fn(() => {
			ticker.started = false;
		}),
	};
	const compose = vi.fn();
	const render = vi.fn();
	const loop = createPreviewRenderLoop({
		ticker,
		compose,
		render,
		requestFrame: (callback) => {
			callbacks.set(++nextId, callback);
			return nextId;
		},
		cancelFrame: (id) => {
			callbacks.delete(id);
		},
	});
	const flush = () => {
		const pending = [...callbacks.values()];
		callbacks.clear();
		for (const callback of pending) callback(0);
	};
	return { loop, ticker, callbacks, compose, render, flush };
}

describe("preview rendering", () => {
	it("coalesces paused edits, composes before drawing, then stays idle", () => {
		const s = setup();
		for (let i = 0; i < 100; i++) s.loop.requestRender();
		expect(s.callbacks.size).toBe(1);
		s.flush();
		expect(s.compose).toHaveBeenCalledOnce();
		expect(s.render).toHaveBeenCalledOnce();
		expect(s.compose.mock.invocationCallOrder[0]).toBeLessThan(
			s.render.mock.invocationCallOrder[0],
		);
		expect(s.callbacks.size).toBe(0);
		expect(s.ticker.start).not.toHaveBeenCalled();
	});

	it("starts once for playback, cancels pending paused work, and stops once on pause", () => {
		const s = setup();
		s.loop.requestRender();
		s.loop.setState(true, false);
		s.loop.setState(true, false);
		s.loop.requestRender();
		expect(s.callbacks.size).toBe(0);
		expect(s.ticker.start).toHaveBeenCalledOnce();
		s.loop.setState(false, false);
		s.loop.setState(false, false);
		expect(s.ticker.stop).toHaveBeenCalledOnce();
		s.flush();
		expect(s.render).toHaveBeenCalledOnce();
		expect(s.callbacks.size).toBe(0);
	});

	it("suspends pending work and refreshes once when a paused preview resumes", () => {
		const s = setup();
		s.loop.requestRender();
		s.loop.setState(false, true);
		s.loop.requestRender();
		s.flush();
		expect(s.render).not.toHaveBeenCalled();
		s.loop.setState(false, false);
		s.flush();
		expect(s.render).toHaveBeenCalledOnce();
	});

	it("disposes pending callbacks and the continuous ticker", () => {
		const s = setup();
		s.loop.setState(true, false);
		s.loop.setState(false, false);
		s.loop.dispose();
		s.loop.requestRender();
		s.loop.setState(true, false);
		s.flush();
		expect(s.render).not.toHaveBeenCalled();
		expect(s.ticker.started).toBe(false);
	});
});
