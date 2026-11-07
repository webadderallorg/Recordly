import { Button, Card } from "@heroui/react";
import { ArrowLeft, DotsSixVertical } from "@phosphor-icons/react";
import { useState } from "react";

/** The native helper only follows Settings; Recordly renders the actual UI. */
export default function PermissionAccessoryWindow() {
	const permission =
		new URLSearchParams(window.location.search).get("permission") === "screen"
			? "Screen Recording"
			: "Accessibility";
	const applicationLabel = `Recordly ${permission}`;
	const [error, setError] = useState(false);
	return (
		<div className="h-screen w-screen p-2">
			<Card className="flex h-full flex-col gap-3 rounded-3xl border border-foreground/10 bg-background p-5 shadow-lg">
				<div className="flex items-center justify-between">
					<Button
						variant="ghost"
						size="sm"
						className="-ml-2"
						onPress={() => {
							void window.electronAPI.closePermissionAccessory();
						}}
					>
						<ArrowLeft size={16} aria-hidden="true" /> Back
					</Button>
					<img
						src="/app-icons/recordly-solid-blue-32.png"
						alt="Recordly"
						className="size-6"
					/>
				</div>
				<h1 className="text-base font-semibold tracking-tight">Drag to System Settings</h1>
				<div
					data-permission-drag
					draggable
					onDragStart={(event) => {
						event.preventDefault();
						void window.electronAPI
							.startPermissionAccessoryDrag()
							.then((result) => {
								setError(!result.success);
							})
							.catch(() => setError(true));
					}}
				>
					<Button
						variant="secondary"
						aria-label={`Drag ${applicationLabel} to System Settings`}
						className="h-14 w-full cursor-grab justify-start gap-3 rounded-xl px-3 text-sm font-medium active:cursor-grabbing"
					>
						<img
							src="/app-icons/recordlymac-128.png"
							alt=""
							className="size-9 shrink-0"
						/>
						<span className="flex-1 text-left">{applicationLabel}</span>
						<DotsSixVertical
							size={18}
							aria-hidden="true"
							className="shrink-0 text-muted"
						/>
					</Button>
				</div>
				<p className="text-xs leading-relaxed text-muted">
					Drag the Recordly icon into the {permission} list above, then turn it on.
				</p>
				{error && (
					<p role="alert" className="text-xs text-danger">
						Couldn’t start the drag. Try dragging the icon again.
					</p>
				)}
			</Card>
		</div>
	);
}
