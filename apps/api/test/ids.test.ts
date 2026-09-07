import { describe, expect, it } from 'vitest';
import { newInviteCode, timingSafeEqual } from '../src/lib/ids';

const ALPHABET = '0123456789ABCDEFGHIJKMNPQRSTUVWXYZ';

describe('invite codes', () => {
  it('reads as four-and-four from an unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const code = newInviteCode();
      // Letters are A-K, M, N, P-Z: 'l' and 'o' are left out of the alphabet.
      expect(code).toMatch(/^[0-9A-KMNP-Z]{4}-[0-9A-KMNP-Z]{4}$/);
      // l and o are excluded so a code can be read aloud without ambiguity.
      expect(code).not.toMatch(/[LO]/);
    }
  });

  /**
   * `byte % 34` over 0-255 would make the first 18 symbols appear 8/256 of the
   * time and the rest 7/256 — about 14% likelier. Rejection sampling flattens
   * that. With 34,000 samples the two groups should be within a few percent;
   * the biased version separates them by roughly 14%.
   */
  it('draws symbols without modulo bias', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 5000; i++) {
      for (const ch of newInviteCode().replace('-', '')) {
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
      }
    }
    const early = [...ALPHABET.slice(0, 18)].reduce((n, c) => n + (counts.get(c) ?? 0), 0) / 18;
    const late = [...ALPHABET.slice(18)].reduce((n, c) => n + (counts.get(c) ?? 0), 0) / 16;
    const skew = Math.abs(early - late) / ((early + late) / 2);
    expect(skew).toBeLessThan(0.06);
  });

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 500 }, () => newInviteCode()));
    expect(seen.size).toBe(500);
  });
});

describe('timingSafeEqual', () => {
  it('matches identical digests and rejects everything else', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true);
    expect(timingSafeEqual('abc123', 'abc124')).toBe(false);
    expect(timingSafeEqual('abc', 'abcdef')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });
});
