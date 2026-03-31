import { AlertCircle, Loader2 } from 'lucide-react';
import { useBorrowerDashboard } from '../../modules/borrower-intake/hooks/useBorrowerDashboard';
import { PreApprovalJourney } from './PreApprovalJourney';

export function BorrowerDashboard() {
  const { borrower, preApprovals, isLoading, error, refetch } = useBorrowerDashboard();

  const handleJourneyComplete = () => {
    console.log('Pre-approval complete, ready for loan application');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin text-teal-600" />
          Loading...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-red-600 font-medium mb-2">Error Loading</p>
          <p className="text-gray-600 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <PreApprovalJourney
      borrower={borrower}
      preApprovals={preApprovals}
      onComplete={handleJourneyComplete}
      onRefresh={refetch}
    />
  );
}
