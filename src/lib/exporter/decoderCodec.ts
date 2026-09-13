type DecoderConfigSupportCheck = (config: VideoDecoderConfig) => Promise<boolean>;

// Demuxers report bare codec names (e.g. "vp09" from MediaRecorder WebM files) that
// Chromium's WebCodecs rejects as ambiguous. These fully qualified strings are accepted.
const FULLY_QUALIFIED_CODEC_CANDIDATES: ReadonlyArray<{
	prefixes: readonly string[];
	candidates: readonly string[];
}> = [
	{ prefixes: ["vp09", "vp9"], candidates: ["vp09.00.10.08", "vp09.02.10.10"] },
	{ prefixes: ["vp08", "vp8"], candidates: ["vp8"] },
	{ prefixes: ["av01", "av1"], candidates: ["av01.0.08M.08", "av01.0.08M.10"] },
	{ prefixes: ["avc1", "avc3", "h264"], candidates: ["avc1.640033", "avc1.42E01E"] },
];

export function getFullyQualifiedCodecCandidates(codec: string): string[] {
	const normalizedCodec = codec.trim().toLowerCase();
	const family = FULLY_QUALIFIED_CODEC_CANDIDATES.find(({ prefixes }) =>
		prefixes.some((prefix) => normalizedCodec.startsWith(prefix)),
	);
	if (!family) {
		return [];
	}
	return family.candidates.filter((candidate) => candidate.toLowerCase() !== normalizedCodec);
}

async function isDecoderConfigSupported(config: VideoDecoderConfig): Promise<boolean> {
	try {
		const result = await VideoDecoder.isConfigSupported(config);
		return Boolean(result.supported);
	} catch (error) {
		console.warn(`[decoderCodec] isConfigSupported threw for codec=${config.codec}:`, error);
		return false;
	}
}

/**
 * Returns the demuxer config unchanged when WebCodecs supports it; otherwise swaps in
 * the first supported fully qualified codec string of the same family.
 */
export async function resolveSupportedVideoDecoderConfig(
	config: VideoDecoderConfig,
	isSupported: DecoderConfigSupportCheck = isDecoderConfigSupported,
): Promise<VideoDecoderConfig> {
	if (await isSupported(config)) {
		return config;
	}

	for (const candidate of getFullyQualifiedCodecCandidates(config.codec)) {
		const candidateConfig = { ...config, codec: candidate };
		if (await isSupported(candidateConfig)) {
			console.warn(
				`[decoderCodec] Codec "${config.codec}" unsupported by WebCodecs, using "${candidate}"`,
			);
			return candidateConfig;
		}
	}

	return config;
}
