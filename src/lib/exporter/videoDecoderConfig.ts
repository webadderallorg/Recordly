import type { WebDemuxer } from "web-demuxer";

// Level, maximum picture size, sample rate, bitrate (kbps), and dimension.
// https://www.webmproject.org/vp9/levels/
const VP9_LEVELS = [
	[10, 36864, 829440, 200, 512],
	[11, 73728, 2764800, 800, 768],
	[20, 122880, 4608000, 1800, 960],
	[21, 245760, 9216000, 3600, 1344],
	[30, 552960, 20736000, 7200, 2048],
	[31, 983040, 36864000, 12000, 2752],
	[40, 2228224, 83558400, 18000, 4160],
	[41, 2228224, 160432128, 30000, 4160],
	[50, 8912896, 311951360, 60000, 8384],
	[51, 8912896, 588251136, 120000, 8384],
	[52, 8912896, 1176502272, 180000, 8384],
	[60, 35651584, 1176502272, 180000, 16832],
	[61, 35651584, 2353004544, 240000, 16832],
	[62, 35651584, 4706009088, 480000, 16832],
] as const;

function parseFrameRate(value: string | undefined): number {
	const [numerator, denominator = "1"] = (value ?? "").split("/");
	const rate = Number(numerator) / Number(denominator);
	return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

// VP9 uncompressed keyframe header, read most-significant bit first.
// Profile and bit depth are carried in the bitstream even when WebM probing
// leaves both profile and pix_fmt unknown. Never guess 8-bit from missing metadata.
function readVp9KeyframeFormat(data: Uint8Array): { profile: number; bitDepth: number } {
	let offset = 0;
	const invalidHeader = () =>
		new DOMException(
			"Cannot determine VP9 format: missing or invalid keyframe header.",
			"NotSupportedError",
		);
	const read = (count: number): number => {
		if (offset + count > data.length * 8) throw invalidHeader();
		let value = 0;
		for (let i = 0; i < count; i++, offset++) {
			value = (value << 1) | ((data[offset >> 3] >> (7 - (offset & 7))) & 1);
		}
		return value;
	};
	if (read(2) !== 2) throw invalidHeader();
	const profile = read(1) + (read(1) << 1);
	if (profile === 3 && read(1) !== 0) throw invalidHeader();
	if (read(1) !== 0 || read(1) !== 0) throw invalidHeader(); // show_existing_frame, frame_type
	read(2); // show_frame, error_resilient_mode
	if (read(24) !== 0x498342) throw invalidHeader();
	const bitDepth = profile >= 2 ? (read(1) ? 12 : 10) : 8;
	return { profile, bitDepth };
}

/** Repair ambiguous VP9 identifiers emitted by web-demuxer for some WebM files. */
export async function getVideoDecoderConfig(demuxer: WebDemuxer): Promise<VideoDecoderConfig> {
	const config = await demuxer.getDecoderConfig("video");
	if (config.codec !== "vp09" && config.codec !== "vp9") return config;

	const { streams } = await demuxer.getMediaInfo();
	const stream = streams.find((candidate) => candidate.codec_type_string === "video");
	// Do not assume profile 0 / 8-bit: imported VP9 can also be 10/12-bit or 4:4:4.
	const pixelFormat = /^(yuvj?(420|422|444)p|gbrp)(?:(10|12)(?:le|be))?$/.exec(
		stream?.pix_fmt ?? "",
	);
	if (!stream) {
		throw new DOMException("Missing VP9 video stream.", "NotSupportedError");
	}
	let profile: number;
	let bitDepth: number;
	if (pixelFormat) {
		bitDepth = Number(pixelFormat[3] ?? 8);
		const inferredProfile = (bitDepth === 8 ? 0 : 2) + (pixelFormat[2] === "420" ? 0 : 1);
		const profileMatch = /^(?:Profile\s+)?([0-3])$/i.exec(stream.profile ?? "");
		profile = profileMatch ? Number(profileMatch[1]) : inferredProfile;
		if (profile !== inferredProfile) {
			throw new DOMException(
				"Inconsistent VP9 profile and pixel format.",
				"NotSupportedError",
			);
		}
	} else {
		// A one-packet seek does not consume the export stream: both callers start
		// a fresh, explicitly positioned read after configuring their decoder.
		const packet = await demuxer.seekMediaPacket("video", 0);
		({ profile, bitDepth } = readVp9KeyframeFormat(packet.data));
	}

	// WebM commonly has no declared level (FFmpeg reports -99). Estimate the
	// minimum level from available stream metadata rather than hardcoding 1.0
	// for every resolution. This is a decoder hint, not bitstream conformance validation.
	const width = config.codedWidth ?? stream.width;
	const height = config.codedHeight ?? stream.height;
	const pictureSize = width * height;
	const frameRate = parseFrameRate(stream.avg_frame_rate) || parseFrameRate(stream.r_frame_rate);
	const bitrate = Number(stream.bit_rate) || 0;
	const level = VP9_LEVELS.some(([value]) => value === stream.level)
		? stream.level
		: (VP9_LEVELS.find(
				([, maxSize, maxRate, maxBitrate, maxDimension]) =>
					pictureSize <= maxSize &&
					pictureSize * frameRate <= maxRate &&
					bitrate <= maxBitrate * 1000 &&
					Math.max(width, height) <= maxDimension,
			)?.[0] ?? 62);
	const pad = (value: number) => String(value).padStart(2, "0");
	return { ...config, codec: `vp09.${pad(profile)}.${pad(level)}.${pad(bitDepth)}` };
}
