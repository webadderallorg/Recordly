import { useScopedT } from "@/contexts/I18nContext";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { reportError } from "@/lib/feedback/errorReporting";

export function ErrorReportButton({
	error,
	context = "application",
	format = "unknown",
	compact = false,
}: {
	error: string;
	context?: string;
	format?: "mp4" | "gif" | "unknown";
	compact?: boolean;
}) {
	// Remount state for a different failure, including while a previous send is pending.
	return (
		<ReportAction
			key={`${context}:${format}:${error}`}
			error={error}
			context={context}
			format={format}
			compact={compact}
		/>
	);
}
function ReportAction({
	error,
	context,
	format,
	compact,
}: Required<Parameters<typeof ErrorReportButton>[0]>) {
	const t = useScopedT("support");
	const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
	const [failure, setFailure] = useState("");
	const sending = useRef(false);
	return (
		<span className="inline-flex flex-wrap items-center gap-2" data-error-report>
			<Button
				type="button"
				variant="outline"
				className="h-8 text-xs aria-disabled:opacity-50"
				// Keep focus inside the containing dialog while preventing duplicate sends.
				aria-disabled={state === "sending" || state === "sent"}
				title={failure || t("reportTitle")}
				aria-label={
					state === "sending"
						? t("reportSending")
						: state === "sent"
							? t("reportSent")
							: state === "failed"
								? t("reportRetry")
								: t("reportError")
				}
				onClick={async () => {
					if (sending.current || state === "sent") return;
					sending.current = true;
					setState("sending");
					setFailure("");
					try {
						await reportError(error, context, format);
						setState("sent");
					} catch {
						setFailure(t("reportFailed"));
						setState("failed");
					} finally {
						sending.current = false;
					}
				}}
			>
				{state === "sending"
					? t("reportSending")
					: state === "sent"
						? t("reportSent")
						: state === "failed"
							? t("reportRetry")
							: t("reportError")}
			</Button>
			<span role="status" className={compact ? "sr-only" : "text-xs text-muted-foreground"}>
				{failure || (state === "sent" ? t("reportSuccess") : "")}
			</span>
		</span>
	);
}
