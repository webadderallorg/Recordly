import { describe, it, expect } from 'vitest';
import {
  generateShareCode,
  escapeHTML,
  parseCookies,
  timingSafeEqual,
  sha256Hex,
  generateSalt,
  formatVTTTime,
} from '../src/index.js';

const SHARE_CODE_CHARS = '0123456789abcdef';
const SHARE_CODE_LENGTH = 64;

describe('generateShareCode', () => {
  it('produces codes of the documented length and charset', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateShareCode();
      expect(code).toHaveLength(SHARE_CODE_LENGTH);
      expect(code).toMatch(/^[a-z0-9]+$/); // must satisfy every route regex
      for (const ch of code) expect(SHARE_CODE_CHARS).toContain(ch);
    }
  });

  it('generates distinct random codes', () => {
    expect(new Set(Array.from({ length: 100 }, generateShareCode)).size).toBe(100);
  });
});

describe('escapeHTML', () => {
  it('escapes the four double-quote-context metacharacters', () => {
    expect(escapeHTML(`<img src=x onerror="alert(1)">&`)).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;'
    );
  });

  it('leaves plain text untouched', () => {
    expect(escapeHTML('My recording 2024')).toBe('My recording 2024');
  });

  // Documented limitation: single quotes pass through, so escaped values are
  // only safe in double-quoted attributes and element content.
  it("does not escape single quotes — keep attributes double-quoted", () => {
    expect(escapeHTML("it's")).toBe("it's");
  });
});

describe('parseCookies', () => {
  it('parses multiple cookies and preserves = inside values', () => {
    const cookies = parseCookies('a=1; voom_auth_abc=dGVzdA==; b=x=y');
    expect(cookies.a).toBe('1');
    expect(cookies.voom_auth_abc).toBe('dGVzdA==');
    expect(cookies.b).toBe('x=y');
  });

  it('returns empty object for empty string', () => {
    expect(parseCookies('')).toEqual({});
  });
});

describe('timingSafeEqual', () => {
  it('matches equal strings', () => {
    expect(timingSafeEqual('secret-token', 'secret-token')).toBe(true);
  });
  it('rejects unequal strings of same and different length', () => {
    expect(timingSafeEqual('secret-token', 'secret-tokeX')).toBe(false);
    expect(timingSafeEqual('secret', 'secret-token')).toBe(false);
    expect(timingSafeEqual('', 'x')).toBe(false);
  });
  it('rejects non-strings', () => {
    expect(timingSafeEqual(undefined, 'x')).toBe(false);
    expect(timingSafeEqual('x', null)).toBe(false);
  });
});

describe('sha256Hex / generateSalt', () => {
  it('produces the known SHA-256 of "hunter2"', async () => {
    expect(await sha256Hex('hunter2')).toBe(
      'f52fbd32b2b3b86ff88ef6c490628285f482af15ddcb29541f94bcf526a3f6c7'
    );
  });
  it('salt is 32 hex chars and unique', () => {
    const a = generateSalt();
    const b = generateSalt();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe('formatVTTTime', () => {
  it('formats with millisecond precision', () => {
    expect(formatVTTTime(0)).toBe('00:00:00.000');
    expect(formatVTTTime(61.5)).toBe('00:01:01.500');
    expect(formatVTTTime(3661.25)).toBe('01:01:01.250');
  });
});
