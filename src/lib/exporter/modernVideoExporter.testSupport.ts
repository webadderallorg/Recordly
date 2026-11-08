import type { ModernExportHooks } from "./modernExportHooks";
import type { ModernExportSession } from "./modernExportSession";

/** Explicit access to owned collaborators for focused exporter regression tests. */
export function exporterInternals(instance: unknown): {
	session: ModernExportSession;
	operations: ModernExportHooks;
} {
	return instance as { session: ModernExportSession; operations: ModernExportHooks };
}
