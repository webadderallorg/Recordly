import { describe, expect, it, vi } from "vitest";
import type { WebDemuxer } from "web-demuxer";
import { getVideoDecoderConfig } from "./videoDecoderConfig";

type Packet = { keyframe: 0 | 1; data: Uint8Array };

function source(codec = "vp09", metadata: Record<string, unknown> = {}) {
	const config: VideoDecoderConfig = {
		codec,
		codedWidth: 1876,
		codedHeight: 954,
		hardwareAcceleration: "prefer-software",
		colorSpace: { primaries: "bt709" },
	};
	const getMediaInfo = vi.fn().mockResolvedValue({
		duration: 10,
		start_time: 0,
		streams: [
			{ codec_type_string: "audio", codec_string: "opus" },
			{
				index: 1,
				codec_type_string: "video",
				profile: "Profile 0",
				pix_fmt: "yuv420p",
				level: -99,
				avg_frame_rate: "60/1",
				bit_rate: "0",
				...metadata,
			},
		],
	});
	let packets: Packet[] = [];
	const cancel = vi.fn();
	const readMediaPacket = vi.fn(
		() =>
			new ReadableStream<Packet>({
				pull(controller) {
					const next = packets.shift();
					if (next) controller.enqueue(next);
					else controller.close();
				},
				cancel,
			}),
	);
	const demuxer = {
		readMediaPacket,
		getDecoderConfig: vi.fn().mockResolvedValue(config),
		getMediaInfo,
		getMediaStream: vi.fn().mockResolvedValue({ index: 1 }),
	} as unknown as WebDemuxer;
	const setPackets = (next: Packet[]) => {
		packets = next;
	};
	return { config, demuxer, getMediaInfo, readMediaPacket, setPackets, cancel };
}

function keyframeBytes(profile: number, bitDepth: number): Uint8Array {
	// Frame marker, profile (low bit first), optional reserved bit, keyframe flags,
	// sync code and optional high-bit-depth selector.
	const bits =
		`10${profile & 1}${profile >> 1}${profile === 3 ? "0" : ""}0010` +
		"010010011000001101000010" +
		(profile >= 2 ? (bitDepth === 12 ? "1" : "0") : "");
	const padded = bits.padEnd(Math.ceil(bits.length / 8) * 8, "0");
	return Uint8Array.from(padded.match(/.{8}/g) ?? [], (byte) => Number.parseInt(byte, 2));
}

describe("getVideoDecoderConfig", () => {
	it.each(["vp09", "vp9"])("expands %s for a 1876x954 60fps recording", async (codec) => {
		const { config, demuxer } = source(codec);
		expect(await getVideoDecoderConfig(demuxer)).toEqual({
			...config,
			codec: "vp09.00.41.08",
		});
		expect(config.codec).toBe(codec);
	});

	it.each([
		"vp09.02.41.10",
		"vp09.00.41.08.01.01.01.01.00",
		"avc1.640034",
		"vp8",
		"av01.0.08M.08",
	])("preserves an existing %s config without fetching metadata", async (codec) => {
		const { config, demuxer, getMediaInfo } = source(codec);
		expect(await getVideoDecoderConfig(demuxer)).toBe(config);
		expect(getMediaInfo).not.toHaveBeenCalled();
	});

	it.each([
		"h264",
		"avc1",
		"avc1.2420015",
	])("reconstructs %s from the AVC configuration record", async (codec) => {
		const { config, demuxer, readMediaPacket } = source(codec);
		const bytes = Uint8Array.from([
			0, 1, 0x64, 0x08, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0x08, 0x28, 0,
		]);
		config.description = bytes.subarray(1);

		expect(await getVideoDecoderConfig(demuxer)).toEqual({
			...config,
			codec: "avc1.640828",
		});
		expect(readMediaPacket).not.toHaveBeenCalled();
	});

	it("uses the sequence parameter set in an Annex B keyframe when there is no description", async () => {
		const { config, demuxer, setPackets, cancel } = source("avc1.2420015");
		setPackets([
			{ keyframe: 0, data: Uint8Array.from([0, 0, 1, 0x41, 0xff]) },
			{
				keyframe: 1,
				data: Uint8Array.from([
					0, 0, 0, 1, 0x09, 0xf0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x15, 0x89, 0, 0, 1, 0x68,
					0xce,
				]),
			},
		]);

		expect(await getVideoDecoderConfig(demuxer)).toEqual({ ...config, codec: "avc1.42c015" });
		expect(cancel).toHaveBeenCalledOnce();
	});

	it("keeps the original config if an Annex B keyframe has no usable SPS", async () => {
		const { config, demuxer, setPackets } = source("h264");
		setPackets([{ keyframe: 1, data: Uint8Array.from([0, 0, 1, 0x65, 0x64, 0x00, 0x28]) }]);
		expect(await getVideoDecoderConfig(demuxer)).toBe(config);
	});

	it.each([
		["Profile 1", "yuv444p", "01.41.08"],
		["Profile 2", "yuv420p10le", "02.41.10"],
		["Profile 2", "yuv420p12be", "02.41.12"],
		["Profile 3", "yuv422p10le", "03.41.10"],
		["unknown", "gbrp12le", "03.41.12"],
	])("uses %s / %s instead of assuming 8-bit profile 0", async (profile, pix_fmt, suffix) => {
		const { demuxer } = source("vp09", { profile, pix_fmt });
		expect((await getVideoDecoderConfig(demuxer)).codec).toBe(`vp09.${suffix}`);
	});

	it("preserves a declared level and accounts for bitrate", async () => {
		expect((await getVideoDecoderConfig(source("vp09", { level: 51 }).demuxer)).codec).toBe(
			"vp09.00.51.08",
		);
		expect(
			(await getVideoDecoderConfig(source("vp09", { bit_rate: "40000000" }).demuxer)).codec,
		).toBe("vp09.00.50.08");
	});

	it("does not probe packets when source metadata is complete", async () => {
		const { demuxer, readMediaPacket } = source();
		await getVideoDecoderConfig(demuxer);
		expect(readMediaPacket).not.toHaveBeenCalled();
	});

	it.each([
		[0, 8],
		[1, 8],
		[2, 10],
		[2, 12],
		[3, 10],
		[3, 12],
	])("reads profile %i / %i-bit from a keyframe when metadata is missing", async (profile, bitDepth) => {
		const { demuxer, setPackets, cancel } = source("vp09", { pix_fmt: "", profile: "unknown" });
		setPackets([{ keyframe: 1, data: keyframeBytes(profile, bitDepth) }]);
		expect((await getVideoDecoderConfig(demuxer)).codec).toBe(
			`vp09.0${profile}.41.${String(bitDepth).padStart(2, "0")}`,
		);
		expect(cancel).toHaveBeenCalledOnce();
	});

	it("returns when the demuxer never settles stream cancellation", async () => {
		vi.useFakeTimers();
		try {
			const { demuxer, setPackets, cancel } = source("vp09", {
				pix_fmt: "",
				profile: "unknown",
			});
			cancel.mockReturnValue(new Promise(() => {}));
			setPackets([{ keyframe: 1, data: keyframeBytes(0, 8) }]);
			const result = getVideoDecoderConfig(demuxer);
			await vi.advanceTimersByTimeAsync(1000);
			expect((await result).codec).toBe("vp09.00.41.08");
		} finally {
			vi.useRealTimers();
		}
	});

	it("reads metadata from the video track the decoder selects", async () => {
		const { demuxer, getMediaInfo } = source();
		getMediaInfo.mockResolvedValue({
			duration: 10,
			start_time: 0,
			streams: [
				{ index: 0, codec_type_string: "video", profile: "Profile 0", pix_fmt: "yuv420p" },
				{
					index: 1,
					codec_type_string: "video",
					profile: "Profile 2",
					pix_fmt: "yuv420p10le",
				},
			],
		});
		expect((await getVideoDecoderConfig(demuxer)).codec).toMatch(/^vp09\.02\.\d\d\.10$/);
	});

	it("skips leading delta packets until the first keyframe", async () => {
		const { demuxer, setPackets } = source("vp09", { pix_fmt: "", profile: "unknown" });
		setPackets([
			{ keyframe: 0, data: Uint8Array.from([0x86, 0x49, 0x83, 0x42]) },
			{ keyframe: 1, data: keyframeBytes(2, 10) },
		]);
		expect((await getVideoDecoderConfig(demuxer)).codec).toBe("vp09.02.41.10");
	});

	it("rejects a stream with no keyframe", async () => {
		const { demuxer, setPackets } = source("vp09", { pix_fmt: "", profile: "unknown" });
		setPackets([{ keyframe: 0, data: Uint8Array.from([0x86, 0x49, 0x83, 0x42]) }]);
		await expect(getVideoDecoderConfig(demuxer)).rejects.toMatchObject({
			name: "NotSupportedError",
		});
	});

	it.each([
		[[]],
		[[0x82, 0x49, 0x83]], // truncated
		[[0x02, 0x49, 0x83, 0x42]], // invalid marker
		[[0x82, 0, 0, 0]], // invalid sync code
		[[0x8a, 0x49, 0x83, 0x42]], // show-existing frame
		[[0xb9, 0x24, 0xc1, 0xa1, 0]], // profile 3 reserved bit
		[[0x92, 0x49, 0x83, 0x42]], // missing high-bit-depth selector
	])("rejects invalid VP9 keyframe bytes %j", async (bytes) => {
		const { demuxer, setPackets } = source("vp09", { pix_fmt: "unknown" });
		setPackets([{ keyframe: 1, data: Uint8Array.from(bytes) }]);
		await expect(getVideoDecoderConfig(demuxer)).rejects.toMatchObject({
			name: "NotSupportedError",
		});
	});

	it("rejects inconsistent profile and pixel format", async () => {
		const { demuxer } = source("vp09", { pix_fmt: "yuv420p10le", profile: "Profile 0" });
		await expect(getVideoDecoderConfig(demuxer)).rejects.toMatchObject({
			name: "NotSupportedError",
		});
	});
});
