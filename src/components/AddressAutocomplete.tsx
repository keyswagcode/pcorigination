import { useEffect, useRef, useState } from 'react';

interface ParsedAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

interface Props {
  value: string;
  onChange: (street: string) => void;
  onAddressSelected?: (parsed: ParsedAddress) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
}

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

let scriptLoadingPromise: Promise<void> | null = null;

function loadGoogleMaps(): Promise<void> {
  if (!GOOGLE_MAPS_KEY) return Promise.reject(new Error('No Google Maps API key'));
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  const w = window as unknown as { google?: { maps?: { places?: unknown } } };
  if (w.google?.maps?.places) return Promise.resolve();
  if (scriptLoadingPromise) return scriptLoadingPromise;

  scriptLoadingPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-google-maps-loader]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Google Maps failed to load')));
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}&libraries=places&v=weekly`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMapsLoader = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(script);
  });
  return scriptLoadingPromise;
}

interface PlaceComponent { long_name: string; short_name: string; types: string[] }
interface PlaceResult { address_components?: PlaceComponent[] }

function parsePlace(place: PlaceResult): ParsedAddress {
  const get = (type: string, useShort = false) => {
    const c = place.address_components?.find(comp => comp.types.includes(type));
    if (!c) return '';
    return useShort ? c.short_name : c.long_name;
  };

  const streetNumber = get('street_number');
  const route = get('route');
  const street = [streetNumber, route].filter(Boolean).join(' ');
  const city = get('locality') || get('sublocality') || get('postal_town') || get('administrative_area_level_2');
  const state = get('administrative_area_level_1', true);
  const zip = get('postal_code');

  return { street, city, state, zip };
}

export function AddressAutocomplete({ value, onChange, onAddressSelected, placeholder, required, className }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!GOOGLE_MAPS_KEY) return;
    let cancelled = false;
    loadGoogleMaps()
      .then(() => { if (!cancelled) setReady(true); })
      .catch(() => { /* fall through to plain input */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready || !inputRef.current) return;
    const w = window as unknown as {
      google?: {
        maps?: {
          places?: {
            Autocomplete: new (
              input: HTMLInputElement,
              options: { types: string[]; componentRestrictions: { country: string }; fields: string[] }
            ) => {
              addListener: (event: string, cb: () => void) => void;
              getPlace: () => PlaceResult;
            };
          };
        };
      };
    };
    const Autocomplete = w.google?.maps?.places?.Autocomplete;
    if (!Autocomplete) return;

    const ac = new Autocomplete(inputRef.current, {
      types: ['address'],
      componentRestrictions: { country: 'us' },
      fields: ['address_components'],
    });

    const listener = ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      const parsed = parsePlace(place);
      if (parsed.street) onChange(parsed.street);
      if (onAddressSelected) onAddressSelected(parsed);
    });

    return () => {
      // No safe global removeListener exposed in the typed API; best-effort cleanup.
      void listener;
    };
  }, [ready, onChange, onAddressSelected]);

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      autoComplete="street-address"
      className={className}
    />
  );
}
