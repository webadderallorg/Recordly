// Adapted from Voom (MIT), Copyright (c) 2026 Aritro Paul.
// See ../../LICENSE and ../../../../THIRD_PARTY_NOTICES.md for attribution.

export const EXPIRY_DAYS = 30;

export function finiteNonnegative(value) {
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? number : 0;
}

// Shared by every public recording endpoint. Keep access decisions in SQLite,
// whose datetime() accepts both legacy SQL timestamps and canonical ISO dates.
export const AVAILABLE_RECORDING_SQL = `(never_expires = 1 OR datetime(expires_at) > datetime('now'))
 AND NOT EXISTS (SELECT 1 FROM recording_controls rc WHERE rc.share_code = videos.share_code
 AND (rc.sharing_disabled = 1 OR rc.operator_blocked = 1))
 AND NOT EXISTS (SELECT 1 FROM account_restrictions ar WHERE ar.owner_id = videos.owner_id AND ar.suspended = 1)`;

export function parseDatabaseTimestamp(value) {
	if (typeof value !== "string") return NaN;
	return Date.parse(
		/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value,
	);
}
