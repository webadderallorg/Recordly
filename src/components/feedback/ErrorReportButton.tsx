import { useRef, useState } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { reportError } from "@/lib/feedback/errorReporting";

type ErrorReportButtonProps = {
	error: string;
	context?: string;
	format?: "mp4" | "gif" | "unknown";
	compact?: boolean;
	prepareReport?: Parameters<typeof reportError>[3];
};

export function ErrorReportButton({
	error,
	context = "application",
	format = "unknown",
	compact = false,
	prepareReport,
}: ErrorReportButtonProps) {
	// Remount state for a different failure, including while a previous send is pending.
	return (
		<ReportAction
			key={`${context}:${format}:${error}`}
			error={error}
			context={context}
			format={format}
			compact={compact}
			prepareReport={prepareReport}
		/>
	);
}
function ReportAction({
	error,
	context,
	format,
	compact,
	prepareReport,
}: Required<Omit<ErrorReportButtonProps, "prepareReport">> &
	Pick<ErrorReportButtonProps, "prepareReport">) {
	const t = useScopedT("support");
	const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
	const [failure, setFailure] = useState("");
	const sending = useRef(false);
	return (
		<span data-error-report className={compact ? "flex shrink-0" : undefined}>
			{!compact && " "}
			<button
				type="button"
				className={`${compact ? "inline-flex h-8 items-center whitespace-nowrap" : "inline align-baseline"} cursor-pointer rounded-sm border-0 bg-transparent p-0 text-inherit underline underline-offset-2 hover:opacity-80 focus-visible:ring-2 focus-visible:ring-current aria-disabled:cursor-default aria-disabled:opacity-50`}
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
						await reportError(error, context, format, prepareReport);
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
			</button>
			<span role="status" className={compact || state !== "failed" ? "sr-only" : undefined}>
				{failure ? ` ${failure}` : state === "sent" ? t("reportSuccess") : ""}
			</span>
		</span>
	);
}
