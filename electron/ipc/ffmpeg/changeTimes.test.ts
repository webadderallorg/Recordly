import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	stdout: "",
	execFile: vi.fn(
		(
			_command: string,
			_args: string[],
			_options: unknown,
			callback: (error: null, result: { stdout: string }) => void,
		) => callback(null, { stdout: mocks.stdout }),
	),
}));

vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));
vi.mock("./binary", () => ({ getFfprobeBinaryPath: () => "/bin/ffprobe" }));

const { MAX_CHANGE_TIMES, extractScreenChangeTimesMs, selectChangeTimesMs } = await import(
	"./changeTimes"
);

const csv = (packets: [number, number, string?][]) =>
	packets.map(([ms, bytes, flags]) => `${ms / 1000},${bytes},${flags ?? "__"}`).join("\n");

beforeEach(() => {
	mocks.execFile.mockClear();
	mocks.stdout = "";
});

describe("selectChangeTimesMs", () => {
	it("keeps redraws and drops the keepalive re-appends between them", () => {
		expect(
			selectChangeTimesMs(
				csv([
					[0, 40_000, "K_"],
					[100, 9_000],
					[300, 120],
					[500, 124],
					[700, 130],
					[900, 7_400],
				]),
				1_000,
			),
		).toEqual([0, 100, 900]);
	});

	it("keeps a small frame that lands too soon after the previous one to be a keepalive", () => {
		expect(
			selectChangeTimesMs(
				csv([
					[0, 8_000, "K_"],
					[100, 9_000],
					[300, 120],
					[340, 130],
					[380, 128],
					[700, 122],
				]),
				1_000,
			),
		).toEqual([0, 100, 340, 380]);
	});

	it("keeps every keyframe even when it is the smallest packet in the stream", () => {
		expect(
			selectChangeTimesMs(
				csv([
					[0, 5_000, "K_"],
					[100, 9_000],
					[400, 118, "K_"],
					[800, 118],
				]),
				1_000,
			),
		).toEqual([0, 100, 400]);
	});

	it("ignores unparseable rows, zero-byte packets and times outside the recording", () => {
		expect(
			selectChangeTimesMs(
				`
0.000,5000,K_
N/A,9000,__
0.100,N/A,__
0.200,0,__
0.300,9000,__
-0.400,9000,__
9.000,9000,__
not a row
`,
				1_000,
			),
		).toEqual([0, 300]);
	});

	it("sorts out-of-order packets and collapses ones that round onto the same millisecond", () => {
		expect(selectChangeTimesMs("0.9,9000,__\n0.3001,9000,__\n0.2999,9000,__", 1_000)).toEqual([
			300, 900,
		]);
	});

	it("thins an over-long list down to the cap instead of truncating its tail", () => {
		const packets: [number, number, string?][] = Array.from(
			{ length: MAX_CHANGE_TIMES * 2 + 10 },
			(_, index) => [index * 10, 9_000],
		);
		const times = selectChangeTimesMs(csv(packets), packets.length * 10);
		expect(times.length).toBeLessThanOrEqual(MAX_CHANGE_TIMES);
		expect(times[0]).toBe(0);
		expect(times[times.length - 1]).toBeGreaterThan((packets.length - 10) * 10);
	});

	it("returns nothing for an empty probe", () => {
		expect(selectChangeTimesMs("", 1_000)).toEqual([]);
	});
});

describe("extractScreenChangeTimesMs", () => {
	it("probes packets rather than decoding frames", async () => {
		mocks.stdout = csv([
			[0, 40_000, "K_"],
			[200, 9_000],
			[400, 120],
		]);
		expect(await extractScreenChangeTimesMs("/rec.mp4", 1_000)).toEqual([0, 200]);
		const args = mocks.execFile.mock.calls[0][1];
		expect(args).toContain("packet=pts_time,size,flags");
		expect(args[args.length - 1]).toBe("/rec.mp4");
	});

	it("bounds the probe so a hung ffprobe cannot stall the stop handler", async () => {
		mocks.stdout = csv([[0, 40_000, "K_"]]);
		await extractScreenChangeTimesMs("/rec.mp4", 1_000);
		expect(mocks.execFile.mock.calls[0][2]).toMatchObject({
			timeout: 15_000,
			killSignal: "SIGKILL",
		});
	});

	it("skips a recording past the length limit without probing it", async () => {
		expect(await extractScreenChangeTimesMs("/long.mp4", 21 * 60_000)).toBeNull();
		expect(mocks.execFile).not.toHaveBeenCalled();
	});

	it("skips a recording with no usable duration without probing it", async () => {
		expect(await extractScreenChangeTimesMs("/broken.mp4", 0)).toBeNull();
		expect(await extractScreenChangeTimesMs("/broken.mp4", Number.NaN)).toBeNull();
		expect(mocks.execFile).not.toHaveBeenCalled();
	});

	it("returns nothing when the probe finds no packets", async () => {
		mocks.stdout = "";
		expect(await extractScreenChangeTimesMs("/silent.mp4", 1_000)).toBeNull();
	});

	it("surfaces a failing probe to the caller", async () => {
		mocks.execFile.mockImplementationOnce(
			(
				_command: string,
				_args: string[],
				_options: unknown,
				callback: (error: Error) => void,
			) => callback(new Error("ffprobe exploded")),
		);
		await expect(extractScreenChangeTimesMs("/rec.mp4", 1_000)).rejects.toThrow(
			"ffprobe exploded",
		);
	});
});

describe("streams with no keepalive floor", () => {
	it("keeps every frame when the smallest packet is a typical one", () => {
		expect(
			selectChangeTimesMs(
				csv([
					[0, 9_000, "K_"],
					[300, 9_000],
					[600, 9_100],
					[900, 9_000],
				]),
				1_000,
			),
		).toEqual([0, 300, 600, 900]);
	});
});
