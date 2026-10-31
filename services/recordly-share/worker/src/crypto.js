// Adapted from Voom (MIT), Copyright (c) 2026 Aritro Paul.
// See ../../LICENSE and ../../../../THIRD_PARTY_NOTICES.md for attribution.



// Constant-time string comparison — avoids leaking match length via timing.
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i % ab.length] ?? 0) ^ (bb[i % bb.length] ?? 0);
  }
  return diff === 0;
}

export async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export function generateSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// The prefix versions the algorithm and work factor without changing legacy rows.
export async function hashRecordingPassword(clientHash, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(clientHash), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 210000 }, key, 256);
  return 'pbkdf2-sha256:210000:' + Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
}
