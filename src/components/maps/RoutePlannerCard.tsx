import React, { useCallback, useEffect, useRef, useState } from 'react';
import { APIProvider, Map, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { getGoogleMapsApiKey } from './GoogleMapWidgetCard';
import { ArrowDownUp, CarFront, Footprints, Bike, LocateFixed, Navigation, Route, AlertCircle, LoaderCircle } from 'lucide-react';

type TravelMode = 'DRIVING' | 'WALKING' | 'BICYCLING';

interface RoutePlannerCardProps {
  initialOrigin?: string;
  initialDestination?: string;
  className?: string;
}

function formatDistance(meters?: number) {
  if (typeof meters !== 'number') return '—';
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatDuration(seconds?: number) {
  if (typeof seconds !== 'number') return '—';
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function RouteMap({
  origin,
  destination,
  travelMode,
  requestVersion,
  onRoute,
  onError,
  onLoading,
}: {
  origin: string;
  destination: string;
  travelMode: TravelMode;
  requestVersion: number;
  onRoute: (route: any) => void;
  onError: (message: string) => void;
  onLoading: (loading: boolean) => void;
}) {
  const map = useMap('manus-route-planner-map');
  const routesLibrary = useMapsLibrary('routes');
  const rendererRef = useRef<any>(null);
  const serviceRef = useRef<any>(null);
  const [serviceReady, setServiceReady] = useState(false);

  useEffect(() => {
    if (!map || !routesLibrary || !window.google?.maps) return;
    serviceRef.current = new window.google.maps.DirectionsService();
    rendererRef.current = new window.google.maps.DirectionsRenderer({
      map,
      suppressMarkers: false,
      preserveViewport: false,
      polylineOptions: { strokeColor: '#3478F6', strokeWeight: 5, strokeOpacity: 0.9 },
    });
    setServiceReady(true);
    return () => {
      rendererRef.current?.setMap(null);
      rendererRef.current = null;
      serviceRef.current = null;
      setServiceReady(false);
    };
  }, [map, routesLibrary]);

  useEffect(() => {
    if (!requestVersion || !serviceReady || !serviceRef.current || !rendererRef.current || !window.google?.maps) return;
    let cancelled = false;
    onLoading(true);
    onError('');
    onRoute(null);
    serviceRef.current.route({
      origin,
      destination,
      travelMode: window.google.maps.TravelMode[travelMode],
      provideRouteAlternatives: false,
    }).then((result: any) => {
      if (cancelled) return;
      rendererRef.current?.setDirections(result);
      const leg = result.routes?.[0]?.legs?.[0];
      onRoute(leg ? {
        distance: leg.distance?.value,
        distanceText: leg.distance?.text,
        duration: leg.duration?.value,
        durationText: leg.duration?.text,
        startAddress: leg.start_address,
        endAddress: leg.end_address,
        steps: (leg.steps || []).slice(0, 5).map((step: any) => ({
          instruction: String(step.instructions || '').replace(/<[^>]*>/g, ''),
          distance: step.distance?.text || '',
        })),
      } : null);
      onLoading(false);
    }).catch((error: any) => {
      if (cancelled) return;
      onError(error?.message || 'Could not find a route. Check the locations and try again.');
      onLoading(false);
    });
    return () => { cancelled = true; };
  }, [requestVersion, origin, destination, travelMode, serviceReady, onRoute, onError, onLoading]);

  return null;
}

function RoutePlannerContent({
  initialOrigin = '',
  initialDestination = '',
}: RoutePlannerCardProps) {
  const [origin, setOrigin] = useState(initialOrigin);
  const [destination, setDestination] = useState(initialDestination);
  const [travelMode, setTravelMode] = useState<TravelMode>('DRIVING');
  const [requestVersion, setRequestVersion] = useState(0);
  const [route, setRoute] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);

  const onRoute = useCallback((value: any) => setRoute(value), []);
  const onError = useCallback((value: string) => setError(value), []);
  const onLoading = useCallback((value: boolean) => setLoading(value), []);

  const swapLocations = () => {
    setOrigin(destination);
    setDestination(origin);
    setRoute(null);
    setError('');
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError('Location is not supported by this browser. Enter your starting point manually.');
      return;
    }
    setLocationLoading(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setOrigin(`${coords.latitude}, ${coords.longitude}`);
        setLocationLoading(false);
      },
      () => {
        setError('Location permission was not granted. Enter your starting point manually.');
        setLocationLoading(false);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  };

  const submitRoute = (event: React.FormEvent) => {
    event.preventDefault();
    if (!origin.trim() || !destination.trim()) {
      setError('Enter both a starting point and a destination.');
      return;
    }
    if (origin.trim().toLowerCase() === destination.trim().toLowerCase()) {
      setError('Choose two different locations to plan a route.');
      return;
    }
    setError('');
    setRoute(null);
    setRequestVersion((version) => version + 1);
  };

  const openDirections = () => {
    const params = new URLSearchParams({ api: '1', origin, destination, travelmode: travelMode.toLowerCase() === 'driving' ? 'driving' : travelMode.toLowerCase() === 'walking' ? 'walking' : 'bicycling' });
    window.open(`https://www.google.com/maps/dir/?${params.toString()}`, '_blank', 'noopener,noreferrer');
  };

  const modeOptions: Array<{ value: TravelMode; label: string; Icon: typeof CarFront }> = [
    { value: 'DRIVING', label: 'Drive', Icon: CarFront },
    { value: 'WALKING', label: 'Walk', Icon: Footprints },
    { value: 'BICYCLING', label: 'Bike', Icon: Bike },
  ];

  return (
    <section className="manus-route-planner my-3 w-full overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-sm" aria-label="Route planner">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary"><Route size={17} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Plan your route</h3>
          <p className="text-xs text-muted-foreground">Choose locations and travel mode</p>
        </div>
      </div>

      <form onSubmit={submitRoute} className="space-y-3 p-3 sm:p-4">
        <div className="flex items-stretch gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <label className="flex min-w-0 items-center gap-2 rounded-xl border border-input bg-background px-3 py-2.5 focus-within:ring-2 focus-within:ring-ring/30">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-primary" aria-hidden="true" />
              <input aria-label="Starting point" value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder="Starting point" autoComplete="street-address" className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            </label>
            <label className="flex min-w-0 items-center gap-2 rounded-xl border border-input bg-background px-3 py-2.5 focus-within:ring-2 focus-within:ring-ring/30">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-rose-500" aria-hidden="true" />
              <input aria-label="Destination" value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="Destination" autoComplete="off" className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            </label>
          </div>
          <div className="flex flex-col gap-1">
            <button type="button" onClick={swapLocations} aria-label="Swap starting point and destination" title="Swap locations" className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background transition-colors hover:bg-muted"><ArrowDownUp size={16} /></button>
            <button type="button" onClick={useCurrentLocation} disabled={locationLoading} aria-label="Use current location" title="Use current location" className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background transition-colors hover:bg-muted disabled:opacity-50">{locationLoading ? <LoaderCircle size={16} className="animate-spin" /> : <LocateFixed size={16} />}</button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-1 flex-wrap gap-1.5" role="group" aria-label="Travel mode">
            {modeOptions.map(({ value, label, Icon }) => (
              <button key={value} type="button" aria-pressed={travelMode === value} onClick={() => setTravelMode(value)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium transition-colors ${travelMode === value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:bg-muted'}`}>
                <Icon size={14} />{label}
              </button>
            ))}
          </div>
          <button type="submit" disabled={loading} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60">
            {loading ? <LoaderCircle size={15} className="animate-spin" /> : <Navigation size={15} />}
            {loading ? 'Finding…' : 'Find route'}
          </button>
        </div>
      </form>

      <div className="relative h-56 w-full border-y border-border bg-muted/30 sm:h-64">
        <Map id="manus-route-planner-map" defaultCenter={{ lat: 20.5937, lng: 78.9629 }} defaultZoom={4} gestureHandling="greedy" fullscreenControl={false} streetViewControl={false} mapTypeControl={false} className="h-full w-full" />
        <RouteMap origin={origin} destination={destination} travelMode={travelMode} requestVersion={requestVersion} onRoute={onRoute} onError={onError} onLoading={onLoading} />
        {error && <div role="alert" className="absolute bottom-3 left-3 right-3 flex items-start gap-2 rounded-xl border border-destructive/20 bg-background/95 p-3 text-xs text-destructive shadow-sm"><AlertCircle size={15} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
      </div>

      {route && (
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Estimated travel time</p>
              <p className="mt-1 text-lg font-semibold">{route.durationText || formatDuration(route.duration)}</p>
            </div>
            <div className="rounded-xl bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Route distance</p>
              <p className="mt-1 text-lg font-semibold">{route.distanceText || formatDistance(route.distance)}</p>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">ROUTE SUMMARY</p>
            <p className="text-sm"><span className="font-medium">From:</span> {route.startAddress}</p>
            <p className="text-sm"><span className="font-medium">To:</span> {route.endAddress}</p>
            {route.steps?.length > 0 && (
              <ol className="space-y-2 border-l border-border pl-4">
                {route.steps.map((step: { instruction: string; distance: string }, index: number) => (
                  <li key={index} className="text-xs leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">{step.distance}</span>{step.distance ? ' · ' : ''}{step.instruction}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <button type="button" onClick={openDirections} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted">
            <Navigation size={15} /> Open full directions in Google Maps
          </button>
        </div>
      )}
    </section>
  );
}

export function RoutePlannerCard(props: RoutePlannerCardProps) {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) {
    return (
      <section className="my-3 rounded-2xl border border-border bg-card p-4 text-card-foreground">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Route size={18} /></span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">Route planner</h3>
            <p className="mt-1 text-sm text-muted-foreground">Add <code className="rounded bg-muted px-1.5 py-0.5 text-xs">VITE_GOOGLE_MAPS_API_KEY</code> to your environment to enable the interactive map and route estimates.</p>
            <a href="https://developers.google.com/maps/documentation/javascript/get-api-key" target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-primary underline underline-offset-4">Configure Maps API key <Navigation size={14} /></a>
          </div>
        </div>
      </section>
    );
  }
  return <APIProvider apiKey={apiKey} libraries={['routes'] as any}><RoutePlannerContent {...props} /></APIProvider>;
}
