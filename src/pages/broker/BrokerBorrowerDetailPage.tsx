import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  ArrowLeft, User, FileText, DollarSign, Briefcase, MessageSquare,
  Upload, CheckCircle2, Loader2, Send, Trash2, Download, Eye,
  Edit3, Save, X
} from 'lucide-react';

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

type Tab = 'profile' | 'documents' | 'preapprovals' | 'loans' | 'notes';

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
  const [documents, setDocuments] = useState<UploadedDoc[]>([]);
  const [preApprovals, setPreApprovals] = useState<PreApproval[]>([]);
  const [loans, setLoans] = useState<LoanScenario[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [isLoading, setIsLoading] = useState(true);
  const [newNote, setNewNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<Borrower>>({});
  const [uploading, setUploading] = useState(false);

  const loadData = useCallback(async () => {
    if (!borrowerId) return;

    const [bRes, dRes, paRes, lRes, nRes, aRes] = await Promise.all([
      supabase.from('borrowers').select('*').eq('id', borrowerId).maybeSingle(),
      supabase.from('uploaded_documents').select('id, document_type, document_subtype, file_name, file_path, processing_status, created_at').eq('borrower_id', borrowerId).order('created_at', { ascending: false }),
      supabase.from('pre_approvals').select('id, loan_type, prequalified_amount, status, verified_liquidity').eq('borrower_id', borrowerId),
      supabase.from('loan_scenarios').select('id, scenario_name, loan_type, loan_purpose, loan_amount, ltv, status, created_at').eq('borrower_id', borrowerId).order('created_at', { ascending: false }),
      supabase.from('borrower_notes').select('id, content, user_id, created_at').eq('borrower_id', borrowerId).order('created_at', { ascending: false }),
      supabase.from('borrower_activity_log').select('id, event_type, title, details, created_at').eq('borrower_id', borrowerId).order('created_at', { ascending: false }).limit(50),
    ]);

    setBorrower(bRes.data);
    setDocuments(dRes.data || []);
    setPreApprovals(paRes.data || []);
    setLoans(lRes.data || []);
    setNotes(nRes.data || []);
    setActivity(aRes.data || []);
    setIsLoading(false);
  }, [borrowerId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSaveEdit = async () => {
    if (!borrower) return;
    await supabase.from('borrowers').update(editData).eq('id', borrower.id);
    setEditing(false);
    await loadData();
  };

  const handleAddNote = async () => {
    if (!borrower || !newNote.trim() || !user) return;
    await supabase.from('borrower_notes').insert({
      borrower_id: borrower.id,
      user_id: user.id,
      content: newNote.trim(),
    });
    setNewNote('');
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
    await supabase.storage.from('borrower-documents').upload(filePath, file);
    await supabase.from('uploaded_documents').insert({
      borrower_id: borrower.id,
      document_type: 'broker_uploaded',
      file_name: file.name,
      file_path: filePath,
      mime_type: file.type,
      file_size: file.size,
      processing_status: 'uploaded',
    });
    setUploading(false);
    e.target.value = '';
    await loadData();
  };

  const handleViewDoc = async (doc: UploadedDoc) => {
    try {
      const { data, error } = await supabase.storage
        .from('borrower-documents')
        .download(doc.file_path);
      if (error) throw error;
      if (data) {
        const mimeType = doc.file_name.endsWith('.pdf') ? 'application/pdf' :
          doc.file_name.match(/\.(jpg|jpeg)$/i) ? 'image/jpeg' :
          doc.file_name.match(/\.(png)$/i) ? 'image/png' : 'application/octet-stream';
        const blob = new Blob([data], { type: mimeType });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      }
    } catch (err) {
      console.error('View failed:', err);
      alert('Failed to open document. Please try downloading instead.');
    }
  };

  const handleDeleteDoc = async (doc: UploadedDoc) => {
    if (!confirm(`Delete "${doc.file_name}"?`)) return;
    try {
      await supabase.storage.from('borrower-documents').remove([doc.file_path]);
      await supabase.from('uploaded_documents').delete().eq('id', doc.id);
      await loadData();
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete document.');
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
              { label: 'Address', key: 'address_street', value: [borrower.address_street, borrower.address_city, borrower.address_state, borrower.address_zip].filter(Boolean).join(', ') },
            ].map(field => (
              <div key={field.key} className="space-y-1">
                <label className="text-xs font-medium text-gray-500 uppercase">{field.label}</label>
                {editing && field.key !== 'address_street' ? (
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
            <label className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg cursor-pointer transition-colors ${uploading ? 'bg-gray-100 text-gray-400' : 'bg-teal-600 text-white hover:bg-teal-700'}`}>
              <input type="file" onChange={handleDocUpload} className="hidden" />
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Upload Doc
            </label>
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

          {/* Missing Documents */}
          {missingDocs.length > 0 && (
            <div className="border border-amber-200 rounded-xl bg-amber-50 p-5">
              <h3 className="text-sm font-semibold text-amber-800 mb-3">Not Yet Uploaded ({missingDocs.length})</h3>
              <div className="grid grid-cols-2 gap-2">
                {missingDocs.map(doc => (
                  <div key={doc.key} className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg border border-amber-100">
                    <div className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                    <span className="text-sm text-gray-700">{doc.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        );
      })()}

      {activeTab === 'preapprovals' && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">Pre-Approvals</h2>
          {preApprovals.length === 0 ? (
            <div className="border border-gray-200 rounded-xl bg-white p-8 text-center">
              <DollarSign className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No pre-approvals yet</p>
            </div>
          ) : (
            preApprovals.map(pa => (
              <div key={pa.id} className="border border-gray-200 rounded-xl bg-white px-5 py-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">{LOAN_TYPE_LABELS[pa.loan_type || ''] || pa.loan_type}</p>
                  {pa.verified_liquidity && <p className="text-sm text-gray-500">Verified: ${pa.verified_liquidity.toLocaleString()}</p>}
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-teal-700">${pa.prequalified_amount.toLocaleString()}</p>
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">{pa.status}</span>
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
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddNote()}
                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                placeholder="Add a note..."
              />
              <button onClick={handleAddNote} disabled={!newNote.trim()} className="px-4 py-2.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors">
                <Send className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2">
              {notes.map(note => (
                <div key={note.id} className="border border-gray-200 rounded-lg bg-white px-4 py-3">
                  <p className="text-sm text-gray-900">{note.content}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-gray-400">{new Date(note.created_at).toLocaleString()}</span>
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
    </div>
  );
}
