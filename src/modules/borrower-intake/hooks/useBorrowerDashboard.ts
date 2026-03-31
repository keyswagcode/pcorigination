import { useState, useEffect } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { fetchBorrowerApplications } from '../../../services/applicationService';
import { fetchPreApprovalsForUser } from '../../../services/placementService';
import { getBorrowerForUser } from '../../../services/borrowerService';
import type { Application, Borrower, PreApproval } from '../../../shared/types';

interface DashboardData {
  borrower: Borrower | null;
  applications: Application[];
  preApprovals: PreApproval[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useBorrowerDashboard(): DashboardData {
  const { user } = useAuth();
  const [borrower, setBorrower] = useState<Borrower | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [preApprovals, setPreApprovals] = useState<PreApproval[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!user) {
      setIsLoading(false);
      return;
    }

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        console.log('[useBorrowerDashboard] Fetching data for user:', user.id);
        const [b, apps, approvals] = await Promise.all([
          getBorrowerForUser(user.id),
          fetchBorrowerApplications(user.id),
          fetchPreApprovalsForUser(user.id),
        ]);
        console.log('[useBorrowerDashboard] Results:', {
          borrower: b,
          applications: apps,
          applicationsCount: apps.length,
          preApprovals: approvals,
        });
        setBorrower(b);
        setApplications(apps);
        setPreApprovals(approvals as unknown as PreApproval[]);
      } catch (err) {
        setError('Failed to load dashboard data');
        console.error('[useBorrowerDashboard] Error:', err);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [user, tick]);

  return {
    borrower,
    applications,
    preApprovals,
    isLoading,
    error,
    refetch: () => setTick(t => t + 1),
  };
}
