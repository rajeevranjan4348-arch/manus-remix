import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildGoogleMapsUrl,
  clearGeocodeCacheForTests,
  formatCoordinates,
  isValidCoordinatePair,
  parseLocationQuery,
  selectBestOpenMeteoCandidate,
  validateResolvedLocation,
  geocodeWithOpenMeteo,
  type OpenMeteoCandidate,
} from '../src/lib/locationGeocoding';
import { geocodeLocationServer } from '../server/geocodingService';
import { extractManusMapRequest } from '../src/components/agent/ChatView';

const ROOT = process.cwd();

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('Location Detection, Coordinate Validation & Disambiguation', () => {
  beforeEach(() => {
    clearGeocodeCacheForTests();
  });

  it('validates WGS84 coordinates and rejects NaN, out-of-range, and uninitialized (0,0)', () => {
    expect(isValidCoordinatePair(28.6139, 77.209)).toBe(true);
    expect(isValidCoordinatePair(40.7128, -74.006)).toBe(true);
    expect(isValidCoordinatePair(-33.8688, 151.2093)).toBe(true);

    expect(isValidCoordinatePair(0, 0)).toBe(false);
    expect(isValidCoordinatePair(95, 77.209)).toBe(false);
    expect(isValidCoordinatePair(28.6, 185)).toBe(false);
    expect(isValidCoordinatePair(Number.NaN, 77.209)).toBe(false);
    expect(isValidCoordinatePair(undefined, undefined)).toBe(false);
  });

  it('formats coordinates with accurate N/S and E/W hemispheres', () => {
    expect(formatCoordinates(28.6139, 77.209)).toBe('28.6139°N, 77.2090°E');
    expect(formatCoordinates(51.5074, -0.1278)).toBe('51.5074°N, 0.1278°W');
    expect(formatCoordinates(40.7128, -74.006)).toBe('40.7128°N, 74.0060°W');
    expect(formatCoordinates(-33.8688, 151.2093)).toBe('33.8688°S, 151.2093°E');
  });

  it('parses City, Country and space-separated location queries cleanly', () => {
    const delhiIndia = parseLocationQuery('Delhi, India');
    expect(delhiIndia.primaryName).toBe('Delhi');
    expect(delhiIndia.expectedCountryCode).toBe('IN');

    const londonUk = parseLocationQuery('London, UK');
    expect(londonUk.primaryName).toBe('London');
    expect(londonUk.expectedCountryCode).toBe('GB');

    const nyUsa = parseLocationQuery('New York, USA');
    expect(nyUsa.primaryName).toBe('New York');
    expect(nyUsa.expectedCountryCode).toBe('US');

    const tokyoJapan = parseLocationQuery('Tokyo Japan');
    expect(tokyoJapan.primaryName).toBe('Tokyo');
    expect(tokyoJapan.expectedCountryCode).toBe('JP');
  });

  it('disambiguates ambiguous city names (Delhi -> India, London -> UK) and rejects wrong-country matches', () => {
    const delhiCandidates: OpenMeteoCandidate[] = [
      {
        name: 'Delhi',
        latitude: 42.2781,
        longitude: -74.916,
        country: 'United States',
        country_code: 'US',
        admin1: 'New York',
        population: 2952,
        feature_code: 'PPL',
      },
      {
        name: 'Delhi',
        latitude: 28.65195,
        longitude: 77.23149,
        country: 'India',
        country_code: 'IN',
        admin1: 'Delhi',
        population: 10927986,
        feature_code: 'PPLA',
      },
    ];

    const plainDelhi = selectBestOpenMeteoCandidate(
      delhiCandidates,
      parseLocationQuery('Delhi')
    );
    expect(plainDelhi).not.toBeNull();
    expect(plainDelhi?.countryCode).toBe('IN');
    expect(plainDelhi?.latitude).toBeGreaterThan(28);
    expect(plainDelhi?.latitude).toBeLessThan(29.2);
    expect(plainDelhi?.longitude).toBeGreaterThan(76.5);
    expect(plainDelhi?.longitude).toBeLessThan(78);

    // Reject Singapore coordinates if somehow tagged with wrong country for Delhi, India
    const mismatch = validateResolvedLocation(
      {
        query: 'Delhi, India',
        name: 'Singapore',
        displayName: 'Singapore',
        country: 'Singapore',
        countryCode: 'SG',
        latitude: 1.3521,
        longitude: 103.8198,
        provider: 'open-meteo',
        validated: true,
      },
      parseLocationQuery('Delhi, India')
    );
    expect(mismatch).toBe(false);
  });

  it('preserves City, Country commas in extractManusMapRequest prompts', () => {
    expect(extractManusMapRequest('Show me the map of Delhi, India')).toEqual({
      kind: 'location',
      location: 'Delhi, India',
    });
    expect(extractManusMapRequest('Show Mumbai, India on the map')).toEqual({
      kind: 'location',
      location: 'Mumbai, India',
    });
    expect(extractManusMapRequest('Where is London, UK located?')).toEqual({
      kind: 'location',
      location: 'London, UK',
    });
    expect(extractManusMapRequest('Map of New York, USA')).toEqual({
      kind: 'location',
      location: 'New York, USA',
    });
    expect(extractManusMapRequest('Tokyo, Japan map')).toEqual({
      kind: 'location',
      location: 'Tokyo, Japan',
    });
  });

  it('builds safe https Google Maps destination URLs', () => {
    const url = buildGoogleMapsUrl({
      latitude: 28.6139,
      longitude: 77.209,
      displayName: 'Delhi, India',
    });
    expect(url).toBe('https://www.google.com/maps/search/?api=1&query=28.613900%2C77.209000');

    const withPlace = buildGoogleMapsUrl({
      latitude: 28.6139,
      longitude: 77.209,
      displayName: 'Delhi, India',
      placeId: 'ChIJLbZ-NFv9DDkRzk0gTkm3wlI',
    });
    expect(withPlace).toContain('https://www.google.com/maps/search/?api=1&query=Delhi%2C%20India&query_place_id=ChIJLbZ-NFv9DDkRzk0gTkm3wlI');
  });
});

describe('Live Geocoding Verification for Required Global Cities', () => {
  const TARGET_CITIES = [
    {
      query: 'Delhi',
      expectedCountryCode: 'IN',
      latRange: [28.2, 29.1] as const,
      lngRange: [76.7, 77.6] as const,
    },
    {
      query: 'Delhi, India',
      expectedCountryCode: 'IN',
      latRange: [28.2, 29.1] as const,
      lngRange: [76.7, 77.6] as const,
    },
    {
      query: 'Mumbai, India',
      expectedCountryCode: 'IN',
      latRange: [18.8, 19.4] as const,
      lngRange: [72.6, 73.2] as const,
    },
    {
      query: 'London, UK',
      expectedCountryCode: 'GB',
      latRange: [51.2, 51.8] as const,
      lngRange: [-0.6, 0.3] as const,
    },
    {
      query: 'New York, USA',
      expectedCountryCode: 'US',
      latRange: [40.4, 41.0] as const,
      lngRange: [-74.4, -73.6] as const,
    },
    {
      query: 'Tokyo, Japan',
      expectedCountryCode: 'JP',
      latRange: [35.4, 36.0] as const,
      lngRange: [139.3, 140.1] as const,
    },
  ];

  for (const target of TARGET_CITIES) {
    it(
      `resolves "${target.query}" to accurate verified coordinates (never Singapore)`,
      async () => {
        const serverRes = await geocodeLocationServer(target.query);
        expect(serverRes.ok).toBe(true);
        expect(serverRes.location).not.toBeNull();

        const loc = serverRes.location!;
        expect(loc.countryCode).toBe(target.expectedCountryCode);
        expect(loc.latitude).toBeGreaterThanOrEqual(target.latRange[0]);
        expect(loc.latitude).toBeLessThanOrEqual(target.latRange[1]);
        expect(loc.longitude).toBeGreaterThanOrEqual(target.lngRange[0]);
        expect(loc.longitude).toBeLessThanOrEqual(target.lngRange[1]);

        // Explicitly guarantee Singapore bug (1.3521, 103.8198) can never recur
        expect(Math.abs(loc.latitude - 1.3521) + Math.abs(loc.longitude - 103.8198)).toBeGreaterThan(5);

        // Also verify client-side Open-Meteo fallback matches the same geographic region
        const openMeteoLoc = await geocodeWithOpenMeteo(target.query);
        expect(openMeteoLoc).not.toBeNull();
        expect(openMeteoLoc!.countryCode).toBe(target.expectedCountryCode);
        expect(openMeteoLoc!.latitude).toBeGreaterThanOrEqual(target.latRange[0]);
        expect(openMeteoLoc!.latitude).toBeLessThanOrEqual(target.latRange[1]);
      },
      15000
    );
  }
});

describe('Google Maps Integration & Compliance Guardrails', () => {
  it('removes hardcoded Singapore coordinates and wires dynamic geocoding, re-centering, and attribution in GoogleMapWidgetCard', () => {
    const mapCard = readFile('src/components/maps/GoogleMapWidgetCard.tsx');

    // No hardcoded Singapore default
    expect(mapCard).not.toContain('1.3521');
    expect(mapCard).not.toContain('103.8198');
    expect(mapCard).not.toContain("locationName = 'Singapore'");

    // Uses modern @vis.gl/react-google-maps SDK, AdvancedMarker, DEMO_MAP_ID, and required attribution ID
    expect(mapCard).toContain("from '@vis.gl/react-google-maps'");
    expect(mapCard).toContain('AdvancedMarker');
    expect(mapCard).toContain('mapId="DEMO_MAP_ID"');
    expect(mapCard).toContain("internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}");
    expect(mapCard).toContain('useMap()');
    expect(mapCard).toContain('map.panTo(center)');
    expect(mapCard).toContain('formatCoordinates(center.lat, center.lng)');
    expect(mapCard).toContain('buildGoogleMapsUrl');

    // Does not shadow global Map constructor
    expect(mapCard).not.toContain('new Map(');

    // Clickable Google Maps Live link opens resolved destination
    expect(mapCard).toContain('href={googleMapsHref}');
    expect(mapCard).toContain('<span>Google Maps Live</span>');
  });

  it('registers Tier 1 Maps auth/quota listeners in main.tsx and top-level banner in App.tsx', () => {
    const mainTsx = readFile('src/main.tsx');
    const appTsx = readFile('src/App.tsx');

    expect(mainTsx).toContain('gm_authFailure');
    expect(mainTsx).toContain('OverQuotaMapError');
    expect(mainTsx).toContain("new CustomEvent('gmp-quota-exceeded')");

    expect(appTsx).toContain("window.addEventListener('gmp-quota-exceeded'");
    expect(appTsx).toContain('utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors');
  });

  it('routes /api/geocode server-side in both Vite middleware and Netlify functions', () => {
    const viteConfig = readFile('vite.config.ts');
    const netlifyToml = readFile('netlify.toml');
    const netlifyGeocode = readFile('netlify/functions/geocode.ts');

    expect(viteConfig).toContain("url === '/api/geocode'");
    expect(netlifyToml).toContain('from = "/api/geocode"');
    expect(netlifyToml).toContain('to = "/.netlify/functions/geocode"');
    expect(netlifyGeocode).toContain('geocodeLocationServer');
    expect(netlifyGeocode).toContain('verifyBearerToken');
  });
});
