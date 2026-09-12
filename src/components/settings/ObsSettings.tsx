import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useEffect } from "react";

export function ObsSettingsDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
	const [password, setPassword] = useState("");
	const [connecting, setConnecting] = useState(false);
	const [connected, setConnected] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		if (open) {
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
			// Check current mode to see if we're connected
			window.electronAPI.obsGetMode().then(mode => {
				setConnected(mode);
			}).catch(() => setConnected(false));
		} else {
			setTimeout(() => {
				window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
			}, 100);
		}
	}, [open]);

	const handleConnect = async () => {
		setConnecting(true);
		setError("");
		try {
			const success = await window.electronAPI.obsConnect(password);
			if (success) {
				setConnected(true);
				await window.electronAPI.obsSetMode(true);
			} else {
				setError("Failed to connect to OBS. Check password and ensure OBS WebSocket is enabled on port 4455.");
			}
		} catch (e: any) {
			setError(e.message || "Connection error");
		} finally {
			setConnecting(false);
		}
	};

	const handleDisconnect = async () => {
		await window.electronAPI.obsDisconnect();
		await window.electronAPI.obsSetMode(false);
		setConnected(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[425px] pointer-events-auto" data-hud-interactive>
				<DialogHeader>
					<DialogTitle>OBS Studio Integration</DialogTitle>
				</DialogHeader>
				<div className="grid gap-4 py-4">
					<div className="grid grid-cols-4 items-center gap-4">
						<Label htmlFor="obs-password" className="text-right">
							Password
						</Label>
						<Input
							id="obs-password"
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							className="col-span-3"
							placeholder="Leave empty if no password"
						/>
					</div>
					{error && <p className="text-red-500 text-sm">{error}</p>}
					{connected && <p className="text-green-500 text-sm font-semibold">Connected to OBS Studio!</p>}
					<p className="text-xs text-muted-foreground">
						Make sure OBS Studio is running and the WebSocket server is enabled (Tools -&gt; WebSocket Server Settings). Default port is 4455.
					</p>
				</div>
				<DialogFooter>
					{connected ? (
						<Button variant="destructive" onClick={handleDisconnect}>Disconnect</Button>
					) : (
						<Button onClick={handleConnect} disabled={connecting}>
							{connecting ? "Connecting..." : "Connect"}
						</Button>
					)}
					<Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
