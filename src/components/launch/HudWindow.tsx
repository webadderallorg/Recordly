import { Toaster } from "../ui/toast";
import { LaunchWindow } from "./LaunchWindow";

export default function HudWindow() {
	return (
		<>
			<LaunchWindow />
			<Toaster className="pointer-events-auto" />
		</>
	);
}
