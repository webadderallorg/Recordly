import { useEffect, useRef } from "react";
import { toast } from "@/components/ui/toast";

export function SourceSelector() {
	const started = useRef(false);
	useEffect(() => {
		if (started.current) return;
		started.current = true;
		void window.electronAPI
			.pickCaptureTarget()
			.then((result) => {
				if (result.message && !result.canceled) toast.info(result.message);
				window.close();
			})
			.catch(() => {
				toast.error("Unable to open the source picker.");
				window.close();
			});
	}, []);
	return null;
}
