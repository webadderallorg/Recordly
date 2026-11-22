import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ErrorReportButton } from "./ErrorReportButton";

/** Keep reporting available even when a React view fails to render. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
	state: { error: Error | null } = { error: null };
	static getDerivedStateFromError(error: Error) {
		return { error };
	}
	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error("[Recordly] View failed:", error, info.componentStack ?? "");
	}
	render() {
		if (!this.state.error) return this.props.children;
		const details = this.state.error.message || "Unexpected application error";
		return (
			<main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
				<div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-8">
					<h1 className="text-xl font-semibold">Recordly ran into a problem</h1>
					<p className="my-4 text-sm text-muted-foreground">
						Send the error logs to support, then reopen Recordly to try again.
					</p>
					<div className="flex flex-wrap gap-2">
						<ErrorReportButton error={details} context="application-crash" />
						<Button variant="secondary" onClick={() => window.location.reload()}>
							Reopen Recordly
						</Button>
					</div>
					<details className="mt-4 text-xs text-muted-foreground">
						<summary>Technical details</summary>
						<p className="mt-2 select-text break-words whitespace-pre-wrap">
							{details}
						</p>
					</details>
				</div>
			</main>
		);
	}
}
