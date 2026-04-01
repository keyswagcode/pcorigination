import { supabase } from './supabaseClient';

export interface AuditEntry {
  id: string;
  borrower_id: string | null;
  loan_scenario_id: string | null;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  user_name?: string;
}

export async function logAudit(params: {
  borrowerId?: string;
  loanScenarioId?: string;
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  fieldName?: string;
  oldValue?: string;
  newValue?: string;
  metadata?: Record<string, unknown>;
}) {
  await supabase.from('audit_trail').insert({
    borrower_id: params.borrowerId || null,
    loan_scenario_id: params.loanScenarioId || null,
    user_id: params.userId || null,
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId || null,
    field_name: params.fieldName || null,
    old_value: params.oldValue || null,
    new_value: params.newValue || null,
    metadata: params.metadata || null,
  });
}

export async function getAuditTrail(borrowerId: string): Promise<AuditEntry[]> {
  const { data } = await supabase
    .from('audit_trail')
    .select('*, user_accounts(first_name, last_name)')
    .eq('borrower_id', borrowerId)
    .order('created_at', { ascending: false })
    .limit(100);

  return (data || []).map((entry: Record<string, unknown>) => {
    const ua = entry.user_accounts as { first_name: string; last_name: string } | null;
    return {
      ...entry,
      user_name: ua ? `${ua.first_name || ''} ${ua.last_name || ''}`.trim() : undefined,
    } as AuditEntry;
  });
}

export async function getLoanAuditTrail(loanScenarioId: string): Promise<AuditEntry[]> {
  const { data } = await supabase
    .from('audit_trail')
    .select('*, user_accounts(first_name, last_name)')
    .eq('loan_scenario_id', loanScenarioId)
    .order('created_at', { ascending: false })
    .limit(100);

  return (data || []).map((entry: Record<string, unknown>) => {
    const ua = entry.user_accounts as { first_name: string; last_name: string } | null;
    return {
      ...entry,
      user_name: ua ? `${ua.first_name || ''} ${ua.last_name || ''}`.trim() : undefined,
    } as AuditEntry;
  });
}
