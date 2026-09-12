import { describe, expect, it } from "vitest";
import { parseGradientBackground } from "./gradientBackground";

describe("parseGradientBackground", () => {
	it("returns null for non-gradient input", () => {
		expect(parseGradientBackground("#ff0000")).toBeNull();
		expect(parseGradientBackground("/wallpapers/tahoe.jpg")).toBeNull();
		expect(parseGradientBackground("")).toBeNull();
	});

	it("keeps rgba() colors intact instead of splitting on their inner commas", () => {
		// Regression: the previous `params.split(",")` shredded `rgba(...)` into
		// fragments, producing the literal color "rgba" and a black fallback.
		const parsed = parseGradientBackground(
			"linear-gradient( 111.6deg,  rgba(114,167,232,1) 9.4%, rgba(253,129,82,1) 43.9%, rgba(249,202,86,1) 86.3% )",
		);
		expect(parsed).not.toBeNull();
		expect(parsed?.type).toBe("linear");
		expect(parsed?.stops).toEqual([
			{ color: "rgba(114,167,232,1)", position: 0.094 },
			{ color: "rgba(253,129,82,1)", position: 0.439 },
			{ color: "rgba(249,202,86,1)", position: 0.863 },
		]);
	});

	it("preserves spaces inside rgba() color functions", () => {
		const parsed = parseGradientBackground(
			"linear-gradient( 111.6deg,  rgba(0,56,68,1) 0%, rgba(231, 148, 6, 1) 88.6% )",
		);
		expect(parsed?.stops.map((stop) => stop.color)).toEqual([
			"rgba(0,56,68,1)",
			"rgba(231, 148, 6, 1)",
		]);
	});

	it("places the first color at offset 0 when a direction token is present", () => {
		// Regression: the leading `120deg` used to consume index 0, pushing the
		// first color to offset 0.5 and ignoring the explicit 0%/100% stops.
		const parsed = parseGradientBackground(
			"linear-gradient(120deg, #d4fc79 0%, #96e6a1 100%)",
		);
		expect(parsed?.stops).toEqual([
			{ color: "#d4fc79", position: 0 },
			{ color: "#96e6a1", position: 1 },
		]);
	});

	it("strips `to <side>` direction keywords", () => {
		const parsed = parseGradientBackground(
			"linear-gradient(to right, #4facfe 0%, #00f2fe 100%)",
		);
		expect(parsed?.stops).toEqual([
			{ color: "#4facfe", position: 0 },
			{ color: "#00f2fe", position: 1 },
		]);
	});

	it("strips the radial shape/position descriptor and keeps rgba stops", () => {
		const parsed = parseGradientBackground(
			"radial-gradient( circle farthest-corner at 3.2% 49.6%,  rgba(80,12,139,0.87) 0%, rgba(161,10,144,0.72) 83.6% )",
		);
		expect(parsed?.type).toBe("radial");
		expect(parsed?.stops).toEqual([
			{ color: "rgba(80,12,139,0.87)", position: 0 },
			{ color: "rgba(161,10,144,0.72)", position: 0.836 },
		]);
	});

	it("distributes stops evenly when no explicit positions are given", () => {
		const parsed = parseGradientBackground(
			"linear-gradient(135deg, #FBC8B4, #2447B1)",
		);
		expect(parsed?.stops).toEqual([
			{ color: "#FBC8B4", position: 0 },
			{ color: "#2447B1", position: 1 },
		]);

		const triple = parseGradientBackground(
			"linear-gradient(90deg, #ff0000, #00ff00, #0000ff)",
		);
		expect(triple?.stops.map((stop) => stop.position)).toEqual([0, 0.5, 1]);
	});

	it("interpolates interior stops that omit an explicit position", () => {
		const parsed = parseGradientBackground(
			"linear-gradient(90deg, #000 0%, #888, #fff 100%)",
		);
		expect(parsed?.stops.map((stop) => stop.position)).toEqual([0, 0.5, 1]);
	});

	it("keeps offsets non-decreasing and clamped to [0, 1]", () => {
		const parsed = parseGradientBackground(
			"linear-gradient(90deg, #111 50%, #222 20%, #333 150%)",
		);
		const positions = parsed?.stops.map((stop) => stop.position) ?? [];
		expect(positions).toEqual([0.5, 0.5, 1]);
		for (const position of positions) {
			expect(position).toBeGreaterThanOrEqual(0);
			expect(position).toBeLessThanOrEqual(1);
		}
	});

	it("supports named colors", () => {
		const parsed = parseGradientBackground("linear-gradient(to top, red, blue)");
		expect(parsed?.stops).toEqual([
			{ color: "red", position: 0 },
			{ color: "blue", position: 1 },
		]);
	});

	it("parses every built-in gradient preset into valid, ordered stops", () => {
		const presets = [
			"linear-gradient( 111.6deg,  rgba(114,167,232,1) 9.4%, rgba(253,129,82,1) 43.9%, rgba(253,129,82,1) 54.8%, rgba(249,202,86,1) 86.3% )",
			"linear-gradient(120deg, #d4fc79 0%, #96e6a1 100%)",
			"radial-gradient( circle farthest-corner at 3.2% 49.6%,  rgba(80,12,139,0.87) 0%, rgba(161,10,144,0.72) 83.6% )",
			"linear-gradient( 111.6deg,  rgba(0,56,68,1) 0%, rgba(163,217,185,1) 51.5%, rgba(231, 148, 6, 1) 88.6% )",
			"linear-gradient( 107.7deg,  rgba(235,230,44,0.55) 8.4%, rgba(252,152,15,1) 90.3% )",
			"linear-gradient( 91deg,  rgba(72,154,78,1) 5.2%, rgba(251,206,70,1) 95.9% )",
			"radial-gradient( circle farthest-corner at 10% 20%,  rgba(2,37,78,1) 0%, rgba(4,56,126,1) 19.7%, rgba(85,245,221,1) 100.2% )",
			"linear-gradient( 109.6deg,  rgba(15,2,2,1) 11.2%, rgba(36,163,190,1) 91.1% )",
			"linear-gradient(135deg, #FBC8B4, #2447B1)",
			"linear-gradient(45deg, #ff9a9e 0%, #fad0c4 99%, #fad0c4 100%)",
			"linear-gradient(to right, #ff8177 0%, #ff867a 0%, #ff8c7f 21%, #f99185 52%, #cf556c 78%, #b12a5b 100%)",
			"linear-gradient(to top, #fcc5e4 0%, #fda34b 15%, #ff7882 35%, #c8699e 52%, #7046aa 71%, #0c1db8 87%, #020f75 100%)",
		];

		for (const preset of presets) {
			const parsed = parseGradientBackground(preset);
			expect(parsed, preset).not.toBeNull();
			expect(parsed?.stops.length ?? 0, preset).toBeGreaterThanOrEqual(2);

			let previous = -1;
			for (const stop of parsed?.stops ?? []) {
				// No fragment should ever look like a torn-apart rgba() call.
				expect(stop.color, preset).not.toBe("rgba");
				expect(stop.color, preset).not.toBe("rgb");
				expect(stop.color, preset).toMatch(/^(#|rgba?\(|hsla?\(|[a-z]+$)/);
				expect(stop.position, preset).toBeGreaterThanOrEqual(0);
				expect(stop.position, preset).toBeLessThanOrEqual(1);
				expect(stop.position, preset).toBeGreaterThanOrEqual(previous);
				previous = stop.position;
			}
		}
	});
});
