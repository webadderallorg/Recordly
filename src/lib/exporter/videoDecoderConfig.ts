export const FALLBACK_H264_CODEC = "avc1.640033";

export function normalizeVideoDecoderConfig(config: VideoDecoderConfig): VideoDecoderConfig {
	let codec = config.codec;

	if (/^av01$/i.test(codec)) codec = "av01.0.01M.08";
	if (/^vp08$/i.test(codec)) codec = "vp8";
	if (/^vp09$/i.test(codec)) codec = "vp9";
	if (/^(avc1|h264)$/i.test(codec)) codec = FALLBACK_H264_CODEC;

	return codec === config.codec ? config : { ...config, codec };
}

function prefersSoftwareDecode(codec: string): boolean {
	const normalizedCodec = codec.toLowerCase();
	return (
		normalizedCodec.includes("av01") ||
		normalizedCodec.includes("av1") ||
		normalizedCodec === "vp9"
	);
}

function decoderConfigCandidates(config: VideoDecoderConfig): VideoDecoderConfig[] {
	const normalizedConfig = normalizeVideoDecoderConfig(config);
	const candidates: VideoDecoderConfig[] = [];

	if (prefersSoftwareDecode(normalizedConfig.codec)) {
		candidates.push({ ...normalizedConfig, hardwareAcceleration: "prefer-software" });
	}

	candidates.push(normalizedConfig);

	if (
		/^avc1/i.test(normalizedConfig.codec) &&
		normalizedConfig.codec.toLowerCase() !== FALLBACK_H264_CODEC
	) {
		candidates.push({ ...normalizedConfig, codec: FALLBACK_H264_CODEC });
	}

	return candidates;
}

export async function configureVideoDecoder(
	decoder: VideoDecoder,
	config: VideoDecoderConfig,
): Promise<VideoDecoderConfig> {
	let lastError: unknown;

	for (const candidate of decoderConfigCandidates(config)) {
		try {
			const support = await VideoDecoder.isConfigSupported(candidate);
			if (!support.supported) continue;

			decoder.configure(candidate);
			return candidate;
		} catch (error) {
			lastError = error;
		}
	}

	if (lastError instanceof Error) throw lastError;
	throw new Error(`Unsupported video codec: ${config.codec}`);
}
