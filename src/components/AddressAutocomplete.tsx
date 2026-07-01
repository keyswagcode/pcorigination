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

  // ── Built-in dropdown fallback (no key required) ──────────────────────────
  // When Google Places isn't available (no key / API not enabled), suggest
  // real addresses as the borrower types via Photon (OSM, CORS-enabled, free).
  // On select we fill street/city/state/zip; the Census verify-on-submit that
  // already runs standardizes and confirms the final address.
  const [suggestions, setSuggestions] = useState<Array<ParsedAddress & { label: string }>>([]);
  const [showList, setShowList] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const googleActive = ready; // Google widget attached; skip fallback UI

  const STATE_ABBR: Record<string, string> = {
    alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
    connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
    illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
    maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
    mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
    'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
    'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
    pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
    tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
    'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
  };
  const toAbbr = (state: string) => STATE_ABBR[state.trim().toLowerCase()] || (state.length === 2 ? state.toUpperCase() : state);

  const fetchSuggestions = (q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 4) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en`);
        if (!res.ok) return;
        const data = await res.json() as { features?: Array<{ properties?: Record<string, string> }> };
        // Preserve a house number the borrower already typed if the match lacks one.
        const typedNum = (q.match(/^\s*(\d+[A-Za-z]?)\s+/) || [])[1] || '';
        const seen = new Set<string>();
        const items = (data.features || [])
          .map(f => f.properties || {})
          .filter(p => p.countrycode === 'US' && (p.street || p.name))
          .map(p => {
            const streetName = p.street || p.name || '';
            const num = p.housenumber || typedNum;
            const street = [num, streetName].filter(Boolean).join(' ');
            const state = toAbbr(p.state || '');
            const parsed: ParsedAddress & { label: string } = {
              street,
              city: p.city || p.district || '',
              state,
              zip: p.postcode || '',
              label: `${street} — ${[p.city || p.district, state, p.postcode].filter(Boolean).join(', ')}`,
            };
            return parsed;
          })
          .filter(p => {
            if (seen.has(p.label)) return false;
            seen.add(p.label);
            return true;
          })
          .slice(0, 5);
        setSuggestions(items);
        setShowList(items.length > 0);
      } catch { /* suggestions are best-effort */ }
    }, 300);
  };

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setShowList(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => {
          onChange(e.target.value);
          if (!googleActive) fetchSuggestions(e.target.value);
        }}
        onFocus={() => { if (!googleActive && suggestions.length > 0) setShowList(true); }}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        className={className}
      />
      {!googleActive && showList && suggestions.length > 0 && (
        <ul className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          {suggestions.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(s.street);
                  if (onAddressSelected) onAddressSelected({ street: s.street, city: s.city, state: s.state, zip: s.zip });
                  setShowList(false);
                  setSuggestions([]);
                }}
                className="w-full text-left px-4 py-2.5 text-sm text-gray-800 hover:bg-teal-50"
              >
                {s.label}
              </button>
            </li>
          ))}
          <li className="px-4 py-1.5 text-[10px] text-gray-400 bg-gray-50">Address suggestions — pick one or keep typing</li>
        </ul>
      )}
    </div>
  );
}
