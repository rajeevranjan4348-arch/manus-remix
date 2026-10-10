import React, { useState, useEffect } from 'react';
import { APIProvider, Map, AdvancedMarker, Pin } from '@vis.gl/react-google-maps';
import { MapPin, Navigation, Search, AlertCircle, Compass } from 'lucide-react';

interface GoogleMapWidgetCardProps {
  locationName?: string;
  latitude?: number;
  longitude?: number;
  zoom?: number;
  markers?: Array<{
    id: string;
    title: string;
    lat: number;
    lng: number;
    description?: string;
  }>;
}

export function GoogleMapWidgetCard({
  locationName = 'Singapore',
  latitude = 1.3521,
  longitude = 103.8198,
  zoom = 12,
  markers = []
}: GoogleMapWidgetCardProps) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || 'AIzaSyCoOhAP8IKASkSa6jOp4AVe886-arwMzAU';
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [center, setCenter] = useState({ lat: latitude, lng: longitude });

  useEffect(() => {
    const handleQuotaExceeded = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handleQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', handleQuotaExceeded);
  }, []);

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
      <div className="p-3.5 bg-muted/20 border-b border-border/60 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-red-500/10 text-red-500">
            <MapPin size={16} />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-foreground">{locationName}</h4>
            <p className="text-[10px] text-muted-foreground font-mono">
              {center.lat.toFixed(4)}°N, {center.lng.toFixed(4)}°E
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground bg-muted/40 px-2.5 py-1 rounded-full border border-border/50">
          <Compass size={12} className="animate-spin-slow text-primary" />
          <span>Google Maps Live</span>
        </div>
      </div>

      {/* Map Viewport */}
      <div className="w-full h-64 relative bg-muted/30">
        <APIProvider apiKey={apiKey}>
          <Map
            mapId="DEMO_MAP_ID"
            defaultCenter={center}
            defaultZoom={zoom}
            gestureHandling="greedy"
            disableDefaultUI={false}
            internalUsageAttributionIds={["gmp_mcp_codeassist_v1_aistudio"]}
            className="w-full h-full rounded-b-2xl"
          >
            {/* Primary Location Marker */}
            <AdvancedMarker position={center}>
              <Pin background="#E11D48" glyphColor="#FFFFFF" borderColor="#9F1239" />
            </AdvancedMarker>

            {/* Extra Markers */}
            {markers.map((m) => (
              <AdvancedMarker key={m.id} position={{ lat: m.lat, lng: m.lng }} title={m.title}>
                <Pin background="#2563EB" glyphColor="#FFFFFF" borderColor="#1E40AF" />
              </AdvancedMarker>
            ))}
          </Map>
        </APIProvider>
      </div>
    </div>
  );
}
