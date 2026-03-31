import { createContext, useContext, useState, ReactNode } from 'react';

export type Route =
  | { page: 'dashboard' }
  | { page: 'new-application'; forceNew?: boolean; existingSubmissionId?: string }
  | { page: 'application-detail'; id: string; source?: 'intake' | 'application'; tab?: string }
  | { page: 'application-history' }
  | { page: 'pre-approval' }
  | { page: 'submission-review'; id: string }
  | { page: 'placerbot' };

interface RouterContextValue {
  route: Route;
  navigate: (route: Route) => void;
}

const RouterContext = createContext<RouterContextValue>({
  route: { page: 'dashboard' },
  navigate: () => {},
});

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>({ page: 'dashboard' });

  const navigate = (newRoute: Route) => setRoute(newRoute);

  return (
    <RouterContext.Provider value={{ route, navigate }}>
      {children}
    </RouterContext.Provider>
  );
}

export function useRouter() {
  return useContext(RouterContext);
}
