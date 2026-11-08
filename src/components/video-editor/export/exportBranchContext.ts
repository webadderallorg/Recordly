import type { RefObject } from "react";
import type { useOptionalBilling } from "@/components/billing/BillingProvider";
import type { ExportSettings } from "@/lib/exporter/types";
import type { createExportDiagnostics } from "@/lib/feedback/exportDiagnostics";
import type { createSmokeExportProgressSampler } from "../smokeExportProgress";
import type { PendingExportSave } from "./exportPersistence";
import type { ExportRunnerInput } from "./exportRunnerSupport";
export interface ExportBranchContext {
	input: ExportRunnerInput & { videoPath: string };
	settings: ExportSettings;
	options?: { destination?: "download" | "share" };
	billingRef: RefObject<ReturnType<typeof useOptionalBilling>>;
	previewWidth: number;
	previewHeight: number;
	effectiveShadowIntensity: number;
	diagnostics: ReturnType<typeof createExportDiagnostics>;
	smokeExportStartedAt: number | null;
	recordSmokeProgress: ReturnType<typeof createSmokeExportProgressSampler>["record"];
	smokeProgressSamples: ReturnType<typeof createSmokeExportProgressSampler>["samples"];
	exportWasCancelled: () => boolean;
	discardCancelledTemp: (pending: PendingExportSave) => Promise<void>;
	showExportSuccessToast: (path: string) => void;
	setKeepExportDialogOpen: (open: boolean) => void;
}
export type ExportBranchOutcome = { exit: false } | { exit: true; path?: string };
