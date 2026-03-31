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
  pos_slug: string | null;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  userAccount: UserAccount | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  userAccount: null,
  isLoading: true,
  signOut: async () => {},
});

async function fetchUserAccount(authUserId: string): Promise<UserAccount | null> {
  const { data: account } = await supabase
    .from('user_accounts')
    .select('id, first_name, last_name, email, user_role, pos_slug')
    .eq('id', authUserId)
    .maybeSingle();
  return account;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [userAccount, setUserAccount] = useState<UserAccount | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const { data } = await supabase.auth.getSession();

      if (!mounted) return;

      setSession(data.session);
      setUser(data.session?.user ?? null);

      if (data.session?.user) {
        const account = await fetchUserAccount(data.session.user.id);
        if (mounted) {
          setUserAccount(account);
        }
      }

      if (mounted) {
        setIsLoading(false);
      }
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;

      setSession(newSession);
      setUser(newSession?.user ?? null);

      if (newSession?.user) {
        fetchUserAccount(newSession.user.id).then((account) => {
          if (mounted) {
            setUserAccount(account);
          }
        });
      } else {
        setUserAccount(null);
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
    <AuthContext.Provider value={{ session, user, userAccount, isLoading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
