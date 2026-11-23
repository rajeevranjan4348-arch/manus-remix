import {
  formatDisplayName,
  GeocodedLocation,
  isValidCoordinatePair,
  OpenMeteoCandidate,
  ParsedLocationQuery,
  parseLocationQuery,
  selectBestOpenMeteoCandidate,
  validateResolvedLocation,
} from '../src/lib/locationGeocoding';

export interface ServerGeocodeResponse {
  ok: boolean;
  location: GeocodedLocation | null;
  quotaExceeded?: boolean;
  error?: string;
}

const GMP_SOLUTION_ID = 'gmp_mcp_codeassist_v1_aistudio';

function extractGoogleV4Component(
  components: any[] | undefined,
  targetTypes: string[]
): { longText?: string; shortText?: string } | null {
  if (!Array.isArray(components)) return null;
  for (const comp of components) {
    const types: string[] = Array.isArray(comp?.types) ? comp.types : [];
    if (targetTypes.some((t) => types.includes(t))) {
      return {
        longText: typeof comp?.longText === 'string' ? comp.longText : undefined,
        shortText: typeof comp?.shortText === 'string' ? comp.shortText : undefined,
      };
    }
  }
  return null;
}

function extractGoogleClassicComponent(
  components: any[] | undefined,
  targetTypes: string[]
): { longName?: string; shortName?: string } | null {
  if (!Array.isArray(components)) return null;
  for (const comp of components) {
    const types: string[] = Array.isArray(comp?.types) ? comp.types : [];
    if (targetTypes.some((t) => types.includes(t))) {
      return {
        longName: typeof comp?.long_name === 'string' ? comp.long_name : undefined,
        shortName: typeof comp?.short_name === 'string' ? comp.short_name : undefined,
      };
    }
  }
  return null;
}

async function tryGoogleGeocodingV4(
  parsed: ParsedLocationQuery,
  apiKey: string
): Promise<{ location: GeocodedLocation | null; quotaExceeded: boolean }> {
  try {
    const regionParam = parsed.expectedCountryCode
      ? `&regionCode=${encodeURIComponent(parsed.expectedCountryCode.toLowerCase())}`
      : '';
    const url = `https://geocode.googleapis.com/v4/geocode/address/${encodeURIComponent(parsed.normalized)}?languageCode=en${regionParam}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'results.placeId,results.location,results.formattedAddress,results.addressComponents,results.postalAddress',
        'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
      },
      signal: AbortSignal.timeout(5000),
    });

    const data: any = await res.json().catch(() => null);
    if (res.status === 429 || data?.error?.status === 'RESOURCE_EXHAUSTED') {
      return { location: null, quotaExceeded: true };
    }
    if (!res.ok || !Array.isArray(data?.results) || data.results.length === 0) {
      return { location: null, quotaExceeded: false };
    }

    for (const item of data.results) {
      const lat = Number(item?.location?.latitude);
      const lng = Number(item?.location?.longitude);
      if (!isValidCoordinatePair(lat, lng)) continue;

      const locality = extractGoogleV4Component(item?.addressComponents, [
        'locality',
        'administrative_area_level_2',
        'administrative_area_level_1',
      ]);
      const stateComp = extractGoogleV4Component(item?.addressComponents, [
        'administrative_area_level_1',
      ]);
      const countryComp = extractGoogleV4Component(item?.addressComponents, ['country']);

      const city =
        locality?.longText ||
        item?.postalAddress?.locality ||
        parsed.primaryName;
      const state =
        stateComp?.longText ||
        item?.postalAddress?.administrativeArea ||
        undefined;
      const country = countryComp?.longText || undefined;
      const countryCode = (
        countryComp?.shortText ||
        item?.postalAddress?.regionCode ||
        ''
      ).toUpperCase() || undefined;

      const displayName =
        formatDisplayName({ name: city, state, country }) ||
        String(item?.formattedAddress || parsed.normalized);

      const candidate: GeocodedLocation = {
        query: parsed.original,
        name: city,
        displayName,
        city,
        state,
        country,
        countryCode,
        latitude: lat,
        longitude: lng,
        provider: 'google',
        placeId: typeof item?.placeId === 'string' ? item.placeId : undefined,
        validated: true,
      };

      if (validateResolvedLocation(candidate, parsed)) {
        return { location: candidate, quotaExceeded: false };
      }
    }

    return { location: null, quotaExceeded: false };
  } catch {
    return { location: null, quotaExceeded: false };
  }
}

async function tryGoogleGeocodingClassic(
  parsed: ParsedLocationQuery,
  apiKey: string
): Promise<{ location: GeocodedLocation | null; quotaExceeded: boolean }> {
  try {
    const regionParam = parsed.expectedCountryCode
      ? `&region=${encodeURIComponent(parsed.expectedCountryCode.toLowerCase())}`
      : '';
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(parsed.normalized)}&language=en${regionParam}&key=${encodeURIComponent(apiKey)}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
      },
      signal: AbortSignal.timeout(5000),
    });

    const data: any = await res.json().catch(() => null);
    if (
      res.status === 429 ||
      data?.status === 'OVER_QUERY_LIMIT' ||
      data?.error?.status === 'RESOURCE_EXHAUSTED'
    ) {
      return { location: null, quotaExceeded: true };
    }
    if (!res.ok || data?.status !== 'OK' || !Array.isArray(data?.results) || data.results.length === 0) {
      return { location: null, quotaExceeded: false };
    }

    for (const item of data.results) {
      const lat = Number(item?.geometry?.location?.lat);
      const lng = Number(item?.geometry?.location?.lng);
      if (!isValidCoordinatePair(lat, lng)) continue;

      const locality = extractGoogleClassicComponent(item?.address_components, [
        'locality',
        'administrative_area_level_2',
        'administrative_area_level_1',
      ]);
      const stateComp = extractGoogleClassicComponent(item?.address_components, [
        'administrative_area_level_1',
      ]);
      const countryComp = extractGoogleClassicComponent(item?.address_components, ['country']);

      const city = locality?.longName || parsed.primaryName;
      const state = stateComp?.longName || undefined;
      const country = countryComp?.longName || undefined;
      const countryCode = countryComp?.shortName?.toUpperCase() || undefined;

      const displayName =
        formatDisplayName({ name: city, state, country }) ||
        String(item?.formatted_address || parsed.normalized);

      const candidate: GeocodedLocation = {
        query: parsed.original,
        name: city,
        displayName,
        city,
        state,
        country,
        countryCode,
        latitude: lat,
        longitude: lng,
        provider: 'google',
        placeId: typeof item?.place_id === 'string' ? item.place_id : undefined,
        validated: true,
      };

      if (validateResolvedLocation(candidate, parsed)) {
        return { location: candidate, quotaExceeded: false };
      }
    }

    return { location: null, quotaExceeded: false };
  } catch {
    return { location: null, quotaExceeded: false };
  }
}

async function tryOpenMeteoServer(
  parsed: ParsedLocationQuery
): Promise<GeocodedLocation | null> {
  const searchTerms = [parsed.primaryName];
  if (parsed.normalized !== parsed.primaryName) {
    searchTerms.push(parsed.normalized);
  }

  for (const term of searchTerms) {
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(term)}&count=15&language=en&format=json`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const data: any = await res.json().catch(() => null);
      const results: OpenMeteoCandidate[] = Array.isArray(data?.results) ? data.results : [];
      const best = selectBestOpenMeteoCandidate(results, parsed);
      if (best) {
        return best;
      }
    } catch {
      // Try next term or fallback provider
    }
  }
  return null;
}

async function tryNominatimServer(
  parsed: ParsedLocationQuery
): Promise<GeocodedLocation | null> {
  try {
    const countryParam = parsed.expectedCountryCode
      ? `&countrycodes=${encodeURIComponent(parsed.expectedCountryCode.toLowerCase())}`
      : '';
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(parsed.normalized)}&format=jsonv2&addressdetails=1&limit=5${countryParam}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'en',
        'User-Agent': 'DekuAI-LocationResolver/1.0',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const items: any[] = await res.json().catch(() => []);
    if (!Array.isArray(items) || items.length === 0) return null;

    for (const item of items) {
      const lat = Number(item?.lat);
      const lng = Number(item?.lon);
      if (!isValidCoordinatePair(lat, lng)) continue;

      const addr = item?.address || {};
      const city =
        addr.city ||
        addr.town ||
        addr.village ||
        addr.municipality ||
        addr.state_district ||
        addr.state ||
        item?.name ||
        parsed.primaryName;
      const state = addr.state || undefined;
      const country = addr.country || undefined;
      const countryCode =
        typeof addr.country_code === 'string'
          ? addr.country_code.toUpperCase()
          : undefined;

      const displayName = formatDisplayName({ name: String(city), state, country });
      const candidate: GeocodedLocation = {
        query: parsed.original,
        name: String(city),
        displayName,
        city: String(city),
        state,
        country,
        countryCode,
        latitude: lat,
        longitude: lng,
        provider: 'nominatim',
        validated: true,
      };

      if (validateResolvedLocation(candidate, parsed)) {
        return candidate;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Server-side location geocoding resolver with coordinate validation and country disambiguation.
 * Runs exclusively on the server to prevent CORS blocks and protect server-side API keys.
 */
export async function geocodeLocationServer(rawQuery: string): Promise<ServerGeocodeResponse> {
  const parsed = parseLocationQuery(rawQuery);
  if (!parsed.primaryName || parsed.original.length > 200) {
    return {
      ok: false,
      location: null,
      error: 'Provide a valid location query between 1 and 200 characters.',
    };
  }

  let quotaExceeded = false;
  const serverMapsKey = (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    ''
  ).trim();

  // 1. Primary: Google Maps Platform Geocoding REST API (server-side proxy)
  if (serverMapsKey) {
    const v4Result = await tryGoogleGeocodingV4(parsed, serverMapsKey);
    if (v4Result.quotaExceeded) {
      quotaExceeded = true;
    }
    if (v4Result.location) {
      return { ok: true, location: v4Result.location, quotaExceeded };
    }

    if (!quotaExceeded) {
      const classicResult = await tryGoogleGeocodingClassic(parsed, serverMapsKey);
      if (classicResult.quotaExceeded) {
        quotaExceeded = true;
      }
      if (classicResult.location) {
        return { ok: true, location: classicResult.location, quotaExceeded };
      }
    }
  }

  // 2. Secondary: Open-Meteo Geocoding API with population/capital/country disambiguation
  const openMeteoLoc = await tryOpenMeteoServer(parsed);
  if (openMeteoLoc) {
    return { ok: true, location: openMeteoLoc, quotaExceeded };
  }

  // 3. Tertiary: OpenStreetMap Nominatim for landmarks, regions, and street addresses
  const nominatimLoc = await tryNominatimServer(parsed);
  if (nominatimLoc) {
    return { ok: true, location: nominatimLoc, quotaExceeded };
  }

  return {
    ok: false,
    location: null,
    quotaExceeded,
    error: `Location "${parsed.original}" could not be resolved to verified coordinates.`,
  };
}
