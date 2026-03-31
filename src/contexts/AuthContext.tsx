import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../services/supabaseClient';
import type { Session, User } from '@supabase/supabase-js';

interface UserAccount {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  user_role: string | null;
}

interface EntityMembership {
  id: string;
  entity_id: string;
  role: string | null;
  is_guarantor: boolean;
  is_signing_authority: boolean;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  userAccount: UserAccount | null;
  entityMembership: EntityMembership | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  userAccount: null,
  entityMembership: null,
  isLoading: true,
  signOut: async () => {},
});

async function fetchUserAccount(authUserId: string): Promise<UserAccount | null> {
  const { data: account } = await supabase
    .from('user_accounts')
    .select('id, first_name, last_name, email, user_role')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  return account;
}

async function fetchEntityMembership(userId: string): Promise<EntityMembership | null> {
  const { data: membership } = await supabase
    .from('entity_members')
    .select('id, entity_id, role, is_guarantor, is_signing_authority')
    .eq('user_id', userId)
    .maybeSingle();
  return membership;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [userAccount, setUserAccount] = useState<UserAccount | null>(null);
  const [entityMembership, setEntityMembership] = useState<EntityMembership | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const { data } = await supabase.auth.getSession();

      if (!mounted) return;

      setSession(data.session);
      setUser(data.session?.user ?? null);

      if (data.session?.user) {
        const [account, membership] = await Promise.all([
          fetchUserAccount(data.session.user.id),
          fetchEntityMembership(data.session.user.id)
        ]);
        if (mounted) {
          setUserAccount(account);
          setEntityMembership(membership);
        }
      }

      if (mounted) {
        setIsLoading(false);
      }
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;

      setSession(newSession);
      setUser(newSession?.user ?? null);

      if (newSession?.user) {
        Promise.all([
          fetchUserAccount(newSession.user.id),
          fetchEntityMembership(newSession.user.id)
        ]).then(([account, membership]) => {
          if (mounted) {
            setUserAccount(account);
            setEntityMembership(membership);
          }
        });
      } else {
        setUserAccount(null);
        setEntityMembership(null);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user, userAccount, entityMembership, isLoading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
