import { describe, it, expect } from 'vitest';
import { semanticKv3Compare, expectSemanticKv3RoundTrip } from './kv3-semantic-equal.js';

describe('KV3 semantic round-trip equality', () => {
  it('treats -0 and 0 as equal', () => {
    expect(semanticKv3Compare(-0, 0).ok).toBe(true);
    expect(semanticKv3Compare({ a: -0 }, { a: 0 }).ok).toBe(true);
  });

  it('equates plain resource path strings with resource_name nodes', () => {
    expect(
      semanticKv3Compare(
        { m: 'models/x.vmdl' },
        { m: { type: 'resource_name', value: 'models/x.vmdl' } }
      ).ok
    ).toBe(true);
  });

  it('rejects truncated panorama / path values', () => {
    expect(
      semanticKv3Compare(
        { m: { type: 'panorama', value: 'file://{images}' } },
        { m: { type: 'panorama', value: 'file://{images}/hud/x.psd' } }
      ).ok
    ).toBe(false);
  });

  it('expectSemanticKv3RoundTrip throws with a path on mismatch', () => {
    expect(() =>
      expectSemanticKv3RoundTrip({ k: 'a' }, { k: 'b' })
    ).toThrow(/k/);
  });
});
