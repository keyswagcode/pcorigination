import type { BorrowerStatus } from '../../shared/types';
import { Lock, FileText, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';

interface ScenarioAccessGateProps {
  status: BorrowerStatus;
}

export function ScenarioAccessGate({ status }: ScenarioAccessGateProps) {
  const getContent = () => {
    switch (status) {
      case 'draft':
        return {
          icon: FileText,
          title: 'Complete Your Profile First',
          description: 'To create property loan scenarios, please complete your financial profile and upload required documents.',
          action: { to: '/borrower/profile', label: 'Complete Profile' }
        };
      case 'submitted':
      case 'documents_processing':
        return {
          icon: Clock,
          title: 'Documents Being Processed',
          description: 'We are processing your financial documents. Loan scenarios will be available once your documents are reviewed.',
          action: { to: '/borrower/status', label: 'View Status' }
        };
      case 'prequalified':
      case 'under_review':
        return {
          icon: Clock,
          title: 'Under Review',
          description: 'Your application is currently under review by our team. You will be able to create property scenarios once approved.',
          action: { to: '/borrower/status', label: 'View Status' }
        };
      case 'additional_docs_requested':
        return {
          icon: FileText,
          title: 'Additional Documents Required',
          description: 'Please upload the requested additional documents to continue your application process.',
          action: { to: '/borrower/documents', label: 'Upload Documents' }
        };
      case 'declined':
        return {
          icon: Lock,
          title: 'Application Not Approved',
          description: 'Unfortunately, your application was not approved at this time. Please contact us for more information.',
          action: null
        };
      default:
        return {
          icon: Lock,
          title: 'Scenarios Locked',
          description: 'Property loan scenarios will be available after your borrower profile is approved.',
          action: { to: '/borrower/status', label: 'View Status' }
        };
    }
  };

  const content = getContent();
  const Icon = content.icon;

  return (
    <div className="p-8 text-center bg-gray-50">
      <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
        <Icon className="w-8 h-8 text-gray-400" />
      </div>
      <h3 className="font-semibold text-gray-900 mb-2">{content.title}</h3>
      <p className="text-gray-600 text-sm max-w-md mx-auto mb-4">
        {content.description}
      </p>
      {content.action && (
        <Link
          to={content.action.to}
          className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors"
        >
          {content.action.label}
        </Link>
      )}
    </div>
  );
}
