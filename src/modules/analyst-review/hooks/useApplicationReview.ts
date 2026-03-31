import { useState, useEffect } from 'react';
import { fetchApplicationById, fetchStatusHistory, updateApplicationStatus } from '../../../services/applicationService';
import { fetchDocumentsForApplication, fetchNormalizedBankAccounts } from '../../../services/documentService';
import { fetchPreApprovalsForApplication } from '../../../services/placementService';
import { useAuth } from '../../../contexts/AuthContext';
import type { Application, ApplicationStatus, ApplicationStatusHistory, NormalizedBankAccount, PreApproval } from '../../../shared/types';

interface ApplicationReviewData {
  application: Application | null;
  statusHistory: ApplicationStatusHistory[];
  normalizedAccounts: NormalizedBankAccount[];
  preApprovals: PreApproval[];
  isLoading: boolean;
  isTransitioning: boolean;
  error: string | null;
  transitionStatus: (newStatus: ApplicationStatus, notes?: string) => Promise<void>;
  refetch: () => void;
}

export function useApplicationReview(applicationId: string): ApplicationReviewData {
  const { user } = useAuth();
  const [application, setApplication] = useState<Application | null>(null);
  const [statusHistory, setStatusHistory] = useState<ApplicationStatusHistory[]>([]);
  const [normalizedAccounts, setNormalizedAccounts] = useState<NormalizedBankAccount[]>([]);
  const [preApprovals, setPreApprovals] = useState<PreApproval[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!applicationId) return;

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [app, history, accounts, approvals] = await Promise.all([
          fetchApplicationById(applicationId),
          fetchStatusHistory(applicationId),
          fetchNormalizedBankAccounts(applicationId),
          fetchPreApprovalsForApplication(applicationId),
        ]);
        setApplication(app);
        setStatusHistory(history);
        setNormalizedAccounts(accounts);
        setPreApprovals(approvals as unknown as PreApproval[]);
      } catch (err) {
        setError('Failed to load application');
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [applicationId, tick]);

  const transitionStatus = async (newStatus: ApplicationStatus, notes?: string) => {
    if (!user || !applicationId) return;
    setIsTransitioning(true);
    try {
      await updateApplicationStatus(applicationId, newStatus, user.id, notes);
      setTick(t => t + 1);
    } finally {
      setIsTransitioning(false);
    }
  };

  return {
    application,
    statusHistory,
    normalizedAccounts,
    preApprovals,
    isLoading,
    isTransitioning,
    error,
    transitionStatus,
    refetch: () => setTick(t => t + 1),
  };
}
