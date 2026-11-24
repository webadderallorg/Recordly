import { Component, type ErrorInfo, type ReactNode, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { translate } from "@/i18n/runtime";
import { recordReactCrash, redactDiagnostic } from "@/lib/feedback/diagnostics";
import { buildErrorReport } from "@/lib/feedback/errorReporting";
import { ErrorReportButton } from "./ErrorReportButton";

/** Keep reporting available even when a React view fails to render. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
	state: { error: Error | null } = { error: null };
	static getDerivedStateFromError(error: Error) {
		return { error };
	}
	componentDidCatch(error: Error, info: ErrorInfo) {
		recordReactCrash(error, info.componentStack);
		console.error("[Recordly] View failed:", error, info.componentStack ?? "");
	}
	render() {
		if (!this.state.error) return this.props.children;
		const details = this.state.error.message || "Unexpected application error";
		return <CrashFallback key={details} error={details} />;
	}
}

function CrashFallback({ error }: { error: string }) {
	const snapshot = useRef<ReturnType<typeof buildErrorReport> | null>(null);
	const [preview, setPreview] = useState<
		{ status: "loading" | "failed" } | { status: "ready"; text: string } | null
	>(null);
	const detailsLabel = translate("support.diagnostics", "Technical details");
	const prepareReport = () => {
		snapshot.current ??= buildErrorReport(error, "application-crash").catch((cause) => {
			snapshot.current = null;
			throw cause;
		});
		return snapshot.current;
	};
	const showDetails = async () => {
		if (preview?.status === "loading" || preview?.status === "ready") return;
		setPreview({ status: "loading" });
		try {
			const { logs, ...report } = await prepareReport();
			const { view, device, runtime, viewport, crash, operationHistory, ...otherLogs } =
				JSON.parse(logs);
			setPreview({
				status: "ready",
				text: JSON.stringify(
					{
						...report,
						logs: {
							view,
							device,
							runtime,
							viewport,
							crash,
							operationHistory,
							...otherLogs,
						},
					},
					null,
					2,
				),
			});
		} catch {
			setPreview({ status: "failed" });
		}
	};

	return (
		<main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
			<div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-8">
				<h1 className="text-xl font-semibold">Recordly ran into a problem</h1>
				<p className="my-4 text-sm text-muted-foreground">
					Send the error logs to support, then reopen Recordly to try again.
				</p>
				<div className="flex flex-wrap gap-2">
					<ErrorReportButton
						error={error}
						context="application-crash"
						prepareReport={prepareReport}
					/>
					<Button variant="secondary" onClick={() => window.location.reload()}>
						Reopen Recordly
					</Button>
				</div>
				<details
					className="mt-4 text-xs text-muted-foreground"
					onToggle={(event) => {
						if (event.currentTarget.open) void showDetails();
					}}
				>
					<summary className="cursor-pointer">{detailsLabel}</summary>
					{preview?.status === "ready" ? (
						<div
							role="region"
							aria-label={detailsLabel}
							tabIndex={0}
							className="mt-2 max-h-[40vh] overflow-auto rounded-lg border border-border bg-background p-3"
						>
							<pre className="select-text whitespace-pre-wrap break-words">
								{preview.text}
							</pre>
						</div>
					) : (
						<p className="mt-2 select-text break-words whitespace-pre-wrap">
							{redactDiagnostic(error)}
						</p>
					)}
					{preview?.status === "loading" && (
						<p role="status" className="mt-2">
							{translate("support.diagnosticsLoading", "Collecting diagnostics…")}
						</p>
					)}
					{preview?.status === "failed" && (
						<p role="status" className="mt-2">
							{translate(
								"support.diagnosticsUnavailable",
								"Could not load diagnostic details.",
							)}
						</p>
					)}
				</details>
			</div>
		</main>
	);
}
