import { supabase } from './supabaseClient';
import type { Organization, OrganizationMember } from '../shared/types';

export async function getOrganizationForUser(userId: string): Promise<{ organization: Organization | null; member: OrganizationMember | null }> {
  const { data } = await supabase
    .from('organization_members')
    .select(`
      id,
      user_id,
      organization_id,
      role,
      display_name,
      is_active,
      organizations (id, name, slug)
    `)
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (!data) return { organization: null, member: null };

  const org = data.organizations as unknown as Organization | null;
  const member: OrganizationMember = {
    id: data.id,
    user_id: data.user_id,
    organization_id: data.organization_id,
    role: data.role,
    display_name: data.display_name,
    is_active: data.is_active,
  };

  return { organization: org, member };
}

export async function getOrganizationMembers(organizationId: string): Promise<OrganizationMember[]> {
  const { data } = await supabase
    .from('organization_members')
    .select('id, user_id, organization_id, role, display_name, email, is_active, invited_by_user_id, invite_status')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .order('display_name');

  return data || [];
}
