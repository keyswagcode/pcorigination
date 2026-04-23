import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FALLBACK = { orgName: 'Key Real Estate Capital', orgLogoUrl: null }

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await serviceClient.auth.getUser(token)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json().catch(() => ({}))
    let brokerId: string | null = null

    if (body.borrower_id) {
      const { data: b } = await serviceClient
        .from('borrowers').select('broker_id').eq('id', body.borrower_id).maybeSingle()
      brokerId = b?.broker_id || null
    } else {
      // Default: find the borrower row for the calling user, then their broker
      const { data: b } = await serviceClient
        .from('borrowers').select('broker_id').eq('user_id', user.id).maybeSingle()
      brokerId = b?.broker_id || null
    }

    if (!brokerId) {
      return new Response(JSON.stringify(FALLBACK), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: orgMember } = await serviceClient
      .from('organization_members')
      .select('organizations(name, logo_url)')
      .eq('user_id', brokerId)
      .maybeSingle()

    const org = orgMember?.organizations as unknown as { name?: string; logo_url?: string | null } | null
    return new Response(JSON.stringify({
      orgName: org?.name || FALLBACK.orgName,
      orgLogoUrl: org?.logo_url || null,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message, ...FALLBACK }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
