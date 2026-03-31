import { FileText, CheckCircle, Clock, XCircle, Download } from 'lucide-react';

interface Document {
  id: string;
  document_type: string;
  file_name: string;
  processing_status: string;
  created_at: string;
}

interface DocumentsReviewPanelProps {
  documents: Document[];
}

export function DocumentsReviewPanel({ documents }: DocumentsReviewPanelProps) {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
      case 'processed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'processing':
      case 'pending':
        return <Clock className="w-4 h-4 text-amber-500" />;
      case 'failed':
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  const getDocumentTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'bank_statement': 'Bank Statement',
      'tax_return': 'Tax Return',
      'w2': 'W-2 Form',
      '1099': '1099 Form',
      'liquidity_statement': 'Liquidity Statement',
      'entity_document': 'Entity Document',
      'id_document': 'ID Document',
      'other': 'Other'
    };
    return labels[type] || type;
  };

  const groupedDocs = documents.reduce((acc, doc) => {
    const type = doc.document_type;
    if (!acc[type]) acc[type] = [];
    acc[type].push(doc);
    return acc;
  }, {} as Record<string, Document[]>);

  return (
    <div>
      <h3 className="font-semibold text-gray-900 mb-4">Uploaded Documents</h3>

      {documents.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-gray-300 rounded-lg">
          <FileText className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500">No documents uploaded</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedDocs).map(([type, docs]) => (
            <div key={type}>
              <h4 className="text-sm font-medium text-gray-700 mb-2">
                {getDocumentTypeLabel(type)} ({docs.length})
              </h4>
              <div className="space-y-2">
                {docs.map(doc => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-white rounded flex items-center justify-center border border-gray-200">
                        <FileText className="w-4 h-4 text-gray-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{doc.file_name}</p>
                        <p className="text-xs text-gray-500">
                          {new Date(doc.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        {getStatusIcon(doc.processing_status)}
                        <span className="text-xs text-gray-600 capitalize">
                          {doc.processing_status}
                        </span>
                      </div>
                      <button className="p-1.5 text-gray-400 hover:text-gray-600">
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 p-4 bg-blue-50 rounded-lg">
        <h4 className="font-medium text-blue-800 mb-2">Document Summary</h4>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-blue-600">Total</p>
            <p className="font-semibold text-blue-900">{documents.length}</p>
          </div>
          <div>
            <p className="text-blue-600">Processed</p>
            <p className="font-semibold text-blue-900">
              {documents.filter(d => d.processing_status === 'completed' || d.processing_status === 'processed').length}
            </p>
          </div>
          <div>
            <p className="text-blue-600">Pending</p>
            <p className="font-semibold text-blue-900">
              {documents.filter(d => d.processing_status === 'pending' || d.processing_status === 'processing').length}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
