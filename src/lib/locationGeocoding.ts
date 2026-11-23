import { getFirebaseAuthorizationHeader } from './firebaseAuthorization';

export interface GeocodedLocation {
  query: string;
  name: string;
  displayName: string;
  city?: string;
  state?: string;
  country?: string;
  countryCode?: string;
  latitude: number;
  longitude: number;
  provider: 'google' | 'open-meteo' | 'nominatim' | 'explicit';
  placeId?: string;
  population?: number;
  featureCode?: string;
  validated: boolean;
}

export interface ParsedLocationQuery {
  original: string;
  normalized: string;
  primaryName: string;
  qualifiers: string[];
  expectedCountryCode?: string;
  expectedCountryName?: string;
}

export interface OpenMeteoCandidate {
  id?: number;
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  country_code?: string;
  admin1?: string;
  admin2?: string;
  population?: number;
  feature_code?: string;
}

export interface GeocodeResult {
  location: GeocodedLocation | null;
  error?: string;
  quotaExceeded?: boolean;
}

/**
 * Standard ISO-3166 country alias map used purely to normalize country names/abbreviations
 * for query disambiguation (contains zero hardcoded coordinates).
 */
const COUNTRY_ALIAS_MAP: Record<string, { code: string; name: string }> = {
  in: { code: 'IN', name: 'India' },
  ind: { code: 'IN', name: 'India' },
  india: { code: 'IN', name: 'India' },
  bharat: { code: 'IN', name: 'India' },
  uk: { code: 'GB', name: 'United Kingdom' },
  'u.k': { code: 'GB', name: 'United Kingdom' },
  'u.k.': { code: 'GB', name: 'United Kingdom' },
  gb: { code: 'GB', name: 'United Kingdom' },
  britain: { code: 'GB', name: 'United Kingdom' },
  'great britain': { code: 'GB', name: 'United Kingdom' },
  england: { code: 'GB', name: 'United Kingdom' },
  scotland: { code: 'GB', name: 'United Kingdom' },
  wales: { code: 'GB', name: 'United Kingdom' },
  'united kingdom': { code: 'GB', name: 'United Kingdom' },
  us: { code: 'US', name: 'United States' },
  usa: { code: 'US', name: 'United States' },
  'u.s': { code: 'US', name: 'United States' },
  'u.s.': { code: 'US', name: 'United States' },
  'u.s.a': { code: 'US', name: 'United States' },
  'u.s.a.': { code: 'US', name: 'United States' },
  america: { code: 'US', name: 'United States' },
  'united states': { code: 'US', name: 'United States' },
  'united states of america': { code: 'US', name: 'United States' },
  jp: { code: 'JP', name: 'Japan' },
  jpn: { code: 'JP', name: 'Japan' },
  japan: { code: 'JP', name: 'Japan' },
  sg: { code: 'SG', name: 'Singapore' },
  singapore: { code: 'SG', name: 'Singapore' },
  fr: { code: 'FR', name: 'France' },
  france: { code: 'FR', name: 'France' },
  de: { code: 'DE', name: 'Germany' },
  germany: { code: 'DE', name: 'Germany' },
  ca: { code: 'CA', name: 'Canada' },
  canada: { code: 'CA', name: 'Canada' },
  au: { code: 'AU', name: 'Australia' },
  aus: { code: 'AU', name: 'Australia' },
  australia: { code: 'AU', name: 'Australia' },
  ae: { code: 'AE', name: 'United Arab Emirates' },
  uae: { code: 'AE', name: 'United Arab Emirates' },
  'united arab emirates': { code: 'AE', name: 'United Arab Emirates' },
  it: { code: 'IT', name: 'Italy' },
  italy: { code: 'IT', name: 'Italy' },
  es: { code: 'ES', name: 'Spain' },
  spain: { code: 'ES', name: 'Spain' },
  kr: { code: 'KR', name: 'South Korea' },
  'south korea': { code: 'KR', name: 'South Korea' },
  korea: { code: 'KR', name: 'South Korea' },
  br: { code: 'BR', name: 'Brazil' },
  brazil: { code: 'BR', name: 'Brazil' },
  mx: { code: 'MX', name: 'Mexico' },
  mexico: { code: 'MX', name: 'Mexico' },
  nl: { code: 'NL', name: 'Netherlands' },
  netherlands: { code: 'NL', name: 'Netherlands' },
  ch: { code: 'CH', name: 'Switzerland' },
  switzerland: { code: 'CH', name: 'Switzerland' },
  nz: { code: 'NZ', name: 'New Zealand' },
  'new zealand': { code: 'NZ', name: 'New Zealand' },
  za: { code: 'ZA', name: 'South Africa' },
  'south africa': { code: 'ZA', name: 'South Africa' },
  th: { code: 'TH', name: 'Thailand' },
  thailand: { code: 'TH', name: 'Thailand' },
  id: { code: 'ID', name: 'Indonesia' },
  indonesia: { code: 'ID', name: 'Indonesia' },
  my: { code: 'MY', name: 'Malaysia' },
  malaysia: { code: 'MY', name: 'Malaysia' },
};

const MULTI_WORD_COUNTRY_SUFFIXES = Object.keys(COUNTRY_ALIAS_MAP)
  .filter((k) => k.includes(' '))
  .sort((a, b) => b.length - a.length);

const SINGLE_WORD_COUNTRY_SUFFIXES = Object.keys(COUNTRY_ALIAS_MAP).filter(
  (k) => !k.includes(' ') && k.length >= 2
);

function normalizeToken(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveCountryAlias(
  raw: string
): { code: string; name: string } | null {
  const cleaned = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!cleaned) return null;
  if (COUNTRY_ALIAS_MAP[cleaned]) return COUNTRY_ALIAS_MAP[cleaned];
  const noDots = cleaned.replace(/\./g, '');
  if (COUNTRY_ALIAS_MAP[noDots]) return COUNTRY_ALIAS_MAP[noDots];
  return null;
}

/**
 * Validates that latitude and longitude are finite numbers within valid WGS84 bounds.
 * Rejects (0, 0) Null Island by default unless explicitly permitted.
 */
export function isValidCoordinatePair(
  latitude: unknown,
  longitude: unknown,
  options: { allowNullIsland?: boolean } = {}
): latitude is number {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return false;
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return false;
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return false;
  }
  if (!options.allowNullIsland && Math.abs(latitude) < 1e-6 && Math.abs(longitude) < 1e-6) {
    return false;
  }
  return true;
}

/**
 * Formats latitude and longitude with accurate N/S and E/W hemisphere designators.
 */
export function formatCoordinates(
  latitude: number,
  longitude: number,
  decimals = 4
): string {
  if (!isValidCoordinatePair(latitude, longitude, { allowNullIsland: true })) {
    return 'Coordinates unavailable';
  }
  const latHemisphere = latitude >= 0 ? 'N' : 'S';
  const lngHemisphere = longitude >= 0 ? 'E' : 'W';
  return `${Math.abs(latitude).toFixed(decimals)}°${latHemisphere}, ${Math.abs(longitude).toFixed(decimals)}°${lngHemisphere}`;
}

/**
 * Builds a safe external Google Maps destination URL using verified coordinates or query.
 */
export function buildGoogleMapsUrl(params: {
  latitude?: number;
  longitude?: number;
  displayName?: string;
  placeId?: string;
}): string {
  const { latitude, longitude, displayName, placeId } = params;
  const cleanName = typeof displayName === 'string' ? displayName.trim() : '';
  const cleanPlaceId = typeof placeId === 'string' ? placeId.trim() : '';

  if (cleanName && cleanPlaceId) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cleanName)}&query_place_id=${encodeURIComponent(cleanPlaceId)}`;
  }

  if (isValidCoordinatePair(latitude, longitude)) {
    const coordStr = `${latitude.toFixed(6)},${(longitude as number).toFixed(6)}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordStr)}`;
  }

  if (cleanName) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cleanName)}`;
  }

  return 'https://www.google.com/maps';
}

/**
 * Parses a natural location string such as "Delhi, India", "London, UK",
 * "New York USA", or "Delhi" into primary place name and country/region qualifiers.
 */
export function parseLocationQuery(rawQuery: string): ParsedLocationQuery {
  const sanitized = String(rawQuery || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[,\s]+|[?.!,;\s]+$/g, '')
    .trim();

  if (!sanitized) {
    return {
      original: '',
      normalized: '',
      primaryName: '',
      qualifiers: [],
    };
  }

  // Split comma-separated segments: "New York, NY, USA" -> primary "New York", qualifiers ["NY", "USA"]
  const commaParts = sanitized
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  let primaryName = commaParts[0] || sanitized;
  const qualifiers = commaParts.slice(1);

  let expectedCountryCode: string | undefined;
  let expectedCountryName: string | undefined;

  // Check explicit comma qualifiers from right to left for a country alias
  for (let i = qualifiers.length - 1; i >= 0; i--) {
    const match = resolveCountryAlias(qualifiers[i]);
    if (match) {
      expectedCountryCode = match.code;
      expectedCountryName = match.name;
      break;
    }
  }

  // If no comma qualifiers were given, detect trailing space-separated country names like "London UK" or "Delhi India"
  if (qualifiers.length === 0) {
    const lowerPrimary = primaryName.toLowerCase();
    for (const suffix of MULTI_WORD_COUNTRY_SUFFIXES) {
      if (lowerPrimary.endsWith(` ${suffix}`) && primaryName.length > suffix.length + 1) {
        const alias = resolveCountryAlias(suffix);
        if (alias) {
          primaryName = primaryName.slice(0, primaryName.length - suffix.length).trim();
          qualifiers.push(alias.name);
          expectedCountryCode = alias.code;
          expectedCountryName = alias.name;
          break;
        }
      }
    }

    if (!expectedCountryCode) {
      const words = primaryName.split(/\s+/);
      if (words.length >= 2) {
        const lastWord = words[words.length - 1];
        const normalizedLast = lastWord.toLowerCase().replace(/\.+$/g, '');
        if (SINGLE_WORD_COUNTRY_SUFFIXES.includes(normalizedLast)) {
          const alias = resolveCountryAlias(lastWord);
          // Avoid splitting valid city names like "New York" or "Los Angeles" (neither ends with a country alias)
          // and avoid stripping "in" (preposition) or "us" unless uppercase "US" or "USA"
          const isAmbiguousTwoLetterWord =
            (normalizedLast === 'in' || normalizedLast === 'us' || normalizedLast === 'id') &&
            lastWord !== lastWord.toUpperCase();
          if (alias && !isAmbiguousTwoLetterWord) {
            primaryName = words.slice(0, -1).join(' ').trim();
            qualifiers.push(alias.name);
            expectedCountryCode = alias.code;
            expectedCountryName = alias.name;
          }
        }
      }
    }
  }

  const normalized =
    qualifiers.length > 0 ? `${primaryName}, ${qualifiers.join(', ')}` : primaryName;

  return {
    original: sanitized,
    normalized,
    primaryName,
    qualifiers,
    expectedCountryCode,
    expectedCountryName,
  };
}

/**
 * Formats a clean display name like "Delhi, India" or "New York, New York, United States"
 * while avoiding duplicate consecutive segments (e.g. "Delhi, Delhi, India" -> "Delhi, India").
 */
export function formatDisplayName(parts: {
  name: string;
  state?: string;
  country?: string;
}): string {
  const segments: string[] = [];
  const pushUnique = (val?: string) => {
    const clean = typeof val === 'string' ? val.trim() : '';
    if (!clean) return;
    const norm = normalizeToken(clean);
    if (!norm) return;
    if (segments.some((existing) => normalizeToken(existing) === norm)) return;
    segments.push(clean);
  };

  pushUnique(parts.name);
  // Include state/admin1 only when it meaningfully adds disambiguation and differs from city name
  if (parts.state && normalizeToken(parts.state) !== normalizeToken(parts.name)) {
    const cityNorm = normalizeToken(parts.name);
    const stateNorm = normalizeToken(parts.state);
    // Avoid redundant "National Capital Territory of Delhi" next to "Delhi"
    if (!stateNorm.includes(cityNorm) && !cityNorm.includes(stateNorm)) {
      pushUnique(parts.state);
    }
  }
  pushUnique(parts.country);

  return segments.join(', ') || parts.name;
}

/**
 * Validates a resolved location against geographic bounds and any explicit country qualifier
 * from the user's query so misleading cross-country mismatches are rejected.
 */
export function validateResolvedLocation(
  location: GeocodedLocation,
  parsed: ParsedLocationQuery
): boolean {
  if (!isValidCoordinatePair(location.latitude, location.longitude)) {
    return false;
  }

  if (parsed.expectedCountryCode && location.countryCode) {
    if (location.countryCode.toUpperCase() !== parsed.expectedCountryCode.toUpperCase()) {
      return false;
    }
  }

  return true;
}

/**
 * Ranks Open-Meteo geocoding candidates using exact name match, country/state qualifiers,
 * administrative feature importance (capitals first), and population so ambiguous city
 * names like "Delhi", "London", or "New York" always resolve accurately.
 */
export function selectBestOpenMeteoCandidate(
  candidates: OpenMeteoCandidate[],
  parsed: ParsedLocationQuery
): GeocodedLocation | null {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const targetPrimary = normalizeToken(parsed.primaryName);
  const qualifierTokens = parsed.qualifiers
    .map((q) => normalizeToken(q))
    .filter(Boolean);

  let bestCandidate: OpenMeteoCandidate | null = null;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    if (!isValidCoordinatePair(candidate.latitude, candidate.longitude)) {
      continue;
    }

    const candName = normalizeToken(candidate.name || '');
    const candCountry = normalizeToken(candidate.country || '');
    const candCountryCode = (candidate.country_code || '').toUpperCase();
    const candAdmin1 = normalizeToken(candidate.admin1 || '');
    const candAdmin2 = normalizeToken(candidate.admin2 || '');

    let score = 0;

    // 1. Primary city/place name matching
    if (candName === targetPrimary) {
      score += 55;
    } else if (
      candName === `new ${targetPrimary}` ||
      targetPrimary === `new ${candName}`
    ) {
      score += 42;
    } else if (candName.startsWith(targetPrimary) || targetPrimary.startsWith(candName)) {
      score += 25;
    } else if (candName.includes(targetPrimary) || targetPrimary.includes(candName)) {
      score += 12;
    }

    // 2. Country qualifier matching (strongest signal when explicitly provided)
    if (parsed.expectedCountryCode) {
      if (candCountryCode === parsed.expectedCountryCode.toUpperCase()) {
        score += 160;
      } else {
        // Explicit country mismatch must be heavily penalized / rejected
        continue;
      }
    }

    // 3. State / region qualifier matching
    for (const qToken of qualifierTokens) {
      if (parsed.expectedCountryName && qToken === normalizeToken(parsed.expectedCountryName)) {
        continue;
      }
      if (qToken === candAdmin1 || qToken === candAdmin2 || qToken === candCountry) {
        score += 75;
      } else if (
        (candAdmin1 && (candAdmin1.includes(qToken) || qToken.includes(candAdmin1))) ||
        (candAdmin2 && (candAdmin2.includes(qToken) || qToken.includes(candAdmin2)))
      ) {
        score += 40;
      }
    }

    // 4. Geographic feature class priority (national & regional capitals ranked higher)
    const feature = (candidate.feature_code || '').toUpperCase();
    if (feature === 'PPLC') {
      score += 48;
    } else if (feature === 'PPLA') {
      score += 38;
    } else if (feature === 'PPLA2') {
      score += 24;
    } else if (feature === 'PPLA3' || feature === 'PPLG') {
      score += 16;
    } else if (feature === 'PPL') {
      score += 12;
    } else if (feature.startsWith('ADM') || feature === 'PCLI') {
      score += 14;
    }

    // 5. Population weight (logarithmic scale so major world cities beat tiny towns with identical names)
    const pop = typeof candidate.population === 'number' && candidate.population > 0 ? candidate.population : 0;
    if (pop > 0) {
      score += Math.min(95, Math.log10(pop) * 13);
    }

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (!bestCandidate) {
    return null;
  }

  const displayName = formatDisplayName({
    name: bestCandidate.name,
    state: bestCandidate.admin1,
    country: bestCandidate.country,
  });

  const resolved: GeocodedLocation = {
    query: parsed.original,
    name: bestCandidate.name,
    displayName,
    city: bestCandidate.name,
    state: bestCandidate.admin1,
    country: bestCandidate.country,
    countryCode: bestCandidate.country_code?.toUpperCase(),
    latitude: Number(bestCandidate.latitude),
    longitude: Number(bestCandidate.longitude),
    provider: 'open-meteo',
    population: bestCandidate.population,
    featureCode: bestCandidate.feature_code,
    validated: true,
  };

  return validateResolvedLocation(resolved, parsed) ? resolved : null;
}

const CLIENT_GEOCODE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes (session memory only)
const CLIENT_GEOCODE_CACHE_MAX_ENTRIES = 100;
const clientGeocodeCache: Record<string, { value: GeocodedLocation; expiresAt: number }> = {};

function getCachedLocation(key: string): GeocodedLocation | null {
  const entry = clientGeocodeCache[key];
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    delete clientGeocodeCache[key];
    return null;
  }
  return entry.value;
}

function setCachedLocation(key: string, value: GeocodedLocation): void {
  const keys = Object.keys(clientGeocodeCache);
  if (keys.length >= CLIENT_GEOCODE_CACHE_MAX_ENTRIES) {
    delete clientGeocodeCache[keys[0]];
  }
  clientGeocodeCache[key] = {
    value,
    expiresAt: Date.now() + CLIENT_GEOCODE_CACHE_TTL_MS,
  };
}

export function clearGeocodeCacheForTests(): void {
  for (const key of Object.keys(clientGeocodeCache)) {
    delete clientGeocodeCache[key];
  }
}

/**
 * Direct Open-Meteo Geocoding lookup (CORS-friendly public endpoint) with multi-candidate disambiguation.
 */
export async function geocodeWithOpenMeteo(
  rawQuery: string,
  signal?: AbortSignal
): Promise<GeocodedLocation | null> {
  const parsed = parseLocationQuery(rawQuery);
  if (!parsed.primaryName) return null;

  const baseUrl =
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_OPEN_METEO_GEOCODING_URL) ||
    'https://geocoding-api.open-meteo.com/v1/search';

  const searchTerms = [parsed.primaryName];
  if (parsed.normalized !== parsed.primaryName) {
    searchTerms.push(parsed.normalized);
  }

  for (const term of searchTerms) {
    const url = `${baseUrl}?name=${encodeURIComponent(term)}&count=15&language=en&format=json`;
    const res = await fetch(url, { signal });
    if (!res.ok) continue;
    const data = await res.json().catch(() => null);
    const results: OpenMeteoCandidate[] = Array.isArray(data?.results) ? data.results : [];
    const best = selectBestOpenMeteoCandidate(results, parsed);
    if (best) {
      return best;
    }
  }

  return null;
}

/**
 * Primary client-side geocoding entrypoint:
 * 1. Calls our server-side /api/geocode proxy (uses Google Geocoding REST API when available,
 *    avoiding client-side CORS issues, with Open-Meteo + Nominatim fallbacks).
 * 2. Falls back cleanly to CORS-enabled Open-Meteo Geocoding with full disambiguation if
 *    the local/Netlify proxy is unavailable.
 */
export async function geocodeLocation(
  rawQuery: string,
  signal?: AbortSignal
): Promise<GeocodeResult> {
  const parsed = parseLocationQuery(rawQuery);
  if (!parsed.primaryName) {
    return { location: null, error: 'Please provide a valid location name.' };
  }

  const cacheKey = normalizeToken(parsed.normalized);
  const cached = getCachedLocation(cacheKey);
  if (cached) {
    return { location: cached };
  }

  let quotaExceeded = false;

  // 1. Try server-side geocoding proxy (/api/geocode) when running in a browser origin
  if (typeof window !== 'undefined' && typeof fetch === 'function') {
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      try {
        const authHeader = await getFirebaseAuthorizationHeader();
        if (authHeader) {
          headers.Authorization = authHeader;
        }
      } catch {
        // Continue — server may still allow fallback or client Open-Meteo will resolve
      }

      const proxyRes = await fetch(
        `/api/geocode?q=${encodeURIComponent(parsed.normalized)}`,
        {
          method: 'GET',
          headers,
          signal,
        }
      );

      if (proxyRes.status === 429) {
        const errPayload = await proxyRes.json().catch(() => null);
        if (errPayload?.quotaExceeded || errPayload?.error?.status === 'RESOURCE_EXHAUSTED') {
          quotaExceeded = true;
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
      } else if (proxyRes.ok) {
        const contentType = (proxyRes.headers?.get?.('content-type') || '').toLowerCase();
        if (contentType.includes('application/json')) {
          const payload = await proxyRes.json().catch(() => null);
          if (payload?.quotaExceeded) {
            quotaExceeded = true;
            window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
          }
          const loc = payload?.location as GeocodedLocation | undefined;
          if (loc && validateResolvedLocation(loc, parsed)) {
            setCachedLocation(cacheKey, loc);
            if ((import.meta as any).env?.DEV) {
              console.debug('[LocationGeocoding] Resolved via /api/geocode:', {
                query: parsed.original,
                displayName: loc.displayName,
                latitude: loc.latitude,
                longitude: loc.longitude,
                provider: loc.provider,
              });
            }
            return { location: loc, quotaExceeded };
          }
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw err;
      }
      if ((import.meta as any).env?.DEV) {
        console.debug('[LocationGeocoding] /api/geocode unavailable, using Open-Meteo fallback:', err?.message || err);
      }
    }
  }

  // 2. Reliable CORS-enabled fallback via Open-Meteo Geocoding with multi-candidate disambiguation
  try {
    const resolved = await geocodeWithOpenMeteo(parsed.normalized, signal);
    if (resolved) {
      setCachedLocation(cacheKey, resolved);
      if ((import.meta as any).env?.DEV) {
        console.debug('[LocationGeocoding] Resolved via Open-Meteo:', {
          query: parsed.original,
          displayName: resolved.displayName,
          latitude: resolved.latitude,
          longitude: resolved.longitude,
          provider: resolved.provider,
        });
      }
      return { location: resolved, quotaExceeded };
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw err;
    }
    if ((import.meta as any).env?.DEV) {
      console.warn('[LocationGeocoding] Open-Meteo geocoding error:', err?.message || err);
    }
  }

  return {
    location: null,
    quotaExceeded,
    error: `Could not verify coordinates for "${parsed.original}".`,
  };
}
