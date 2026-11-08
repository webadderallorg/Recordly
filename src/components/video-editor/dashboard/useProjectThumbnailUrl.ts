import { useEffect, useState } from "react";
import { resolveProjectThumbnailUrl } from "./projectThumbnailUrl";

export function useProjectThumbnailUrl(path: string | null, revision: number, enabled = true) {
	const key = `${path}:${revision}`;
	const [resolved, setResolved] = useState<{
		key: string;
		url: string | null;
		failed: boolean;
	} | null>(null);
	useEffect(() => {
		if (!enabled || !path) return;
		let active = true;
		void resolveProjectThumbnailUrl(path, revision).then(
			(url) => {
				if (active) setResolved({ key, url, failed: false });
			},
			() => {
				if (active) setResolved({ key, url: null, failed: true });
			},
		);
		return () => {
			active = false;
		};
	}, [path, revision, key, enabled]);
	return {
		url: resolved?.key === key ? resolved.url : null,
		failed: resolved?.key === key && resolved.failed,
	};
}
