import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useTeam } from '../../components/team/TeamContext';
import { Users, Search, Loader2, ArrowRight, Plus, Upload, X, Download, CheckCircle2, AlertCircle } from 'lucide-react';
import type { OrganizationMember } from '../../shared/types';

function getVisibleBrokerIds(member: OrganizationMember, members: OrganizationMember[]): string[] {
  const role = member.role;
  if (role === 'owner' || role === 'admin') {
    return members.map(m => m.user_id);
  }
  if (role === 'vp') {
    const inviteeIds = members
      .filter(m => m.invited_by_user_id === member.user_id)
      .map(m => m.user_id);
    return [member.user_id, ...inviteeIds];
  }
  return [member.user_id];
}

interface BorrowerRow {
  id: string;
  borrower_name: string;
  email: string | null;
  credit_score: number | null;
  lifecycle_stage: string | null;
  borrower_status: string | null;
  created_at: string;
  updated_at: string;
  loan_count?: number;
}

const STAGE_LABELS: Record<string, string> = {
  profile_created: 'New',
  documents_uploaded: 'Docs Uploaded',
  liquidity_verified: 'Liquidity Verified',
  pre_approved: 'Pre-Approved',
  application_submitted: 'App Submitted',
};

const STAGE_COLORS: Record<string, string> = {
  profile_created: 'bg-gray-100 text-gray-600',
  documents_uploaded: 'bg-blue-100 text-blue-700',
  liquidity_verified: 'bg-cyan-100 text-cyan-700',
  pre_approved: 'bg-teal-100 text-teal-700',
  application_submitted: 'bg-green-100 text-green-700',
};

export function BrokerBorrowersPage() {
  const { user, userAccount } = useAuth();
  const { member, members } = useTeam();
  const [borrowers, setBorrowers] = useState<BorrowerRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('all');

  // Manual add
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addCreditScore, setAddCreditScore] = useState('');
  const [addEntityType, setAddEntityType] = useState('individual');
  const [addDob, setAddDob] = useState('');
  const [addStreet, setAddStreet] = useState('');
  const [addCity, setAddCity] = useState('');
  const [addState, setAddState] = useState('');
  const [addZip, setAddZip] = useState('');
  const [adding, setAdding] = useState(false);

  const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

  // CSV upload
  const [showCsvUpload, setShowCsvUpload] = useState(false);
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvResult, setCsvResult] = useState<{ success: number; failed: number } | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);

  async function loadData() {
    if (!user) return;
    const isAdminLike = userAccount?.user_role === 'admin'
      || member?.role === 'admin'
      || member?.role === 'owner';

    let query = supabase
      .from('borrowers')
      .select('id, borrower_name, email, credit_score, lifecycle_stage, borrower_status, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (!isAdminLike) {
      if (!member) return;
      const visibleBrokerIds = getVisibleBrokerIds(member, members);
      query = query.in('broker_id', visibleBrokerIds);
    }

    const { data } = await query;
    setBorrowers(data || []);
    setIsLoading(false);
  }

  useEffect(() => { loadData(); }, [user, userAccount, member, members]);

  const handleAddBorrower = async () => {
    if (!user || !addName) return;
    setAdding(true);
    try {
      const { error } = await supabase.from('borrowers').insert({
        broker_id: user.id,
        borrower_name: addName,
        email: addEmail || null,
        phone: addPhone.replace(/\D/g, '') || null,
        credit_score: addCreditScore ? parseInt(addCreditScore) : null,
        entity_type: addEntityType,
        date_of_birth: addDob || null,
        address_street: addStreet || null,
        address_city: addCity || null,
        address_state: addState || null,
        address_zip: addZip || null,
        state_of_residence: addState || null,
        borrower_status: 'draft',
        lifecycle_stage: 'profile_created',
      });
      if (error) throw error;
      setAddName(''); setAddEmail(''); setAddPhone(''); setAddCreditScore('');
      setAddEntityType('individual'); setAddDob(''); setAddStreet(''); setAddCity(''); setAddState(''); setAddZip('');
      setShowAddForm(false);
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add borrower');
    } finally {
      setAdding(false);
    }
  };

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setCsvUploading(true);
    setCsvResult(null);
    setCsvError(null);

    try {
      const text = await file.text();
      const lines = text.split('\n').map(l => l.trim()).filter(l => l);
      if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');

      const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
      const nameIdx = header.findIndex(h => h.includes('name'));
      const emailIdx = header.findIndex(h => h.includes('email'));
      const phoneIdx = header.findIndex(h => h.includes('phone'));
      const creditIdx = header.findIndex(h => h.includes('credit'));
      const entityIdx = header.findIndex(h => h.includes('entity') || h.includes('type'));

      if (nameIdx === -1) throw new Error('CSV must have a "name" column');

      let success = 0;
      let failed = 0;

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
        const name = cols[nameIdx];
        if (!name) { failed++; continue; }

        const { error } = await supabase.from('borrowers').insert({
          broker_id: user.id,
          borrower_name: name,
          email: emailIdx >= 0 ? cols[emailIdx] || null : null,
          phone: phoneIdx >= 0 ? (cols[phoneIdx] || '').replace(/\D/g, '') || null : null,
          credit_score: creditIdx >= 0 && cols[creditIdx] ? parseInt(cols[creditIdx]) || null : null,
          entity_type: entityIdx >= 0 ? cols[entityIdx] || 'individual' : 'individual',
          borrower_status: 'draft',
          lifecycle_stage: 'profile_created',
        });

        if (error) { failed++; } else { success++; }
      }

      setCsvResult({ success, failed });
      await loadData();
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : 'CSV upload failed');
    } finally {
      setCsvUploading(false);
      e.target.value = '';
    }
  };

  const downloadCsvTemplate = () => {
    const csv = 'Name,Email,Phone,Credit Score,Entity Type\nJohn Doe,john@email.com,(555) 123-4567,720,individual\nSmith LLC,contact@smith.com,(555) 987-6543,750,llc\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'borrowers-template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = borrowers.filter(b => {
    if (search) {
      const q = search.toLowerCase();
      if (!b.borrower_name.toLowerCase().includes(q) && !(b.email || '').toLowerCase().includes(q)) return false;
    }
    if (stageFilter !== 'all' && b.lifecycle_stage !== stageFilter) return false;
    return true;
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-teal-600 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900 tracking-tight">My Borrowers</h1>
          <p className="text-gray-500 mt-1">{borrowers.length} total borrowers</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowCsvUpload(!showCsvUpload); setShowAddForm(false); }}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <Upload className="w-4 h-4" />
            CSV Upload
          </button>
          <button
            onClick={() => { setShowAddForm(!showAddForm); setShowCsvUpload(false); }}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Borrower
          </button>
        </div>
      </div>

      {/* Add Borrower Form */}
      {showAddForm && (
        <div className="border border-teal-200 rounded-xl bg-teal-50 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-teal-800">Add New Borrower</h3>
            <button onClick={() => setShowAddForm(false)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Full Name *</label>
              <input type="text" value={addName} onChange={e => setAddName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="John Doe" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input type="email" value={addEmail} onChange={e => setAddEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="john@email.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
              <input type="tel" value={addPhone} onChange={e => setAddPhone(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="(555) 123-4567" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Credit Score</label>
              <input type="number" value={addCreditScore} onChange={e => setAddCreditScore(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="720" min={300} max={850} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Entity Type</label>
            <div className="flex gap-2">
              {[['individual', 'Individual'], ['llc', 'LLC'], ['corporation', 'Corporation']].map(([val, label]) => (
                <button key={val} type="button" onClick={() => setAddEntityType(val)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${addEntityType === val ? 'border-teal-500 bg-teal-100 text-teal-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date of Birth</label>
            <input type="date" value={addDob} onChange={e => setAddDob(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-600" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Residential Address</label>
            <input type="text" value={addStreet} onChange={e => setAddStreet(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-600 mb-2" placeholder="Street address" />
            <div className="grid grid-cols-6 gap-2">
              <input type="text" value={addCity} onChange={e => setAddCity(e.target.value)}
                className="col-span-3 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="City" />
              <select value={addState} onChange={e => setAddState(e.target.value)}
                className="col-span-1 px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-600">
                <option value="">ST</option>
                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input type="text" value={addZip} onChange={e => setAddZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
                className="col-span-2 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="Zip" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={() => setShowAddForm(false)} className="px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={handleAddBorrower} disabled={adding || !addName}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors">
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add Borrower
            </button>
          </div>
        </div>
      )}

      {/* CSV Upload */}
      {showCsvUpload && (
        <div className="border border-gray-200 rounded-xl bg-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Bulk Upload via CSV</h3>
            <button onClick={() => { setShowCsvUpload(false); setCsvResult(null); setCsvError(null); }} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>
          <p className="text-xs text-gray-500">Upload a CSV file with columns: Name, Email, Phone, Credit Score, Entity Type</p>
          <div className="flex gap-2">
            <button onClick={downloadCsvTemplate}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors">
              <Download className="w-3.5 h-3.5" /> Download Template
            </button>
            <label className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg cursor-pointer transition-colors border-2 border-dashed ${
              csvUploading ? 'border-gray-300 bg-gray-50 text-gray-400' : 'border-teal-300 text-teal-700 hover:bg-teal-50 hover:border-teal-400'
            }`}>
              <input type="file" accept=".csv" onChange={handleCsvUpload} className="hidden" disabled={csvUploading} />
              {csvUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {csvUploading ? 'Uploading...' : 'Choose CSV File'}
            </label>
          </div>
          {csvResult && (
            <div className="px-4 py-3 bg-green-50 border border-green-100 rounded-lg text-sm text-green-700 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              Imported {csvResult.success} borrower(s){csvResult.failed > 0 ? `, ${csvResult.failed} failed` : ''}.
            </div>
          )}
          {csvError && (
            <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> {csvError}
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
            placeholder="Search by name or email..."
          />
        </div>
        <select
          value={stageFilter}
          onChange={e => setStageFilter(e.target.value)}
          className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
        >
          <option value="all">All Stages</option>
          {Object.entries(STAGE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="border border-gray-200 rounded-xl bg-white p-12 text-center">
          <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">{search || stageFilter !== 'all' ? 'No borrowers match your filters' : 'No borrowers yet'}</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Borrower</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Credit Score</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Stage</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Created</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(b => (
                <tr key={b.id} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => window.location.href = `/internal/my-borrowers/${b.id}`}>
                  <td className="px-5 py-4">
                    <Link to={`/internal/my-borrowers/${b.id}`} className="text-sm font-medium text-teal-700 hover:text-teal-900 hover:underline">{b.borrower_name}</Link>
                    <p className="text-xs text-gray-500">{b.email}</p>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-sm text-gray-900">{b.credit_score || '—'}</span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${STAGE_COLORS[b.lifecycle_stage || ''] || 'bg-gray-100 text-gray-600'}`}>
                      {STAGE_LABELS[b.lifecycle_stage || ''] || b.lifecycle_stage || 'New'}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-sm text-gray-500">{new Date(b.created_at).toLocaleDateString()}</span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Link
                      to={`/internal/my-borrowers/${b.id}`}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors"
                    >
                      View <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
