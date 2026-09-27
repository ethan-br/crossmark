import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialState } from '../apps/extension/src/state';

const brands = (...names: string[]) => names.map((brand) => ({ brand, version: '130' }));

describe('default browser name', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([
    [
      {
        userAgent: 'Chrome',
        userAgentData: { brands: brands('Not)A;Brand', 'Chromium', 'Google Chrome') },
      },
      'Chrome',
    ],
    [
      {
        userAgent: 'Edg',
        userAgentData: { brands: brands('Microsoft Edge', 'Not?A_Brand', 'Chromium') },
      },
      'Edge',
    ],
    [
      { userAgent: 'Brave', userAgentData: { brands: brands('Chromium', 'Brave', 'Not.A/Brand') } },
      'Brave',
    ],
    [
      { userAgent: 'Helium', userAgentData: { brands: brands('Chromium', 'Not_A Brand') } },
      'Chromium',
    ],
    [{ userAgent: 'Mozilla/5.0 (Macintosh) Gecko/20100101 Firefox/156.0' }, 'Firefox'],
    [{ userAgent: 'Mozilla/5.0 AppleWebKit/537.36' }, 'Chromium'],
  ])('names %j as %s', (navigator, name) => {
    vi.stubGlobal('navigator', navigator);
    expect(initialState().name).toBe(name);
  });
});
