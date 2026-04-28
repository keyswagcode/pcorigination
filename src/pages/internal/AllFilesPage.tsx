import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { FileText, Loader2, Search, Download, ArrowRight } from 'lucide-react';

interface FileRow {
  id: string;
  borrower_id: string;
  document_type: string;
  document_subtype: string | null;
  file_name: string;
  file_path: string;
  mime_type: string | null;
  file_size: number | null;
  processing_status: string;
  created_at: string;
  borrower_name?: string;
  borrower_email?: string;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  bank_statement: 'Bank Statement',
  drivers_license: "Driver's License / Passport",
  voided_check: 'Voided Check',
  property_insurance: 'Property Insurance',
  scope_of_work: 'Scope of Work',
  real_estate_experience: 'Real Estate Experience',
  lease: 'Lease',
  articles_of_incorporation: 'Articles of Incorporation',
  ein_letter: 'EIN Letter',
  operating_agreement: 'Operating Agreement',
  rehab_budget: 'Rehab Budget',
  flip_experience: 'Flip Experience Sheet',
  appraisal: 'Appraisal',
};

const STATUS_COLORS: Record<string, string> = {
  uploaded: 'bg-blue-100 text-blue-700',
  pending: 'bg-amber-100 text-amber-700',
  processing: 'bg-blue-100 text-blue-700',
  processed: 'bg-teal-100 text-teal-700',
  failed: 'bg-red-100 text-red-700',
};

export function AllFilesPage() {
  const { userAccount } = useAuth();
  const [files, setFiles] = useState<FileRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  const isAdminLike = userAccount?.user_role === 'admin' || userAccount?.user_role === 'reviewer';

  const loadData = useCallback(async () => {
    setIsLoading(true);
    const { data: docs } = await supabase
      .from('uploaded_documents')
      .select('id, borrower_id, document_type, document_subtype, file_name, file_path, mime_type, file_size, processing_status, created_at')
      .order('created_at', { ascending: false })
      .limit(500);

    if (!docs || docs.length === 0) {
      setFiles([]);
      setIsLoading(false);
      return;
    }

    const borrowerIds = Array.from(new Set(docs.map(d => d.borrower_id).filter(Boolean)));
    const { data: borrowerData } = await supabase
      .from('borrowers')
      .select('id, borrower_name, email')
      .in('id', borrowerIds);

    const byId = new Map((borrowerData || []).map(b => [b.id, b]));
    setFiles(docs.map(d => ({
      ...d,
      borrower_name: byId.get(d.borrower_id)?.borrower_name || 'Unknown',
      borrower_email: byId.get(d.borrower_id)?.email || undefined,
    })));
    setIsLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleDownload = async (file: FileRow) => {
    const { data, error } = await supabase.storage
      .from('borrower-documents')
      .createSignedUrl(file.file_path, 60);
    if (error || !data?.signedUrl) {
      alert('Could not generate download link.');
      return;
    }
    window.open(data.signedUrl, '_blank');
  };

  const docTypeOptions = Array.from(new Set(files.map(f => f.document_type))).sort();

  const visibleFiles = files
    .filter(f => typeFilter === 'all' || f.document_type === typeFilter)
    .filter(f => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (f.file_name || '').toLowerCase().includes(q)
        || (f.borrower_name || '').toLowerCase().includes(q)
        || (f.borrower_email || '').toLowerCase().includes(q)
        || (f.document_type || '').toLowerCase().includes(q)
        || (DOC_TYPE_LABELS[f.document_type] || '').toLowerCase().includes(q);
    });

  const fmtSize = (bytes: number | null) => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!isAdminLike) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">You don't have permission to view all files.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-gray-900 tracking-tight">All Files</h1>
        <p className="text-gray-500 mt-1">{files.length} files across all borrowers (most recent 500)</p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
        >
          <option value="all">All document types</option>
          {docTypeOptions.map(t => (
            <option key={t} value={t}>{DOC_TYPE_LABELS[t] || t}</option>
          ))}
        </select>
        <div className="relative flex-1 min-w-[280px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
            placeholder="Search by file name, borrower, or document type..."
          />
        </div>
      </div>

      {visibleFiles.length === 0 ? (
        <div className="border border-gray-200 rounded-xl bg-white p-8 text-center">
          <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No files match the current filter.</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="text-left px-4 py-3 font-medium">File</th>
                <th className="text-left px-4 py-3 font-medium">Borrower</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Size</th>
                <th className="text-left px-4 py-3 font-medium">Uploaded</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleFiles.map(f => (
                <tr key={f.id} className="hover:bg-teal-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <span className="text-gray-900 truncate max-w-[280px]">{f.file_name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/internal/my-borrowers/${f.borrower_id}`} className="block">
                      <p className="font-medium text-gray-900">{f.borrower_name}</p>
                      {f.borrower_email && <p className="text-xs text-gray-500">{f.borrower_email}</p>}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{DOC_TYPE_LABELS[f.document_type] || f.document_type}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[f.processing_status] || 'bg-gray-100 text-gray-600'}`}>
                      {f.processing_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">{fmtSize(f.file_size)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{new Date(f.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => handleDownload(f)}
                        className="inline-flex items-center gap-1 text-teal-700 text-xs font-medium hover:text-teal-900"
                      >
                        <Download className="w-3.5 h-3.5" /> Download
                      </button>
                      <Link to={`/internal/my-borrowers/${f.borrower_id}`} className="text-gray-400 hover:text-gray-600">
                        <ArrowRight className="w-4 h-4" />
                      </Link>
                    </div>
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
