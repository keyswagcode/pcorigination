import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Verify + standardize a US address against the US Census Bureau geocoder
// (free, no key, government-run). The geocoder has no CORS headers, so the
// browser can't call it directly — this function proxies one lookup per call.
// Returns the standardized components when matched so the client can correct
// what the borrower typed into the real address.

interface CensusMatch {
  matchedAddress?: string
  addressComponents?: {
    fromAddress?: string
    streetName?: string
    suffixType?: string
    preDirection?: string
    suffixDirection?: string
    city?: string
    state?: string
    zip?: string
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Any authenticated user (borrowers included) may verify an address.
    const authHeader = req.headers.get('Authorization') || ''
    const { data: { user } } = await serviceClient.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { street, city, state, zip } = await req.json().catch(() => ({}))
    if (!street || typeof street !== 'string') {
      return new Response(JSON.stringify({ error: 'street is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const oneline = [street, city, state, zip].filter(Boolean).join(', ').slice(0, 200)
    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(oneline)}&benchmark=Public_AR_Current&format=json`

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    const text = await res.text()
    let data: Record<string, unknown> = {}
    try { data = JSON.parse(text) } catch { /* treat as no match */ }

    const matches = ((data.result as Record<string, unknown> | undefined)?.addressMatches || []) as CensusMatch[]
    if (matches.length === 0) {
      return new Response(JSON.stringify({ verified: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // matchedAddress is "9755 NARDIN ST, DETROIT, MI, 48204" — split into parts.
    const m = matches[0]
    const parts = (m.matchedAddress || '').split(',').map((p) => p.trim())
    const standardized = {
      street: parts[0] || street,
      city: parts[1] || city || '',
      state: parts[2] || state || '',
      zip: parts[3] || zip || '',
    }

    return new Response(JSON.stringify({
      verified: true,
      matchedAddress: m.matchedAddress,
      standardized,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    // Verification is best-effort — never block the borrower on our error.
    return new Response(JSON.stringify({ verified: false, error: (err as Error).message.slice(0, 120) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
