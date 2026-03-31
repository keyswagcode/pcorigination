import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getOrganizationForUser, getOrganizationMembers } from '../../services/organizationService';
import type { Organization, OrganizationMember } from '../../shared/types';

interface TeamContextValue {
  organization: Organization | null;
  member: OrganizationMember | null;
  members: OrganizationMember[];
  isManager: boolean;
  isLoading: boolean;
}

const TeamContext = createContext<TeamContextValue>({
  organization: null,
  member: null,
  members: [],
  isManager: false,
  isLoading: true,
});

export function TeamProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [member, setMember] = useState<OrganizationMember | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setOrganization(null);
      setMember(null);
      setMembers([]);
      setIsLoading(false);
      return;
    }

    (async () => {
      setIsLoading(true);
      try {
        const { organization: org, member: mem } = await getOrganizationForUser(user.id);
        setOrganization(org);
        setMember(mem);

        if (org) {
          const allMembers = await getOrganizationMembers(org.id);
          setMembers(allMembers);
        }
      } catch (err) {
        console.error('TeamContext error:', err);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [user]);

  return (
    <TeamContext.Provider
      value={{
        organization,
        member,
        members,
        isManager: member?.role === 'manager' || member?.role === 'admin' || false,
        isLoading,
      }}
    >
      {children}
    </TeamContext.Provider>
  );
}

export function useTeam() {
  return useContext(TeamContext);
}
