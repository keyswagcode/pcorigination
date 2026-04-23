import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../services/supabaseClient';
import type { Session, User } from '@supabase/supabase-js';

interface UserAccount {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  user_role: string | null;
  pos_slug: string | null;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  userAccount: UserAccount | null;
  isLoading: boolean;
  accountFetched: boolean;
  signOut: () => Promise<void>;
  refreshUserAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  userAccount: null,
  isLoading: true,
  accountFetched: false,
  signOut: async () => {},
  refreshUserAccount: async () => {},
});

async function fetchUserAccount(authUserId: string): Promise<UserAccount | null> {
  const { data: account } = await supabase
    .from('user_accounts')
    .select('id, first_name, last_name, email, user_role, pos_slug')
    .eq('id', authUserId)
    .maybeSingle();

  // Activate any pending org memberships on login
  if (account) {
    supabase
      .from('organization_members')
      .update({ invite_status: 'active' })
      .eq('user_id', authUserId)
      .eq('invite_status', 'pending')
      .then(() => {});
  }

  return account;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [userAccount, setUserAccount] = useState<UserAccount | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [accountFetched, setAccountFetched] = useState(false);
  const currentUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const { data } = await supabase.auth.getSession();

      if (!mounted) return;

      setSession(data.session);
      setUser(data.session?.user ?? null);
      currentUserIdRef.current = data.session?.user?.id ?? null;

      if (data.session?.user) {
        const account = await fetchUserAccount(data.session.user.id);
        if (mounted) {
          setUserAccount(account);
          setAccountFetched(true);
        }
      }

      if (mounted) {
        setIsLoading(false);
      }
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;

      const prevUserId = currentUserIdRef.current;
      const newUserId = newSession?.user?.id ?? null;
      currentUserIdRef.current = newUserId;

      setSession(newSession);
      setUser(newSession?.user ?? null);

      if (newSession?.user) {
        // Show loading state if the user changed (login/switch), not on token refresh
        if (newUserId !== prevUserId) {
          setIsLoading(true);
          setAccountFetched(false);
        }
        fetchUserAccount(newSession.user.id).then((account) => {
          if (mounted) {
            setUserAccount(account);
            setAccountFetched(true);
            setIsLoading(false);
          }
        });
      } else {
        setUserAccount(null);
        setAccountFetched(false);
        setIsLoading(false);
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

  const refreshUserAccount = async () => {
    const uid = currentUserIdRef.current;
    if (!uid) return;
    const account = await fetchUserAccount(uid);
    setUserAccount(account);
  };

  return (
    <AuthContext.Provider value={{ session, user, userAccount, isLoading, accountFetched, signOut, refreshUserAccount }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
