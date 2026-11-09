import { translate } from "@/i18n/runtime";
import { CLOUD_SHARE_ENDPOINT } from "../cloud/endpoint";
import {
	getProjectShare,
	getProjectShareLink,
	removeProjectShareLinksByUrl,
} from "../cloud/projectShareLinks";

/** Remove remote copies first: a failed cloud request must preserve local projects/media for retry. */
export async function deleteLibraryProjectsWithMedia({
	paths,
	allProjectPaths,
	accountId,
	token,
	removeLocal,
}: {
	paths: string[];
	allProjectPaths: string[];
	accountId?: string;
	token?: string;
	removeLocal: (paths: string[], options: { includeSources: boolean }) => Promise<string[]>;
}) {
	const eligible: string[] = [];
	const errors: string[] = [];
	const selection = new Set(paths);
	// Snapshot known aliases before successful remote deletion removes their metadata.
	const otherLinks = new Set(
		allProjectPaths
			.filter((path) => !selection.has(path))
			.map(getProjectShareLink)
			.filter(Boolean),
	);
	for (const projectPath of paths) {
		const name = projectPath.split(/[\\/]/).pop() || projectPath;
		try {
			const url = getProjectShareLink(projectPath);
			if (url && !otherLinks.has(url)) {
				const savedShare = getProjectShare(projectPath, accountId);
				if (!token || !accountId || !savedShare)
					throw new Error(
						translate(
							"ui.cleanup.signInToDeleteCloud",
							"Sign in to the account that owns the shared video before deleting {{name}}.",
							{ name },
						),
					);
				const parsed = new URL(url);
				const code = /^\/s\/([a-z0-9]{1,128})\/?$/.exec(parsed.pathname)?.[1];
				if (
					!code ||
					parsed.origin !== new URL(CLOUD_SHARE_ENDPOINT).origin ||
					parsed.username ||
					parsed.password
				)
					throw new Error(
						translate(
							"ui.cleanup.cloudOriginMismatch",
							"The saved cloud link for {{name}} belongs to a different server. Its project and sources were kept.",
							{ name },
						),
					);
				const response = await window.electronAPI.cloudShareManage({
					endpoint: CLOUD_SHARE_ENDPOINT,
					token,
					action: "delete",
					shareCode: code,
				});
				if (
					!response.success &&
					!(
						response.httpStatus === 404 &&
						response.resourceMissing === true &&
						savedShare.accountId === accountId
					)
				)
					throw new Error(
						translate(
							"ui.cleanup.cloudDeleteFailed",
							"Could not delete the cloud video for {{name}}. Its project and source recordings were kept.",
							{ name },
						),
					);
				removeProjectShareLinksByUrl(url);
			}
			eligible.push(projectPath);
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
		}
	}
	const deleted = eligible.length ? await removeLocal(eligible, { includeSources: true }) : [];
	return { deleted, errors };
}
