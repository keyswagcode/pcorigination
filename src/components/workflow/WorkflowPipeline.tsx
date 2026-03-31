import { useState, useEffect, useCallback } from 'react';
import { User, FileText, Clock, Building2, DollarSign, Calendar, MoreHorizontal, Loader2, Upload, Eye, CheckCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useTeam } from '../team/TeamContext';

interface Submission {
  id: string;
  status: string;
  processing_stage: string;
  created_at: string;
  updated_at: string;
  borrowers: {
    id: string;
    borrower_name: string;
    entity_type: string;
    email: string | null;
  } | null;
  loan_requests: Array<{
    requested_amount: number;
    loan_purpose: string;
  }>;
}

interface PipelineStage {
  id: string;
  name: string;
  color: { bg: string; text: string; border: string };
}

const PIPELINE_STAGES: PipelineStage[] = [
  { id: 'documents_uploading', name: 'Documents', color: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300' } },
  { id: 'extraction_complete', name: 'Extracted', color: { bg: 'bg-cyan-100', text: 'text-cyan-700', border: 'border-cyan-300' } },
  { id: 'validation', name: 'Validation', color: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-300' } },
  { id: 'pre_approval_complete', name: 'Pre-Approval', color: { bg: 'bg-teal-100', text: 'text-teal-700', border: 'border-teal-300' } },
  { id: 'underwriting', name: 'Underwriting', color: { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300' } },
  { id: 'approved', name: 'Approved', color: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300' } },
];

export function WorkflowPipeline() {
  const { organization } = useTeam();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!organization) {
      setSubmissions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase
      .from('intake_submissions')
      .select(`
        id,
        status,
        processing_stage,
        created_at,
        updated_at,
        borrowers (
          id,
          borrower_name,
          entity_type,
          email
        ),
        loan_requests (
          requested_amount,
          loan_purpose
        )
      `)
      .eq('organization_id', organization.id)
      .not('status', 'eq', 'draft')
      .order('created_at', { ascending: false });

    if (data) setSubmissions(data as Submission[]);
    if (error) console.error('Error fetching submissions:', error);
    setLoading(false);
  }, [organization]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const formatCurrency = (value: number | null | undefined) => value ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(value) : '-';
  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const getTimeInStage = (updatedAt: string) => {
    const diffMs = Date.now() - new Date(updatedAt).getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    return diffDays > 0 ? `${diffDays}d` : diffHours > 0 ? `${diffHours}h` : '<1h';
  };

  const groupedSubmissions = PIPELINE_STAGES.reduce((acc, stage) => {
    acc[stage.id] = submissions.filter(sub => sub.processing_stage === stage.id);
    return acc;
  }, {} as Record<string, Submission[]>);

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 text-teal-600 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-xl font-bold text-gray-900">Loan Pipeline</h2><p className="text-sm text-gray-500">{submissions.length} active applications</p></div>
      </div>
      <div className="overflow-x-auto pb-4">
        <div className="inline-flex gap-4 min-w-full">
          {PIPELINE_STAGES.map((stage) => {
            const stageSubmissions = groupedSubmissions[stage.id] || [];
            const colors = stage.color;
            return (
              <div key={stage.id} className="flex-shrink-0 w-72">
                <div className={`rounded-t-lg px-4 py-3 ${colors.bg} border-b-2 ${colors.border}`}>
                  <div className="flex items-center justify-between">
                    <h3 className={`font-semibold ${colors.text}`}>{stage.name}</h3>
                    <span className={`text-sm font-medium ${colors.text}`}>{stageSubmissions.length}</span>
                  </div>
                </div>
                <div className="bg-gray-50 rounded-b-lg min-h-[400px] p-2 space-y-2">
                  {stageSubmissions.map(sub => {
                    const borrower = sub.borrowers;
                    const loanRequest = sub.loan_requests?.[0];
                    const displayName = borrower?.borrower_name || borrower?.email?.split('@')[0] || 'Unknown';

                    return (
                      <div key={sub.id} className="bg-white rounded-lg border border-gray-200 p-3 cursor-pointer hover:shadow-md transition-shadow">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                              {borrower?.entity_type === 'llc' || borrower?.entity_type === 'corporation'
                                ? <Building2 className="w-4 h-4 text-gray-600" />
                                : <User className="w-4 h-4 text-gray-600" />}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-gray-900 truncate max-w-[160px]">{displayName}</p>
                              <p className="text-xs text-gray-500">{sub.id.slice(0, 8)}...</p>
                            </div>
                          </div>
                          <button className="p-1 hover:bg-gray-100 rounded"><MoreHorizontal className="w-4 h-4 text-gray-400" /></button>
                        </div>
                        {loanRequest?.requested_amount && (
                          <div className="flex items-center gap-1.5 text-sm text-gray-700 mb-2">
                            <DollarSign className="w-4 h-4 text-gray-400" />
                            {formatCurrency(loanRequest.requested_amount)}
                          </div>
                        )}
                        {loanRequest?.loan_purpose && (
                          <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded mb-2">
                            {loanRequest.loan_purpose.replace(/_/g, ' ').toUpperCase()}
                          </span>
                        )}
                        <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t border-gray-100">
                          <div className="flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDate(sub.created_at)}</div>
                          <div className="flex items-center gap-1"><Clock className="w-3 h-3" />{getTimeInStage(sub.updated_at)}</div>
                        </div>
                      </div>
                    );
                  })}
                  {stageSubmissions.length === 0 && <div className="text-center py-8 text-gray-400"><FileText className="w-8 h-8 mx-auto mb-2 opacity-50" /><p className="text-sm">No applications</p></div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
