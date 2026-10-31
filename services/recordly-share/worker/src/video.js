// Adapted from Voom (MIT), Copyright (c) 2026 Aritro Paul.
// See ../../LICENSE and ../../../../THIRD_PARTY_NOTICES.md for attribution.

export const EXPIRY_DAYS = 30;
// Hosted accounts use the free policy until server-verified paid entitlements exist.
export const FREE_EXPIRY_DAYS = 14;

export function finiteNonnegative(value) {
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? number : 0;
}
