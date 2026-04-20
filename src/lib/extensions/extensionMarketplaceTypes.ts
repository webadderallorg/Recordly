import type { ExtensionManifest } from "./extensionManifestTypes";

export type ExtensionStatus = "installed" | "active" | "disabled" | "error";

export interface ExtensionInfo {
	manifest: ExtensionManifest;
	status: ExtensionStatus;
	path: string;
	error?: string;
	builtin?: boolean;
}

export type MarketplaceReviewStatus = "pending" | "approved" | "rejected" | "flagged";

export interface MarketplaceExtension {
	id: string;
	name: string;
	version: string;
	description: string;
	author: string;
	downloadUrl: string;
	iconUrl?: string;
	screenshots?: string[];
	downloads: number;
	rating: number;
	ratingCount: number;
	tags: string[];
	permissions: import("./extensionManifestTypes").ExtensionPermission[];
	reviewStatus: MarketplaceReviewStatus;
	publishedAt: string;
	updatedAt: string;
	homepage?: string;
	installed?: boolean;
}

export interface MarketplaceSearchResult {
	extensions: MarketplaceExtension[];
	total: number;
	page: number;
	pageSize: number;
}

export interface ExtensionReview {
	id: string;
	extensionId: string;
	extensionName: string;
	version: string;
	author: string;
	submittedAt: string;
	status: MarketplaceReviewStatus;
	reviewNotes?: string;
	manifest: ExtensionManifest;
	downloadUrl: string;
}