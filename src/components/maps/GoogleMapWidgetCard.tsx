import React, { useState, useEffect, useMemo } from 'react';
import { APIProvider, Map, AdvancedMarker, Pin, useMap } from '@vis.gl/react-google-maps';
import { MapPin, AlertCircle, Compass, ExternalLink, Loader2 } from 'lucide-react';
import {
  buildGoogleMapsUrl,
  formatCoordinates,
  GeocodedLocation,
  geocodeLocation,
  isValidCoordinatePair,
} from '../../lib/locationGeocoding';

interface GoogleMapWidgetCardProps {
  locationName?: string;
  latitude?: number;
  longitude?: number;
  zoom?: number;
  autoLocate?: boolean;
  markers?: Array<{
    id: string;
    title: string;
    lat: number;
    lng: number;
    description?: string;
  }>;
}

interface LatLngCoords {
  lat: number;
  lng: number;
}

function MapViewportController({
  center,
  zoom,
}: {
  center: LatLngCoords;
  zoom: number;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || !isValidCoordinatePair(center.lat, center.lng)) return;
    map.panTo(center);
    if (Number.isFinite(zoom)) {
      map.setZoom(zoom);
    }
  }, [map, center.lat, center.lng, zoom]);

  return null;
}

export function GoogleMapWidgetCard({
  locationName,
  latitude,
  longitude,
  zoom = 12,
  autoLocate = false,
  markers = [],
}: GoogleMapWidgetCardProps) {
  const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
  const hasExplicitCoords = isValidCoordinatePair(latitude, longitude);
  const trimmedQuery = (locationName || '').trim();

  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [mapLoadError, setMapLoadError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState<boolean>(
    !hasExplicitCoords && Boolean(trimmedQuery)
  );
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolvedLocation, setResolvedLocation] = useState<GeocodedLocation | null>(() => {
    if (hasExplicitCoords) {
      return {
        query: trimmedQuery || 'Selected Location',
        name: trimmedQuery || 'Selected Location',
        displayName: trimmedQuery || 'Selected Location',
        latitude: latitude as number,
        longitude: longitude as number,
        provider: 'explicit',
        validated: true,
      };
    }
    return null;
  });

  useEffect(() => {
    const handleQuotaExceeded = () => setQuotaExceeded(true);
    const handleAuthFailure = () => {
      setMapLoadError(
        'Google Maps authentication failed. Verify API key restrictions, enabled Maps JavaScript API, and billing.'
      );
    };
    window.addEventListener('gmp-quota-exceeded', handleQuotaExceeded);
    window.addEventListener('gmp-auth-failure', handleAuthFailure);
    return () => {
      window.removeEventListener('gmp-quota-exceeded', handleQuotaExceeded);
      window.removeEventListener('gmp-auth-failure', handleAuthFailure);
    };
  }, []);

  useEffect(() => {
    if (hasExplicitCoords) {
      setResolvedLocation({
        query: trimmedQuery || 'Selected Location',
        name: trimmedQuery || 'Selected Location',
        displayName: trimmedQuery || 'Selected Location',
        latitude: latitude as number,
        longitude: longitude as number,
        provider: 'explicit',
        validated: true,
      });
      setIsResolving(false);
      setResolveError(null);
      return;
    }

    if (!trimmedQuery) {
      if (autoLocate && typeof navigator !== 'undefined' && navigator.geolocation) {
        setIsResolving(true);
        setResolveError(null);
        let cancelled = false;
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (cancelled) return;
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            if (isValidCoordinatePair(lat, lng)) {
              setResolvedLocation({
                query: 'Current Location',
                name: 'Current Location',
                displayName: 'Current Location',
                latitude: lat,
                longitude: lng,
                provider: 'explicit',
                validated: true,
              });
            } else {
              setResolveError('Device returned invalid coordinates.');
            }
            setIsResolving(false);
          },
          () => {
            if (cancelled) return;
            setResolveError('Location access was not granted.');
            setIsResolving(false);
          },
          { timeout: 8000 }
        );
        return () => {
          cancelled = true;
        };
      }

      setResolvedLocation(null);
      setIsResolving(false);
      setResolveError('No location specified.');
      return;
    }

    const controller = new AbortController();
    let active = true;
    setIsResolving(true);
    setResolveError(null);

    if (import.meta.env.DEV) {
      console.debug('[GoogleMapWidgetCard] Geocoding location:', trimmedQuery);
    }

    geocodeLocation(trimmedQuery, controller.signal)
      .then((result) => {
        if (!active) return;
        if (result.quotaExceeded) {
          setQuotaExceeded(true);
        }
        if (
          result.location &&
          isValidCoordinatePair(result.location.latitude, result.location.longitude)
        ) {
          setResolvedLocation(result.location);
          setResolveError(null);
          if (import.meta.env.DEV) {
            console.debug('[GoogleMapWidgetCard] Location verified:', {
              displayName: result.location.displayName,
              lat: result.location.latitude,
              lng: result.location.longitude,
              provider: result.location.provider,
            });
          }
        } else {
          setResolvedLocation(null);
          setResolveError(
            result.error || `Unable to determine verified coordinates for "${trimmedQuery}".`
          );
          if (import.meta.env.DEV) {
            console.warn('[GoogleMapWidgetCard] Geocoding failed for:', trimmedQuery, result.error);
          }
        }
        setIsResolving(false);
      })
      .catch((err: any) => {
        if (!active || err?.name === 'AbortError') return;
        setResolvedLocation(null);
        setResolveError(`Unable to look up "${trimmedQuery}". Please try again.`);
        setIsResolving(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [trimmedQuery, hasExplicitCoords, latitude, longitude, autoLocate]);

  const center = useMemo<LatLngCoords | null>(() => {
    if (
      resolvedLocation &&
      isValidCoordinatePair(resolvedLocation.latitude, resolvedLocation.longitude)
    ) {
      return {
        lat: resolvedLocation.latitude,
        lng: resolvedLocation.longitude,
      };
    }
    return null;
  }, [resolvedLocation]);

  const validExtraMarkers = useMemo(
    () => markers.filter((m) => isValidCoordinatePair(m.lat, m.lng)),
    [markers]
  );

  const displayTitle =
    resolvedLocation?.displayName || trimmedQuery || 'Location Lookup';

  const coordinatesLabel = center
    ? formatCoordinates(center.lat, center.lng)
    : isResolving
      ? 'Resolving verified coordinates...'
      : 'Coordinates unavailable';

  const googleMapsHref = useMemo(
    () =>
      buildGoogleMapsUrl({
        latitude: center?.lat,
        longitude: center?.lng,
        displayName: displayTitle,
        placeId: resolvedLocation?.placeId,
      }),
    [center?.lat, center?.lng, displayTitle, resolvedLocation?.placeId]
  );

  const canRenderInteractiveMap = Boolean(
    apiKey && center && !mapLoadError && !quotaExceeded
  );

  return (
    <div className="w-full rounded-2xl border border-border/80 bg-card overflow-hidden shadow-lg my-3">
      {/* Quota Banner */}
      {quotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {/* Header */}
      <div className="p-3.5 bg-muted/20 border-b border-border/60 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-lg bg-red-500/10 text-red-500 shrink-0">
            <MapPin size={16} />
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-semibold text-foreground truncate">
              {displayTitle}
            </h4>
            <p className="text-[10px] text-muted-foreground font-mono truncate">
              {coordinatesLabel}
            </p>
          </div>
        </div>

        <a
          href={googleMapsHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${displayTitle} in Google Maps`}
          className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground bg-muted/40 px-2.5 py-1 rounded-full border border-border/50 transition-colors cursor-pointer shrink-0"
        >
          <Compass size={12} className="animate-spin-slow text-primary" />
          <span>Google Maps Live</span>
        </a>
      </div>

      {/* Map Viewport */}
      <div className="w-full h-64 relative bg-muted/30">
        {isResolving ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center text-xs text-muted-foreground">
            <Loader2 size={20} className="animate-spin text-primary" aria-hidden="true" />
            <p>Locating {trimmedQuery || 'destination'}...</p>
          </div>
        ) : resolveError || !center ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center text-xs text-muted-foreground">
            <AlertCircle size={20} aria-hidden="true" />
            <p>{resolveError || 'Could not resolve valid coordinates for this location.'}</p>
            {trimmedQuery && (
              <a
                href={googleMapsHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary font-medium hover:underline"
              >
                <span>Search in Google Maps</span>
                <ExternalLink size={12} />
              </a>
            )}
          </div>
        ) : canRenderInteractiveMap ? (
          <APIProvider
            apiKey={apiKey}
            language="en"
            onError={(err) => {
              if (import.meta.env.DEV) {
                console.error('[GoogleMapWidgetCard] Google Maps SDK load error:', err);
              }
              setMapLoadError(
                'Google Maps could not be loaded. Check network connectivity, enabled APIs, or referrer restrictions.'
              );
            }}
          >
            <Map
              mapId="DEMO_MAP_ID"
              defaultCenter={center}
              defaultZoom={zoom}
              gestureHandling="greedy"
              disableDefaultUI={false}
              internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
              className="w-full h-full rounded-b-2xl"
            >
              <MapViewportController center={center} zoom={zoom} />
              <AdvancedMarker position={center} title={displayTitle}>
                <Pin background="#E11D48" glyphColor="#FFFFFF" borderColor="#9F1239" />
              </AdvancedMarker>
              {validExtraMarkers.map((m) => (
                <AdvancedMarker
                  key={m.id}
                  position={{ lat: m.lat, lng: m.lng }}
                  title={m.title}
                >
                  <Pin background="#2563EB" glyphColor="#FFFFFF" borderColor="#1E40AF" />
                </AdvancedMarker>
              ))}
            </Map>
          </APIProvider>
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center text-xs text-muted-foreground">
            <AlertCircle size={20} aria-hidden="true" />
            <p className="font-medium text-foreground">{displayTitle}</p>
            <p className="font-mono text-[11px]">{coordinatesLabel}</p>
            <p className="max-w-sm">
              {mapLoadError
                ? mapLoadError
                : quotaExceeded
                  ? 'Interactive map tiles are temporarily paused because the API quota was reached.'
                  : 'Interactive map unavailable: configure a domain-restricted key in VITE_GOOGLE_MAPS_API_KEY.'}
            </p>
            <a
              href={googleMapsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-1 text-primary font-medium hover:underline"
            >
              <span>Open destination in Google Maps</span>
              <ExternalLink size={12} />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
