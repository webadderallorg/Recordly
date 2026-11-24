import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/contexts/I18nContext";

export default function MicrophoneNameWindow() {
	const { t } = useI18n();
	const [label, setLabel] = useState("");
	const [name, setName] = useState("");
	const close = () => void window.electronAPI.windowControl("close");
	useEffect(() => {
		let mounted = true;
		void window.electronAPI.getMicrophoneNameDialog().then((initial) => {
			if (mounted && initial) {
				setLabel(initial.label);
				setName(initial.name);
			}
		});
		return () => {
			mounted = false;
		};
	}, []);
	if (!label) return null;
	return (
		<form
			className="flex h-screen flex-col justify-center gap-4 bg-background px-6 py-4 text-foreground"
			onSubmit={(event) => {
				event.preventDefault();
				window.electronAPI.submitMicrophoneName(name);
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape" && !event.nativeEvent.isComposing) close();
			}}
		>
			<label className="flex min-w-0 flex-col gap-1.5">
				<span className="truncate font-medium" title={label}>
					{t("launch.recording.renameMicrophone", "Rename {{name}}", { name: label })}
				</span>
				<Input
					autoFocus
					value={name}
					placeholder={label}
					maxLength={100}
					onChange={(event) => setName(event.target.value)}
				/>
			</label>
			<div className="flex items-center gap-2">
				<Button
					type="button"
					className="mr-auto"
					variant="ghost"
					disabled={!name}
					onClick={() => setName("")}
				>
					{t("common.actions.reset")}
				</Button>
				<Button type="button" variant="ghost" onClick={close}>
					{t("common.actions.cancel")}
				</Button>
				<Button type="submit">{t("common.actions.save")}</Button>
			</div>
		</form>
	);
}
