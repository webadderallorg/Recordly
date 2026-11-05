import type { ModernExportHooks } from "./modernExportHooks";
import { createModernExportOperations } from "./modernExportOperations";
import { runModernExport } from "./modernExportPipeline";
import { cancel } from "./modernExportResources";
import { ModernExportSession } from "./modernExportSession";
import type { VideoExporterConfig } from "./modernVideoExporterConfig";
import type { ExportResult } from "./types";

/** Public export API. Resource and retry lifetimes belong to the export session. */
export class ModernVideoExporter {
	private readonly session: ModernExportSession;
	private readonly operations: ModernExportHooks;
	constructor(config: VideoExporterConfig) {
		this.session = new ModernExportSession(config);
		this.operations = createModernExportOperations(this.session);
	}
	export(): Promise<ExportResult> {
		return runModernExport(this.session, this.operations);
	}
	cancel(): void {
		cancel(this.session);
	}
}
