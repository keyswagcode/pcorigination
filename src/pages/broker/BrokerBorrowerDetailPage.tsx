import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  ArrowLeft, User, FileText, DollarSign, Briefcase, MessageSquare,
  Upload, CheckCircle2, Loader2, Send, Trash2, Download, Eye, EyeOff,
  Edit3, Save, X, Plus, Mail, Phone, ExternalLink
} from 'lucide-react';
import { generatePreApprovalPdf } from '../../lib/pdfGenerator';
import { generateStatementsPdf } from '../../lib/statementPdfGenerator';
import { logAudit, getAuditTrail } from '../../services/auditService';
import type { AuditEntry } from '../../services/auditService';

interface Borrower {
  id: string;
  borrower_name: string;
  email: string | null;
  phone: string | null;
  credit_score: number | null;
  entity_type: string;
  state_of_residence: string | null;
  lifecycle_stage: string | null;
  borrower_status: string | null;
  broker_id: string | null;
  date_of_birth: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  ssn_encrypted: string | null;
  ssn_last4: string | null;
  created_at: string;
}

interface UploadedDoc {
  id: string;
  document_type: string;
  document_subtype: string | null;
  file_name: string;
  file_path: string;
  processing_status: string;
  created_at: string;
}

interface PreApproval {
  id: string;
  loan_type: string | null;
  prequalified_amount: number;
  status: string;
  verified_liquidity: number | null;
}

interface LoanScenario {
  id: string;
  scenario_name: string;
  loan_type: string | null;
  loan_purpose: string | null;
  loan_amount: number | null;
  ltv: number | null;
  status: string;
  created_at: string;
}

interface Note {
  id: string;
  content: string;
  user_id: string;
  created_at: string;
  user_name?: string;
}

interface ActivityEntry {
  id: string;
  event_type: string;
  title: string;
  details: string | null;
  created_at: string;
}

interface CoBorrower {
  id: string;
  borrower_name: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  ssn_last4: string | null;
  ssn_encrypted: string | null;
  credit_score: number | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  status: string;
  filled_by_self: boolean;
  created_at: string;
}

type Tab = 'profile' | 'documents' | 'preapprovals' | 'loans' | 'notes' | 'audit';

const LOAN_TYPE_LABELS: Record<string, string> = { dscr: 'DSCR', fix_flip: 'Fix & Flip', bridge: 'Bridge' };
const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600', submitted: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700', declined: 'bg-red-100 text-red-700',
  under_review: 'bg-amber-100 text-amber-700',
};

export function BrokerBorrowerDetailPage() {
  const { borrowerId } = useParams<{ borrowerId: string }>();
  const { user } = useAuth();
  const [borrower, setBorrower] = useState<Borrower | null>(null);
  const [coBorrowers, setCoBorrowers] = useState<CoBorrower[]>([]);
  const [documents, setDocuments] = useState<UploadedDoc[]>([]);
  const [preApprovals, setPreApprovals] = useState<PreApproval[]>([]);
  const [loans, setLoans] = useState<LoanScenario[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [auditTrail, setAuditTrail] = useState<AuditEntry[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [isLoading, setIsLoading] = useState(true);
  const [newNote, setNewNote] = useState('');
  const [mentionSearch, setMentionSearch] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [teamForMentions, setTeamForMentions] = useState<{ id: string; name: string; email: string }[]>([]);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<Borrower>>({});
  const [uploading, setUploading] = useState(false);
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);
  const [uploadingCategory, setUploadingCategory] = useState<string | null>(null);
  const [showGeneratePA, setShowGeneratePA] = useState(false);
  const [paLiquidity, setPaLiquidity] = useState('');
  const [generatingPA, setGeneratingPA] = useState(false);
  const [revealedSSNs, setRevealedSSNs] = useState<Set<string>>(new Set());
  const [plaidReport, setPlaidReport] = useState<Record<string, unknown> | null>(null);
  const [generatingStatements, setGeneratingStatements] = useState(false);

  const toggleSSN = (id: string) => {
    setRevealedSSNs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const formatSSN = (raw: string | null, last4: string | null, revealed: boolean) => {
    if (!revealed) return last4 ? `•••-••-${last4}` : '—';
    const digits = (raw || '').replace(/\D/g, '');
    if (digits.length !== 9) return '—';
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  };

  const loadData = useCallback(async () => {
    if (!borrowerId) return;

    const [bRes, dRes, paRes, lRes, nRes, aRes, cbRes] = await Promise.all([
      supabase.from('borrowers').select('*').eq('id', borrowerId).maybeSingle(),
      supabase.from('uploaded_documents').select('id, document_type, document_subtype, file_name, file_path, processing_status, created_at').eq('borrower_id', borrowerId).order('created_at', { ascending: false }),
      supabase.from('pre_approvals').select('id, loan_type, prequalified_amount, status, verified_liquidity').eq('borrower_id', borrowerId),
      supabase.from('loan_scenarios').select('id, scenario_name, loan_type, loan_purpose, loan_amount, ltv, status, created_at').eq('borrower_id', borrowerId).order('created_at', { ascending: false }),
      supabase.from('borrower_notes').select('id, content, user_id, created_at, user_accounts(first_name, last_name)').eq('borrower_id', borrowerId).order('created_at', { ascending: false }),
      supabase.from('borrower_activity_log').select('id, event_type, title, details, created_at').eq('borrower_id', borrowerId).order('created_at', { ascending: false }).limit(50),
      supabase.from('co_borrowers').select('id, borrower_name, email, phone, date_of_birth, ssn_last4, ssn_encrypted, credit_score, address_street, address_city, address_state, address_zip, status, filled_by_self, created_at').eq('borrower_id', borrowerId).order('created_at', { ascending: true }),
    ]);

    const { data: profile } = await supabase
      .from('borrower_financial_profiles')
      .select('summary')
      .eq('borrower_id', borrowerId)
      .maybeSingle();
    const summary = profile?.summary as Record<string, unknown> | null;
    if (summary?.source === 'plaid_cra_base_report' && summary.report) {
      setPlaidReport(summary.report as Record<string, unknown>);
    } else {
      setPlaidReport(null);
    }

    setBorrower(bRes.data);
    setCoBorrowers(cbRes.data || []);
    setDocuments(dRes.data || []);
    setPreApprovals(paRes.data || []);
    setLoans(lRes.data || []);
    setNotes((nRes.data || []).map((n: Record<string, unknown>) => {
      const ua = n.user_accounts as { first_name: string; last_name: string } | null;
      return { ...n, user_name: ua ? `${ua.first_name || ''} ${ua.last_name || ''}`.trim() : undefined } as Note;
    }));
    setActivity(aRes.data || []);

    // Load audit trail
    const auditData = await getAuditTrail(borrowerId);
    setAuditTrail(auditData);

    // Load team members for @ mentions
    if (user) {
      const { data: orgMember } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (orgMember?.organization_id) {
        const { data: members } = await supabase
          .from('organization_members')
          .select('user_id, display_name, email')
          .eq('organization_id', orgMember.organization_id)
          .eq('is_active', true);
        setTeamForMentions((members || []).map(m => ({
          id: m.user_id,
          name: m.display_name || m.email || '',
          email: m.email || '',
        })));
      }
    }

    setIsLoading(false);
  }, [borrowerId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSaveEdit = async () => {
    if (!borrower || !user) return;
    // Log each changed field
    for (const [key, newVal] of Object.entries(editData)) {
      const oldVal = borrower[key as keyof Borrower];
      if (String(newVal) !== String(oldVal)) {
        await logAudit({
          borrowerId: borrower.id,
          userId: user.id,
          action: 'updated',
          entityType: 'borrower',
          entityId: borrower.id,
          fieldName: key,
          oldValue: String(oldVal ?? ''),
          newValue: String(newVal ?? ''),
        });
      }
    }
    await supabase.from('borrowers').update(editData).eq('id', borrower.id);
    setEditing(false);
    await loadData();
  };

  const handleAddNote = async () => {
    if (!borrower || !newNote.trim() || !user) return;
    const noteText = newNote.trim();

    await supabase.from('borrower_notes').insert({
      borrower_id: borrower.id,
      user_id: user.id,
      content: noteText,
    });

    // Detect @mentions and send notifications
    const mentionPattern = /@(\w[\w\s]*?)(?=\s@|\s*$|[.,!?])/g;
    const mentions = [...noteText.matchAll(mentionPattern)].map(m => m[1].trim().toLowerCase());

    if (mentions.length > 0) {
      const { data: authorData } = await supabase
        .from('user_accounts')
        .select('first_name, last_name')
        .eq('id', user.id)
        .maybeSingle();
      const authorName = authorData ? `${authorData.first_name} ${authorData.last_name}` : 'A team member';

      for (const mentionName of mentions) {
        const mentioned = teamForMentions.find(t =>
          t.name.toLowerCase().includes(mentionName) ||
          t.email.toLowerCase().includes(mentionName)
        );
        if (mentioned && mentioned.id !== user.id) {
          // In-app notification
          await supabase.from('notifications').insert({
            user_id: mentioned.id,
            event_type: 'note_mention',
            title: `${authorName} mentioned you`,
            message: `${authorName} mentioned you in a note on ${borrower.borrower_name}'s file: "${noteText.slice(0, 100)}${noteText.length > 100 ? '...' : ''}"`,
            priority: 'high',
            channel: 'in_app',
            action_url: `/internal/my-borrowers/${borrower.id}`,
            data: { borrower_id: borrower.id, note_content: noteText },
          });

          // Fire webhook for email
          try {
            const { data: orgMember } = await supabase
              .from('organization_members')
              .select('organizations(zapier_webhook_url)')
              .eq('user_id', user.id)
              .maybeSingle();
            const webhookUrl = (orgMember?.organizations as { zapier_webhook_url?: string })?.zapier_webhook_url;
            if (webhookUrl) {
              fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  event_type: 'note_mention',
                  timestamp: new Date().toISOString(),
                  mentioned_user: { name: mentioned.name, email: mentioned.email },
                  author: authorName,
                  borrower: { id: borrower.id, name: borrower.borrower_name },
                  note: noteText,
                }),
              }).catch(() => {});
            }
          } catch { /* best effort */ }
        }
      }
    }

    setNewNote('');
    setShowMentions(false);
    await loadData();
  };

  const handleDeleteNote = async (noteId: string) => {
    await supabase.from('borrower_notes').delete().eq('id', noteId);
    await loadData();
  };

  const handleDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !borrower) return;
    setUploading(true);
    const filePath = `${borrower.id}/broker_upload/${Date.now()}_${file.name}`;
    await supabase.storage.from('borrower-documents').upload(filePath, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
    await supabase.from('uploaded_documents').insert({
      borrower_id: borrower.id,
      document_type: 'broker_uploaded',
      file_name: file.name,
      file_path: filePath,
      mime_type: file.type,
      file_size: file.size,
      processing_status: 'uploaded',
    });
    if (borrower && user) {
      await logAudit({ borrowerId: borrower.id, userId: user.id, action: 'uploaded', entityType: 'document', fieldName: 'file', newValue: file.name });
    }
    setUploading(false);
    e.target.value = '';
    await loadData();
  };

  const handleViewDoc = async (doc: UploadedDoc) => {
    try {
      const { data, error } = await supabase.storage
        .from('borrower-documents')
        .createSignedUrl(doc.file_path, 300);
      if (error || !data?.signedUrl) throw error || new Error('Could not generate URL');
      window.open(data.signedUrl, '_blank', 'noopener');
    } catch (err) {
      console.error('View failed:', err);
      alert('Failed to open document. Please try downloading instead.');
    }
  };

  const handleCategoryUpload = async (category: string, file: File) => {
    if (!borrower) return;
    setUploadingCategory(category);
    try {
      const filePath = `${borrower.id}/${category}/${Date.now()}_${file.name}`;
      await supabase.storage.from('borrower-documents').upload(filePath, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });
      await supabase.from('uploaded_documents').insert({
        borrower_id: borrower.id,
        document_type: category,
        document_subtype: category,
        file_name: file.name,
        file_path: filePath,
        mime_type: file.type,
        file_size: file.size,
        processing_status: 'uploaded',
      });
      await loadData();
    } catch (err) {
      console.error('Upload failed:', err);
      alert('Failed to upload document.');
    } finally {
      setUploadingCategory(null);
    }
  };

  const handleGeneratePreApprovals = async () => {
    if (!borrower || !paLiquidity) return;
    setGeneratingPA(true);
    try {
      const liquidity = parseInt(paLiquidity.replace(/\D/g, '')) || 0;
      if (liquidity <= 0) return;

      // Upsert financial profile
      await supabase.from('borrower_financial_profiles').upsert({
        borrower_id: borrower.id,
        liquidity_estimate: liquidity,
        confidence_score: 100,
        summary: { source: 'broker_manual', total_liquidity: liquidity, verified_at: new Date().toISOString() },
      }, { onConflict: 'borrower_id' });

      // Delete old pre-approvals
      await supabase.from('pre_approvals').delete().eq('borrower_id', borrower.id);

      // Generate new ones
      await supabase.from('pre_approvals').insert([
        { borrower_id: borrower.id, loan_type: 'dscr', status: 'approved', sub_status: 'pre_approved', prequalified_amount: liquidity * 4, qualification_max: liquidity * 4, verified_liquidity: liquidity, passes_liquidity_check: true, summary: `DSCR Loan: Up to $${(liquidity * 4).toLocaleString()}`, machine_decision: 'approved', machine_confidence: 100 },
        { borrower_id: borrower.id, loan_type: 'fix_flip', status: 'approved', sub_status: 'pre_approved', prequalified_amount: liquidity * 10, qualification_max: liquidity * 10, verified_liquidity: liquidity, passes_liquidity_check: true, summary: `Fix & Flip: Up to $${(liquidity * 10).toLocaleString()}`, machine_decision: 'approved', machine_confidence: 100 },
        { borrower_id: borrower.id, loan_type: 'bridge', status: 'approved', sub_status: 'pre_approved', prequalified_amount: liquidity * 5, qualification_max: liquidity * 5, verified_liquidity: liquidity, passes_liquidity_check: true, summary: `Bridge: Up to $${(liquidity * 5).toLocaleString()}`, machine_decision: 'approved', machine_confidence: 100 },
      ]);

      // Update borrower status
      await supabase.from('borrowers').update({ lifecycle_stage: 'pre_approved', borrower_status: 'prequalified' }).eq('id', borrower.id);

      setShowGeneratePA(false);
      setPaLiquidity('');
      await loadData();
    } catch (err) {
      console.error('Generate failed:', err);
      alert('Failed to generate pre-approvals.');
    } finally {
      setGeneratingPA(false);
    }
  };

  const handleDownloadPreApprovalPdf = async (pa: PreApproval) => {
    if (!borrower || !user) return;
    try {
      const { data: brokerData } = await supabase
        .from('user_accounts')
        .select('first_name, last_name, email, phone')
        .eq('id', user.id)
        .maybeSingle();

      let orgName = 'Key Real Estate Capital';
      let orgLogoUrl: string | null = null;
      const { data: orgMember } = await supabase
        .from('organization_members')
        .select('organizations(name, logo_url)')
        .eq('user_id', user.id)
        .maybeSingle();
      if (orgMember?.organizations) {
        const org = orgMember.organizations as unknown as { name: string; logo_url: string | null };
        orgName = org.name || orgName;
        orgLogoUrl = org.logo_url || null;
      }

      const today = new Date();
      const expiry = new Date(today);
      expiry.setDate(expiry.getDate() + 90);
      const brokerName = brokerData ? [brokerData.first_name, brokerData.last_name].filter(Boolean).join(' ') : 'Broker';

      await generatePreApprovalPdf({
        orgName,
        orgLogoUrl,
        borrowerName: borrower.borrower_name,
        llcName: (borrower as Record<string, unknown>).llc_name as string || null,
        preApprovalAmount: pa.prequalified_amount,
        loanType: pa.loan_type || 'dscr',
        loanPurpose: 'purchase',
        occupancy: 'Investment',
        propertyType: 'SFR',
        verifiedLiquidity: pa.verified_liquidity || 0,
        creditScore: borrower.credit_score,
        expirationDate: expiry.toLocaleDateString(),
        brokerName,
        brokerEmail: brokerData?.email || null,
        brokerPhone: brokerData?.phone || null,
        issueDate: today.toLocaleDateString(),
        conditions: [],
      });
    } catch (err) {
      console.error('PDF failed:', err);
      alert('Failed to generate PDF.');
    }
  };

  const handleDeleteDoc = async (doc: UploadedDoc) => {
    if (!confirm(`Delete "${doc.file_name}"?`)) return;
    try {
      await supabase.storage.from('borrower-documents').remove([doc.file_path]);
      await supabase.from('uploaded_documents').delete().eq('id', doc.id);
      if (borrower && user) {
        await logAudit({ borrowerId: borrower.id, userId: user.id, action: 'deleted', entityType: 'document', entityId: doc.id, fieldName: 'file', oldValue: doc.file_name, newValue: '' });
      }
      await loadData();
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete document.');
    }
  };

  const handleDownloadStatements = async () => {
    if (!plaidReport || !borrower) return;
    setGeneratingStatements(true);
    try {
      let orgName = 'Key Real Estate Capital';
      if (user) {
        const { data: orgMember } = await supabase
          .from('organization_members')
          .select('organizations(name)')
          .eq('user_id', user.id)
          .maybeSingle();
        const org = orgMember?.organizations as unknown as { name?: string } | null;
        if (org?.name) orgName = org.name;
      }
      generateStatementsPdf(plaidReport as Parameters<typeof generateStatementsPdf>[0], {
        borrowerName: borrower.borrower_name,
        orgName,
        monthsToCover: 2,
      });
    } catch (err) {
      console.error('Failed to generate statements:', err);
      alert('Failed to generate bank statements.');
    } finally {
      setGeneratingStatements(false);
    }
  };

  const handleDownloadDoc = async (doc: UploadedDoc) => {
    try {
      const { data, error } = await supabase.storage
        .from('borrower-documents')
        .download(doc.file_path);
      if (error) throw error;
      if (data) {
        const url = URL.createObjectURL(data);
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.file_name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Download failed:', err);
      alert('Failed to download document.');
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-teal-600 animate-spin" /></div>;
  }

  if (!borrower) {
    return <div className="text-center py-20"><p className="text-gray-500">Borrower not found</p></div>;
  }

  const tabs: { key: Tab; label: string; icon: typeof User; count?: number }[] = [
    { key: 'profile', label: 'Profile', icon: User },
    { key: 'documents', label: 'Documents', icon: FileText, count: documents.length },
    { key: 'preapprovals', label: 'Pre-Approvals', icon: DollarSign, count: preApprovals.length },
    { key: 'loans', label: 'Loans', icon: Briefcase, count: loans.length },
    { key: 'notes', label: 'Notes & Activity', icon: MessageSquare, count: notes.length },
    { key: 'audit', label: 'Audit Trail', icon: FileText, count: auditTrail.length },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/internal/my-borrowers" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold text-gray-900">{borrower.borrower_name}</h1>
          <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
            <span>{borrower.email}</span>
            {borrower.phone && <span>{borrower.phone}</span>}
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[borrower.borrower_status || 'draft'] || 'bg-gray-100 text-gray-600'}`}>
              {borrower.borrower_status || 'Draft'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {borrower.email && (
            <a href={`mailto:${borrower.email}`}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              title={`Email ${borrower.borrower_name}`}>
              <Mail className="w-4 h-4" /> Email
            </a>
          )}
          {borrower.phone && (
            <a href={`sms:${borrower.phone}`}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              title={`Text ${borrower.borrower_name}`}>
              <Phone className="w-4 h-4" /> Text
            </a>
          )}
          {plaidReport && (
            <button
              onClick={handleDownloadStatements}
              disabled={generatingStatements}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors disabled:opacity-50"
              title="Download last 2 months of bank statements from verified Plaid data"
            >
              {generatingStatements ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Bank Statements
            </button>
          )}
          <a href="https://keyrealestatecapital.com/calculator" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors"
            title="Pricing Calculator">
            <ExternalLink className="w-4 h-4" /> Calculator
          </a>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 flex gap-1">
        {tabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-teal-600 text-teal-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="ml-1 px-1.5 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">{tab.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === 'profile' && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Borrower Profile</h2>
            {!editing ? (
              <button onClick={() => { setEditing(true); setEditData(borrower); }} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100">
                <Edit3 className="w-4 h-4" /> Edit
              </button>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => setEditing(false)} className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"><X className="w-4 h-4" /> Cancel</button>
                <button onClick={handleSaveEdit} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700"><Save className="w-4 h-4" /> Save</button>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Full Name', key: 'borrower_name', value: borrower.borrower_name },
              { label: 'Email', key: 'email', value: borrower.email },
              { label: 'Phone', key: 'phone', value: borrower.phone },
              { label: 'Credit Score', key: 'credit_score', value: borrower.credit_score },
              { label: 'Entity Type', key: 'entity_type', value: borrower.entity_type },
              { label: 'State', key: 'state_of_residence', value: borrower.state_of_residence },
              { label: 'Date of Birth', key: 'date_of_birth', value: borrower.date_of_birth },
            ].map(field => (
              <div key={field.key} className="space-y-1">
                <label className="text-xs font-medium text-gray-500 uppercase">{field.label}</label>
                {editing ? (
                  <input
                    type="text"
                    value={String(editData[field.key as keyof Borrower] ?? field.value ?? '')}
                    onChange={e => setEditData({ ...editData, [field.key]: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                ) : (
                  <p className="text-sm text-gray-900">{String(field.value || '—')}</p>
                )}
              </div>
            ))}
          </div>
          {/* Residential Address */}
          <div className="mt-4 pt-4 border-t border-gray-100">
            <label className="text-xs font-medium text-gray-500 uppercase mb-2 block">Residential Address</label>
            {editing ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <input
                    type="text"
                    placeholder="Street address"
                    value={String(editData.address_street ?? borrower.address_street ?? '')}
                    onChange={e => setEditData({ ...editData, address_street: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
                <div>
                  <input
                    type="text"
                    placeholder="City"
                    value={String(editData.address_city ?? borrower.address_city ?? '')}
                    onChange={e => setEditData({ ...editData, address_city: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="State"
                    maxLength={2}
                    value={String(editData.address_state ?? borrower.address_state ?? '')}
                    onChange={e => setEditData({ ...editData, address_state: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                  <input
                    type="text"
                    placeholder="ZIP"
                    maxLength={5}
                    value={String(editData.address_zip ?? borrower.address_zip ?? '')}
                    onChange={e => setEditData({ ...editData, address_zip: e.target.value.replace(/\D/g, '').slice(0, 5) })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-900">
                {[borrower.address_street, borrower.address_city, borrower.address_state, borrower.address_zip].filter(Boolean).join(', ') || '—'}
              </p>
            )}
          </div>

          {/* SSN */}
          <div className="mt-4 pt-4 border-t border-gray-100">
            <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">SSN</label>
            <div className="flex items-center gap-2">
              <p className="text-sm text-gray-900 font-mono">
                {formatSSN(borrower.ssn_encrypted, borrower.ssn_last4, revealedSSNs.has(borrower.id))}
              </p>
              {borrower.ssn_encrypted && (
                <button
                  onClick={() => toggleSSN(borrower.id)}
                  className="p-1 text-gray-400 hover:text-teal-600 transition-colors"
                  title={revealedSSNs.has(borrower.id) ? 'Hide SSN' : 'Show SSN'}
                >
                  {revealedSSNs.has(borrower.id) ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              )}
            </div>
          </div>

          {/* Co-Borrowers */}
          <div className="mt-6 pt-6 border-t border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Co-Borrowers ({coBorrowers.length})</h3>
            {coBorrowers.length === 0 ? (
              <p className="text-sm text-gray-500">No co-borrowers added</p>
            ) : (
              <div className="space-y-3">
                {coBorrowers.map(cb => {
                  const statusColor = cb.status === 'completed'
                    ? 'bg-teal-100 text-teal-700'
                    : cb.status === 'invited'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-gray-100 text-gray-700';
                  const statusLabel = cb.status === 'completed' ? 'Completed' : cb.status === 'invited' ? 'Invited' : cb.status;
                  const address = [cb.address_street, cb.address_city, cb.address_state, cb.address_zip].filter(Boolean).join(', ');
                  return (
                    <div key={cb.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{cb.borrower_name || '—'}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {cb.filled_by_self ? 'Completed by co-borrower' : 'Entered by primary borrower'}
                          </p>
                        </div>
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColor}`}>{statusLabel}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                        <div>
                          <div className="text-xs text-gray-500 uppercase">Email</div>
                          <div className="text-gray-900">{cb.email || '—'}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 uppercase">Phone</div>
                          <div className="text-gray-900">{cb.phone || '—'}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 uppercase">Date of Birth</div>
                          <div className="text-gray-900">{cb.date_of_birth || '—'}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 uppercase">Credit Score</div>
                          <div className="text-gray-900">{cb.credit_score ?? '—'}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 uppercase">SSN</div>
                          <div className="flex items-center gap-2">
                            <span className="text-gray-900 font-mono">
                              {formatSSN(cb.ssn_encrypted, cb.ssn_last4, revealedSSNs.has(cb.id))}
                            </span>
                            {cb.ssn_encrypted && (
                              <button
                                onClick={() => toggleSSN(cb.id)}
                                className="p-1 text-gray-400 hover:text-teal-600 transition-colors"
                                title={revealedSSNs.has(cb.id) ? 'Hide SSN' : 'Show SSN'}
                              >
                                {revealedSSNs.has(cb.id) ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="col-span-2">
                          <div className="text-xs text-gray-500 uppercase">Address</div>
                          <div className="text-gray-900">{address || '—'}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'documents' && (() => {
        const allCategories = [
          { key: 'drivers_license', label: "Driver's License / Passport" },
          { key: 'voided_check', label: 'Voided Check' },
          { key: 'property_insurance', label: 'Property Insurance' },
          { key: 'appraisal', label: 'Appraisal' },
          { key: 'lease', label: 'Lease' },
          { key: 'articles_of_incorporation', label: 'Articles of Incorporation' },
          { key: 'ein_letter', label: 'EIN Letter' },
          { key: 'operating_agreement', label: 'Operating Agreement' },
          { key: 'rehab_budget', label: 'Rehab Budget' },
          { key: 'flip_experience', label: 'Flip Experience Sheet' },
        ];

        const uploadedTypes = new Set(documents.map(d => d.document_type));
        const missingDocs = allCategories.filter(c => !uploadedTypes.has(c.key));

        return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Documents</h2>
            <div className="flex items-center gap-2">
              {plaidReport && (
                <button
                  onClick={handleDownloadStatements}
                  disabled={generatingStatements}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors disabled:opacity-50"
                  title="Download last 2 months of bank statements (Plaid verified)"
                >
                  {generatingStatements ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  Download Bank Statements
                </button>
              )}
              {borrower.email && (() => {
                const portalUrl = `${window.location.origin}/application/documents`;
                const body = `Hi ${(borrower.borrower_name || '').split(' ')[0] || 'there'},\n\nPlease sign in to your borrower portal and upload the following documents:\n\n- \n- \n- \n\nLink: ${portalUrl}\n\nThanks!`;
                const mailto = `mailto:${borrower.email}?subject=${encodeURIComponent('Request for Additional Docs')}&body=${encodeURIComponent(body)}`;
                return (
                  <a
                    href={mailto}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors"
                    title="Open your mail app to email the borrower"
                  >
                    <Send className="w-4 h-4" />
                    Request Documents
                  </a>
                );
              })()}
              <label className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg cursor-pointer transition-colors ${uploading ? 'bg-gray-100 text-gray-400' : 'bg-teal-600 text-white hover:bg-teal-700'}`}>
                <input type="file" onChange={handleDocUpload} className="hidden" />
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Upload Doc
              </label>
            </div>
          </div>

          {documents.length === 0 ? (
            <div className="border border-gray-200 rounded-xl bg-white p-8 text-center">
              <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No documents uploaded</p>
            </div>
          ) : (
            <div className="border border-gray-200 rounded-xl bg-white divide-y divide-gray-100">
              {documents.map(doc => (
                <div key={doc.id} className="px-5 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-gray-400" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{doc.file_name}</p>
                      <p className="text-xs text-gray-500">
                        {doc.document_type.replace(/_/g, ' ')} &middot; {new Date(doc.created_at).toLocaleDateString()}
                        <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${
                          doc.processing_status === 'completed' || doc.processing_status === 'uploaded'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}>
                          {doc.processing_status}
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleViewDoc(doc)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                      title="View document"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      View
                    </button>
                    <button
                      onClick={() => handleDownloadDoc(doc)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-50 rounded-lg transition-colors"
                      title="Download document"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download
                    </button>
                    <button
                      onClick={() => handleDeleteDoc(doc)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete document"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Missing Documents - drag & drop or click to upload */}
          {missingDocs.length > 0 && (
            <div className="border border-amber-200 rounded-xl bg-amber-50 p-5">
              <h3 className="text-sm font-semibold text-amber-800 mb-3">Not Yet Uploaded ({missingDocs.length}) — drag & drop or click to upload</h3>
              <div className="grid grid-cols-2 gap-2">
                {missingDocs.map(cat => {
                  const isDragging = dragOverCategory === cat.key;
                  const isUploading = uploadingCategory === cat.key;
                  return (
                    <label
                      key={cat.key}
                      className={`flex items-center gap-2 px-3 py-3 rounded-lg border-2 border-dashed cursor-pointer transition-all ${
                        isDragging
                          ? 'border-teal-500 bg-teal-50'
                          : isUploading
                            ? 'border-gray-300 bg-gray-50 opacity-60'
                            : 'border-amber-200 bg-white hover:border-teal-400 hover:bg-teal-50/50'
                      }`}
                      onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverCategory(cat.key); }}
                      onDragEnter={e => { e.preventDefault(); e.stopPropagation(); setDragOverCategory(cat.key); }}
                      onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setDragOverCategory(null); }}
                      onDrop={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDragOverCategory(null);
                        const file = e.dataTransfer.files?.[0];
                        if (file) handleCategoryUpload(cat.key, file);
                      }}
                    >
                      <input
                        type="file"
                        className="hidden"
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (file) handleCategoryUpload(cat.key, file);
                          e.target.value = '';
                        }}
                      />
                      {isUploading ? (
                        <Loader2 className="w-4 h-4 text-teal-600 animate-spin flex-shrink-0" />
                      ) : isDragging ? (
                        <Download className="w-4 h-4 text-teal-600 flex-shrink-0" />
                      ) : (
                        <Upload className="w-4 h-4 text-amber-400 flex-shrink-0" />
                      )}
                      <span className={`text-sm ${isDragging ? 'text-teal-700 font-medium' : 'text-gray-700'}`}>
                        {isDragging ? 'Drop here' : isUploading ? 'Uploading...' : cat.label}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        );
      })()}

      {activeTab === 'preapprovals' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Pre-Approvals</h2>
            {!showGeneratePA && (
              <button
                onClick={() => setShowGeneratePA(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Generate Pre-Approval
              </button>
            )}
          </div>

          {/* Generate form */}
          {showGeneratePA && (
            <div className="border border-teal-200 rounded-xl bg-teal-50 p-5 space-y-3">
              <h3 className="text-sm font-semibold text-teal-800">Generate Pre-Approvals</h3>
              <p className="text-xs text-teal-700">Enter the verified liquidity amount. Pre-approvals will be generated at: DSCR (4x), Fix & Flip (10x), Bridge (5x).</p>
              <div>
                <label className="block text-xs font-medium text-teal-800 mb-1">Verified Liquidity Amount *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                  <input
                    type="text"
                    value={paLiquidity}
                    onChange={e => {
                      const num = e.target.value.replace(/\D/g, '');
                      setPaLiquidity(num ? parseInt(num).toLocaleString() : '');
                    }}
                    className="w-full pl-7 pr-4 py-2.5 border border-teal-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 bg-white"
                    placeholder="200,000"
                  />
                </div>
              </div>
              {paLiquidity && (
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="bg-white rounded-lg px-3 py-2 border border-teal-100">
                    <p className="text-gray-500">DSCR (4x)</p>
                    <p className="font-semibold text-gray-900">${((parseInt(paLiquidity.replace(/\D/g, '')) || 0) * 4).toLocaleString()}</p>
                  </div>
                  <div className="bg-white rounded-lg px-3 py-2 border border-teal-100">
                    <p className="text-gray-500">Fix & Flip (10x)</p>
                    <p className="font-semibold text-gray-900">${((parseInt(paLiquidity.replace(/\D/g, '')) || 0) * 10).toLocaleString()}</p>
                  </div>
                  <div className="bg-white rounded-lg px-3 py-2 border border-teal-100">
                    <p className="text-gray-500">Bridge (5x)</p>
                    <p className="font-semibold text-gray-900">${((parseInt(paLiquidity.replace(/\D/g, '')) || 0) * 5).toLocaleString()}</p>
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => { setShowGeneratePA(false); setPaLiquidity(''); }}
                  className="px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
                <button onClick={handleGeneratePreApprovals} disabled={generatingPA || !paLiquidity}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors">
                  {generatingPA ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Generate
                </button>
              </div>
            </div>
          )}

          {preApprovals.length === 0 && !showGeneratePA ? (
            <div className="border border-gray-200 rounded-xl bg-white p-8 text-center">
              <DollarSign className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No pre-approvals yet</p>
              <button
                onClick={() => setShowGeneratePA(true)}
                className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100"
              >
                <Plus className="w-4 h-4" /> Generate Pre-Approval
              </button>
            </div>
          ) : (
            preApprovals.map(pa => (
              <div key={pa.id} className="border border-gray-200 rounded-xl bg-white px-5 py-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="font-medium text-gray-900">{LOAN_TYPE_LABELS[pa.loan_type || ''] || pa.loan_type}</p>
                    {pa.verified_liquidity && <p className="text-sm text-gray-500">Verified liquidity: ${pa.verified_liquidity.toLocaleString()} &middot; Max: ${pa.prequalified_amount.toLocaleString()}</p>}
                  </div>
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">{pa.status}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Pre-Approval Amount</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                      <input
                        type="text"
                        defaultValue={pa.prequalified_amount.toLocaleString()}
                        onBlur={async (e) => {
                          const val = parseInt(e.target.value.replace(/\D/g, '')) || 0;
                          if (val > 0 && val !== pa.prequalified_amount) {
                            await supabase.from('pre_approvals').update({ prequalified_amount: val }).eq('id', pa.id);
                            await loadData();
                          }
                        }}
                        onChange={(e) => {
                          const num = e.target.value.replace(/\D/g, '');
                          e.target.value = num ? parseInt(num).toLocaleString() : '';
                        }}
                        className="w-full pl-7 pr-3 py-2 border border-gray-200 rounded-lg text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => handleDownloadPreApprovalPdf({ ...pa, prequalified_amount: pa.prequalified_amount })}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors"
                    title="Download Pre-Approval PDF"
                  >
                    <Download className="w-4 h-4" />
                    PDF
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'loans' && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Loan Scenarios</h2>
          {loans.length === 0 ? (
            <div className="border border-gray-200 rounded-xl bg-white p-8 text-center">
              <Briefcase className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No loans submitted</p>
            </div>
          ) : (
            loans.map(loan => (
              <div key={loan.id} className="border border-gray-200 rounded-xl bg-white px-5 py-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">{loan.scenario_name}</p>
                  <p className="text-sm text-gray-500">{LOAN_TYPE_LABELS[loan.loan_type || ''] || loan.loan_type} &middot; {loan.loan_purpose}</p>
                </div>
                <div className="flex items-center gap-4">
                  {loan.loan_amount && <p className="text-lg font-semibold text-gray-900">${loan.loan_amount.toLocaleString()}</p>}
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[loan.status] || 'bg-gray-100 text-gray-600'}`}>{loan.status}</span>
                  {loan.status === 'submitted' && (
                    <Link to={`/internal/loans/${loan.id}/review`} className="px-3 py-1.5 text-xs font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700">Review</Link>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'notes' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Notes */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Internal Notes</h2>
            <div className="relative mb-4">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={newNote}
                    onChange={e => {
                      setNewNote(e.target.value);
                      const atMatch = e.target.value.match(/@(\w*)$/);
                      if (atMatch) {
                        setMentionSearch(atMatch[1].toLowerCase());
                        setShowMentions(true);
                      } else {
                        setShowMentions(false);
                      }
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !showMentions) handleAddNote();
                      if (e.key === 'Escape') setShowMentions(false);
                    }}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                    placeholder="Add a note... Use @ to mention a team member"
                  />
                  {/* @ mention dropdown */}
                  {showMentions && (
                    <div className="absolute bottom-full mb-1 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
                      {teamForMentions
                        .filter(t => !mentionSearch || t.name.toLowerCase().includes(mentionSearch) || t.email.toLowerCase().includes(mentionSearch))
                        .map(member => (
                          <button
                            key={member.id}
                            className="w-full text-left px-4 py-2 text-sm hover:bg-teal-50 transition-colors flex items-center gap-2"
                            onClick={() => {
                              const beforeAt = newNote.replace(/@\w*$/, '');
                              setNewNote(`${beforeAt}@${member.name} `);
                              setShowMentions(false);
                            }}
                          >
                            <div className="w-6 h-6 bg-teal-100 rounded-full flex items-center justify-center text-xs font-medium text-teal-700">
                              {member.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-gray-900">{member.name}</p>
                              <p className="text-xs text-gray-500">{member.email}</p>
                            </div>
                          </button>
                        ))}
                      {teamForMentions.filter(t => !mentionSearch || t.name.toLowerCase().includes(mentionSearch)).length === 0 && (
                        <p className="px-4 py-2 text-xs text-gray-400">No team members found</p>
                      )}
                    </div>
                  )}
                </div>
                <button onClick={handleAddNote} disabled={!newNote.trim()} className="px-4 py-2.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {notes.map(note => (
                <div key={note.id} className="border border-gray-200 rounded-lg bg-white px-4 py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-5 h-5 bg-teal-100 rounded-full flex items-center justify-center">
                      <span className="text-[10px] font-medium text-teal-700">
                        {(note.user_name || '?').split(' ').map(n => n[0]).join('').slice(0, 2)}
                      </span>
                    </div>
                    <span className="text-xs font-medium text-gray-700">{note.user_name || 'Unknown'}</span>
                    <span className="text-xs text-gray-400">&middot; {new Date(note.created_at).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-gray-900">
                    {note.content.split(/(@\w[\w\s]*?)(?=\s@|\s*$|[.,!?])/).map((part, i) =>
                      part.startsWith('@') ? <span key={i} className="text-teal-600 font-medium">{part}</span> : part
                    )}
                  </p>
                  <div className="flex justify-end mt-1">
                    {note.user_id === user?.id && (
                      <button onClick={() => handleDeleteNote(note.id)} className="text-gray-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                </div>
              ))}
              {notes.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No notes yet</p>}
            </div>
          </div>

          {/* Activity Timeline */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Activity Timeline</h2>
            <div className="space-y-3">
              {activity.map(entry => (
                <div key={entry.id} className="flex gap-3">
                  <div className="w-2 h-2 bg-teal-400 rounded-full mt-2 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-gray-900">{entry.title}</p>
                    {entry.details && <p className="text-xs text-gray-500">{entry.details}</p>}
                    <p className="text-xs text-gray-400 mt-0.5">{new Date(entry.created_at).toLocaleString()}</p>
                  </div>
                </div>
              ))}
              {activity.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No activity recorded</p>}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'audit' && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Audit Trail</h2>
          {auditTrail.length === 0 ? (
            <div className="border border-gray-200 rounded-xl bg-white p-8 text-center">
              <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No audit history yet</p>
            </div>
          ) : (
            <div className="border border-gray-200 rounded-xl bg-white divide-y divide-gray-100">
              {auditTrail.map(entry => (
                <div key={entry.id} className="px-5 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        entry.action === 'created' ? 'bg-green-400' :
                        entry.action === 'updated' ? 'bg-blue-400' :
                        entry.action === 'deleted' ? 'bg-red-400' :
                        entry.action === 'uploaded' ? 'bg-teal-400' :
                        'bg-gray-400'
                      }`} />
                      <span className="text-sm text-gray-900">
                        <span className="font-medium">{entry.user_name || 'System'}</span>
                        {' '}
                        <span className="text-gray-500">{entry.action}</span>
                        {' '}
                        <span className="text-gray-700">{entry.entity_type}</span>
                        {entry.field_name && (
                          <span className="text-gray-500"> &middot; {entry.field_name.replace(/_/g, ' ')}</span>
                        )}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">{new Date(entry.created_at).toLocaleString()}</span>
                  </div>
                  {(entry.old_value || entry.new_value) && (
                    <div className="mt-1 ml-4 flex items-center gap-2 text-xs">
                      {entry.old_value && (
                        <span className="px-2 py-0.5 bg-red-50 text-red-600 rounded line-through">{entry.old_value.slice(0, 50)}</span>
                      )}
                      {entry.old_value && entry.new_value && <span className="text-gray-400">→</span>}
                      {entry.new_value && (
                        <span className="px-2 py-0.5 bg-green-50 text-green-700 rounded">{entry.new_value.slice(0, 50)}</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
