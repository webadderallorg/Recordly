import type { ExportEncoderPreference, ExportVideoCodec } from "@/lib/exporter";

/**
 * Re-entrancy guard for the export dispatch. Blocks a second export while one
 * is still preparing/running (a concurrent dispatch would otherwise overwrite
 * `exporterRef` and shadow the intended codec/encoder with a later one).
 * `release()` re-arms the guard so a legitimate post-failure retry or a fresh
 * export after the previous one settled is never blocked.
 */
export type ExportSlotGuard = {
	tryAcquire(): boolean;
	release(): void;
};

export function createExportSlotGuard(): ExportSlotGuard {
	let acquired = false;
	return {
		tryAcquire() {
			if (acquired) {
				return false;
			}
			acquired = true;
			return true;
		},
		release() {
			acquired = false;
		},
	};
}

/**
 * Resolve the export codec/encoder preference when restoring a project's editor
 * snapshot. If the persisted project explicitly carries the codec and/or encoder
 * preference, those intentional project-level settings win. If a field was not
 * persisted (older projects / new projects), the current editor selection is
 * preserved instead of silently resetting to the h264/auto default — which is
 * what caused an explicit HEVC Hardware selection to be downgraded at load time.
 */
export function resolveRestoredExportCodecEncoder(
	rawEditor: { exportVideoCodec?: unknown; exportEncoderPreference?: unknown } | null | undefined,
	currentCodec: ExportVideoCodec,
	currentEncoder: ExportEncoderPreference,
): { exportVideoCodec: ExportVideoCodec; exportEncoderPreference: ExportEncoderPreference } {
	const codec = rawEditor?.exportVideoCodec;
	const encoder = rawEditor?.exportEncoderPreference;
	return {
		exportVideoCodec: codec === "h264" || codec === "hevc" ? codec : currentCodec,
		exportEncoderPreference:
			encoder === "auto" || encoder === "hardware" || encoder === "cpu"
				? encoder
				: currentEncoder,
	};
}
