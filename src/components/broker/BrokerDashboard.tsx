import { useState, useEffect } from 'react';
import { Users, FileText, AlertTriangle, Clock, CheckCircle, TrendingUp, Eye, Upload, AlertCircle, Calendar, ListFilter as Filter, Search, ChevronRight, Bot } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useRouter } from '../../contexts/RouterContext';
import { useTeam } from '../team/TeamContext';
import { BorrowerManagement } from './BorrowerManagement';
import { NotificationCenter } from '../notifications/NotificationCenter';

interface PipelineStage {
  id: string;
  name: string;
  count: number;
  color: string;
  icon: typeof Users;
}

interface BorrowerSummary {
  id: string;
  borrower_id: string;
  borrower_name: string;
  email: string;
  phone?: string;
  status: string;
  stage: string;
  assigned_to?: string;
  assigned_member_name?: string;
  referred_by?: string;
  referred_by_name?: string;
  created_at: string;
  updated_at: string;
  loan_amount?: number;
  loan_type?: string;
  property_state?: string;
  property_type?: string;
  missing_docs_count: number;
  low_confidence_count: number;
  last_activity?: string;
}

interface TaskItem {
  id: string;
  title: string;
  type: 'review' | 'upload' | 'extraction' | 'expiring';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  borrower_name?: string;
  borrower_id?: string;
  submission_id?: string;
  due_date?: string;
  created_at: string;
}

export function BrokerDashboard() {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const { organization, member, members, isManager } = useTeam();
  const [pipeline, setPipeline] = useState<PipelineStage[]>([]);
  const [borrowers, setBorrowers] = useState<BorrowerSummary[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [assignedFilter, setAssignedFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null);

  const stages: PipelineStage[] = [
    { id: 'documents_uploading', name: 'Documents', count: 0, color: 'bg-blue-500', icon: Upload },
    { id: 'extraction_complete', name: 'Extracted', count: 0, color: 'bg-cyan-500', icon: FileText },
    { id: 'validation', name: 'Validation', count: 0, color: 'bg-amber-500', icon: Eye },
    { id: 'pre_approval_complete', name: 'Pre-Approval', count: 0, color: 'bg-teal-500', icon: Clock },
    { id: 'underwriting', name: 'Underwriting', count: 0, color: 'bg-orange-500', icon: Eye },
    { id: 'approved', name: 'Approved', count: 0, color: 'bg-green-500', icon: CheckCircle },
    { id: 'funded', name: 'Funded', count: 0, color: 'bg-emerald-600', icon: TrendingUp },
  ];

  useEffect(() => {
    if (organization) {
      fetchDashboardData();
    }
  }, [organization, selectedStage, assignedFilter]);

  const fetchDashboardData = async () => {
    if (!organization) return;

    setIsLoading(true);
    try {
      let query = supabase
        .from('intake_submissions')
        .select(`
          id,
          status,
          processing_stage,
          created_at,
          updated_at,
          organization_id,
          borrowers (
            id,
            borrower_name,
            email,
            phone,
            organization_id,
            assigned_member_id,
            referred_by_member_id
          ),
          loan_requests (
            requested_amount,
            loan_purpose
          ),
          properties (
            address_state,
            property_type
          ),
          uploaded_documents (
            id,
            extraction_status,
            extraction_confidence
          )
        `)
        .eq('organization_id', organization.id)
        .not('status', 'eq', 'draft')
        .order('updated_at', { ascending: false });

      const { data: submissions, error } = await query;

      if (error) throw error;

      const summaries: BorrowerSummary[] = (submissions || [])
        .filter(s => s.borrowers)
        .map(s => {
          const b = s.borrowers as any;
          const docs = s.uploaded_documents || [];
          const loanReq = (s.loan_requests as any)?.[0];
          const property = (s.properties as any)?.[0];
          const assignedMember = members.find(m => m.id === b.assigned_member_id);
          const referredMember = members.find(m => m.id === b.referred_by_member_id);

          return {
            id: s.id,
            borrower_id: b.id,
            borrower_name: b.borrower_name || 'Unknown',
            email: b.email || '',
            phone: b.phone,
            status: s.status,
            stage: s.processing_stage || 'new',
            assigned_to: b.assigned_member_id,
            assigned_member_name: assignedMember?.display_name || assignedMember?.email,
            referred_by: b.referred_by_member_id,
            referred_by_name: referredMember?.display_name || referredMember?.email,
            created_at: s.created_at,
            updated_at: s.updated_at,
            loan_amount: loanReq?.requested_amount,
            loan_type: loanReq?.loan_purpose,
            property_state: property?.address_state,
            property_type: property?.property_type,
            missing_docs_count: docs.filter((d: any) => !d.extraction_status || d.extraction_status === 'pending').length,
            low_confidence_count: docs.filter((d: any) => d.extraction_confidence && d.extraction_confidence < 0.7).length,
          };
        });

      setBorrowers(summaries);

      const pipelineCounts = stages.map(stage => ({
        ...stage,
        count: summaries.filter(b => b.stage === stage.id).length,
      }));
      setPipeline(pipelineCounts);

      const taskItems: TaskItem[] = [];

      summaries
        .filter(b => b.low_confidence_count > 0)
        .slice(0, 5)
        .forEach(b => {
          taskItems.push({
            id: `low-conf-${b.id}`,
            title: `${b.low_confidence_count} low confidence extraction(s)`,
            type: 'extraction',
            priority: 'high',
            borrower_name: b.borrower_name,
            borrower_id: b.borrower_id,
            submission_id: b.id,
            created_at: b.updated_at,
          });
        });

      summaries
        .filter(b => b.missing_docs_count > 0)
        .slice(0, 5)
        .forEach(b => {
          taskItems.push({
            id: `missing-${b.id}`,
            title: `${b.missing_docs_count} document(s) need processing`,
            type: 'upload',
            priority: 'normal',
            borrower_name: b.borrower_name,
            borrower_id: b.borrower_id,
            submission_id: b.id,
            created_at: b.updated_at,
          });
        });

      setTasks(taskItems.sort((a, b) => {
        const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }));

    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredBorrowers = borrowers.filter(b => {
    if (selectedStage && b.stage !== selectedStage) return false;
    if (assignedFilter !== 'all') {
      if (assignedFilter === 'unassigned' && b.assigned_to) return false;
      if (assignedFilter === 'mine' && b.assigned_to !== member?.id) return false;
      if (assignedFilter !== 'unassigned' && assignedFilter !== 'mine' && b.assigned_to !== assignedFilter) return false;
    }
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        b.borrower_name.toLowerCase().includes(query) ||
        b.email.toLowerCase().includes(query) ||
        (b.phone && b.phone.includes(query))
      );
    }
    return true;
  });

  const formatCurrency = (amount?: number) => {
    if (!amount) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getStageColor = (stage: string) => {
    const s = stages.find(st => st.id === stage);
    return s?.color || 'bg-gray-500';
  };

  const getPriorityColor = (priority: string) => {
    const colors: Record<string, string> = {
      urgent: 'bg-red-100 text-red-700 border-red-200',
      high: 'bg-orange-100 text-orange-700 border-orange-200',
      normal: 'bg-blue-100 text-blue-700 border-blue-200',
      low: 'bg-gray-100 text-gray-600 border-gray-200',
    };
    return colors[priority] || colors.normal;
  };

  if (selectedSubmissionId) {
    return (
      <BorrowerManagement
        submissionId={selectedSubmissionId}
        onBack={() => {
          setSelectedSubmissionId(null);
          fetchDashboardData();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Broker Dashboard</h1>
          <p className="text-sm text-gray-500">
            {organization?.name} Pipeline Overview
          </p>
        </div>
        <div className="flex items-center gap-3">
          {user && <NotificationCenter userId={user.id} />}
          <button
            onClick={() => navigate({ page: 'placerbot' })}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors"
          >
            <Bot className="w-4 h-4" />
            PlacerBot
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {pipeline.map((stage) => {
          const Icon = stage.icon;
          const isSelected = selectedStage === stage.id;
          return (
            <button
              key={stage.id}
              onClick={() => setSelectedStage(isSelected ? null : stage.id)}
              className={`p-3 rounded-xl border transition-all ${
                isSelected
                  ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className={`w-8 h-8 rounded-lg ${stage.color} flex items-center justify-center mb-2`}>
                <Icon className="w-4 h-4 text-white" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{stage.count}</p>
              <p className="text-xs text-gray-500 truncate">{stage.name}</p>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search borrowers..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-gray-400" />
                  <select
                    value={assignedFilter}
                    onChange={(e) => setAssignedFilter(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="all">All Borrowers</option>
                    <option value="mine">Assigned to Me</option>
                    <option value="unassigned">Unassigned</option>
                    {isManager && members.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.display_name || m.email}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="divide-y divide-gray-200 max-h-[500px] overflow-y-auto">
              {isLoading ? (
                <div className="p-8 text-center text-gray-500">Loading...</div>
              ) : filteredBorrowers.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  No borrowers found
                </div>
              ) : (
                filteredBorrowers.map((b) => (
                  <div
                    key={b.id}
                    onClick={() => setSelectedSubmissionId(b.id)}
                    className="p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-500 to-slate-600 flex items-center justify-center text-white font-medium">
                          {b.borrower_name[0]?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">{b.borrower_name}</span>
                            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStageColor(b.stage)} text-white`}>
                              {stages.find(s => s.id === b.stage)?.name || b.stage}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-sm text-gray-500">
                            {b.loan_type && (
                              <span className="capitalize">{b.loan_type.replace(/_/g, ' ')}</span>
                            )}
                            {b.property_state && (
                              <span>{b.property_state}</span>
                            )}
                            {b.loan_amount && (
                              <span className="font-medium text-gray-700">
                                {formatCurrency(b.loan_amount)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        {(b.missing_docs_count > 0 || b.low_confidence_count > 0) && (
                          <div className="flex items-center gap-2">
                            {b.missing_docs_count > 0 && (
                              <span className="flex items-center gap-1 text-xs text-amber-600">
                                <Upload className="w-3.5 h-3.5" />
                                {b.missing_docs_count}
                              </span>
                            )}
                            {b.low_confidence_count > 0 && (
                              <span className="flex items-center gap-1 text-xs text-red-600">
                                <AlertCircle className="w-3.5 h-3.5" />
                                {b.low_confidence_count}
                              </span>
                            )}
                          </div>
                        )}

                        <div className="text-right text-xs text-gray-500">
                          {b.assigned_member_name && (
                            <p>{b.assigned_member_name}</p>
                          )}
                          {b.referred_by_name && (
                            <p className="text-blue-600">via {b.referred_by_name}</p>
                          )}
                        </div>

                        <ChevronRight className="w-5 h-5 text-gray-400" />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                <span className="font-medium text-gray-700">Action Items</span>
                <span className="ml-auto text-sm text-gray-500">{tasks.length}</span>
              </div>
            </div>

            <div className="divide-y divide-gray-200 max-h-80 overflow-y-auto">
              {tasks.length === 0 ? (
                <div className="p-6 text-center text-gray-500 text-sm">
                  No pending tasks
                </div>
              ) : (
                tasks.map((task) => (
                  <div
                    key={task.id}
                    className="p-3 hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 px-2 py-0.5 text-xs font-medium rounded border ${getPriorityColor(task.priority)}`}>
                        {task.priority}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {task.title}
                        </p>
                        {task.borrower_name && (
                          <p className="text-xs text-gray-500">{task.borrower_name}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="w-5 h-5 text-gray-400" />
              <span className="font-medium text-gray-700">Quick Stats</span>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">New this week</span>
                <span className="font-medium text-gray-900">
                  {borrowers.filter(b => {
                    const weekAgo = new Date();
                    weekAgo.setDate(weekAgo.getDate() - 7);
                    return new Date(b.created_at) > weekAgo;
                  }).length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Pending review</span>
                <span className="font-medium text-gray-900">
                  {borrowers.filter(b => b.low_confidence_count > 0).length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">In underwriting</span>
                <span className="font-medium text-gray-900">
                  {borrowers.filter(b => b.stage === 'underwriting').length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Ready to fund</span>
                <span className="font-medium text-green-600">
                  {borrowers.filter(b => b.stage === 'approved').length}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
