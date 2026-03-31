import { useState, useEffect } from 'react';
import { useTeam } from '../../../components/team/TeamContext';
import { fetchOrganizationApplications, fetchStatusCounts } from '../../../services/applicationService';
import type { Application, ApplicationStatus } from '../../../shared/types';

interface AnalystDashboardData {
  applications: Application[];
  statusCounts: Record<string, number>;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useAnalystDashboard(filterStatus?: ApplicationStatus): AnalystDashboardData {
  const { organization } = useTeam();
  const [applications, setApplications] = useState<Application[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!organization) {
      setIsLoading(false);
      return;
    }

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [apps, counts] = await Promise.all([
          fetchOrganizationApplications(organization.id, filterStatus),
          fetchStatusCounts(organization.id),
        ]);
        setApplications(apps);
        setStatusCounts(counts);
      } catch (err) {
        setError('Failed to load submissions');
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [organization, filterStatus, tick]);

  return {
    applications,
    statusCounts,
    isLoading,
    error,
    refetch: () => setTick(t => t + 1),
  };
}
