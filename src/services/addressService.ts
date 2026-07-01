import { supabase } from '../lib/supabase';

export interface UsAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface AddressVerification {
  verified: boolean;
  standardized?: UsAddress;
  matchedAddress?: string;
}

// Verify + standardize a US address against the US Census geocoder (via the
// verify-address edge function). Best-effort: any failure returns
// {verified:false} — callers should treat that as "couldn't check", never as
// a hard block (new construction and brand-new addresses may not match yet).
export async function verifyUsAddress(addr: Partial<UsAddress>): Promise<AddressVerification> {
  try {
    if (!addr.street?.trim()) return { verified: false };
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { verified: false };

    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-address`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(addr),
    });
    if (!res.ok) return { verified: false };
    return await res.json();
  } catch {
    return { verified: false };
  }
}
