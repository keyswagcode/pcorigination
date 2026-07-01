import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, lazy, Suspense, type ComponentType } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { TeamProvider } from './components/team/TeamContext';
import { LoginPage } from './components/auth/LoginPage';
import { BorrowerLayout } from './layouts/BorrowerLayout';
import { InternalLayout } from './layouts/InternalLayout';

// Lazy import that self-heals across deploys. When we ship a new build, chunk
// filenames change; a client still holding the previous index.html requests an
// old chunk name that no longer exists. Our SPA rewrite serves index.html for
// it (HTML, not JS), so the dynamic import rejects — and without this the
// Suspense fallback would spin forever ("load circle of death"). On the first
// such failure we force ONE full reload to fetch the fresh index + new chunks;
// a short sessionStorage guard prevents a reload loop on a genuine error.
// deno-lint-ignore no-explicit-any
function lazyWithReload<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      const KEY = 'chunk_reload_at';
      const last = Number(sessionStorage.getItem(KEY) || '0');
      if (Date.now() - last > 15000) {
        sessionStorage.setItem(KEY, String(Date.now()));
        window.location.reload();
        // Never resolve — let the reload take over before anything renders.
        return new Promise<{ default: T }>(() => {});
      }
      throw err;
    }
  });
}

// Routes are lazy-loaded so the initial bundle isn't one ~1.3 MB chunk that
// loads every portal + jsPDF/html2canvas up front. Each page (and its heavy
// deps) is fetched on demand. Named exports are mapped to default for lazy().
const BorrowerHomePage = lazyWithReload(() => import('./pages/borrower/BorrowerHomePage').then(m => ({ default: m.BorrowerHomePage })));
const NewLoanPage = lazyWithReload(() => import('./pages/borrower/NewLoanPage').then(m => ({ default: m.NewLoanPage })));
const BorrowerCommercialIntakePage = lazyWithReload(() => import('./pages/borrower/BorrowerCommercialIntakePage'));
const BorrowerQueuePage = lazyWithReload(() => import('./pages/internal/BorrowerQueuePage').then(m => ({ default: m.BorrowerQueuePage })));
const BorrowerFilePage = lazyWithReload(() => import('./pages/internal/BorrowerFilePage').then(m => ({ default: m.BorrowerFilePage })));
const InternalPlacerBotPage = lazyWithReload(() => import('./pages/internal/InternalPlacerBotPage').then(m => ({ default: m.InternalPlacerBotPage })));
const AllLoansPage = lazyWithReload(() => import('./pages/internal/AllLoansPage').then(m => ({ default: m.AllLoansPage })));
const AllFilesPage = lazyWithReload(() => import('./pages/internal/AllFilesPage').then(m => ({ default: m.AllFilesPage })));
const AllApplicationsPage = lazyWithReload(() => import('./pages/internal/AllApplicationsPage').then(m => ({ default: m.AllApplicationsPage })));
const FunnelPage = lazyWithReload(() => import('./pages/internal/FunnelPage').then(m => ({ default: m.FunnelPage })));
const BorrowerApplyPage = lazyWithReload(() => import('./pages/BorrowerApplyPage').then(m => ({ default: m.BorrowerApplyPage })));
const BorrowerDocumentsPage = lazyWithReload(() => import('./pages/borrower/BorrowerDocumentsPage').then(m => ({ default: m.BorrowerDocumentsPage })));
const BorrowerLoansPage = lazyWithReload(() => import('./pages/borrower/BorrowerLoansPage').then(m => ({ default: m.BorrowerLoansPage })));
const BorrowerProfilePage = lazyWithReload(() => import('./pages/borrower/BorrowerProfilePage').then(m => ({ default: m.BorrowerProfilePage })));
const BorrowerLoanEditPage = lazyWithReload(() => import('./pages/borrower/BorrowerLoanEditPage').then(m => ({ default: m.BorrowerLoanEditPage })));
const BrokerDashboardPage = lazyWithReload(() => import('./pages/broker/BrokerDashboardPage').then(m => ({ default: m.BrokerDashboardPage })));
const BrokerBorrowersPage = lazyWithReload(() => import('./pages/broker/BrokerBorrowersPage').then(m => ({ default: m.BrokerBorrowersPage })));
const BrokerBorrowerDetailPage = lazyWithReload(() => import('./pages/broker/BrokerBorrowerDetailPage').then(m => ({ default: m.BrokerBorrowerDetailPage })));
const BrokerLoanReviewPage = lazyWithReload(() => import('./pages/broker/BrokerLoanReviewPage').then(m => ({ default: m.BrokerLoanReviewPage })));
const BrokerSettingsPage = lazyWithReload(() => import('./pages/broker/BrokerSettingsPage').then(m => ({ default: m.BrokerSettingsPage })));
const ResetPasswordPage = lazyWithReload(() => import('./pages/ResetPasswordPage').then(m => ({ default: m.ResetPasswordPage })));
const CoBorrowerInvitePage = lazyWithReload(() => import('./pages/CoBorrowerInvitePage').then(m => ({ default: m.CoBorrowerInvitePage })));
const BorrowerServicingPage = lazyWithReload(() => import('./pages/borrower/BorrowerServicingPage').then(m => ({ default: m.BorrowerServicingPage })));
const BorrowerServicedLoanPage = lazyWithReload(() => import('./pages/borrower/BorrowerServicedLoanPage').then(m => ({ default: m.BorrowerServicedLoanPage })));
const AdminServicingListPage = lazyWithReload(() => import('./pages/internal/AdminServicingListPage').then(m => ({ default: m.AdminServicingListPage })));
const OnboardServicedLoanPage = lazyWithReload(() => import('./pages/internal/OnboardServicedLoanPage').then(m => ({ default: m.OnboardServicedLoanPage })));
const AdminServicedLoanDetailPage = lazyWithReload(() => import('./pages/internal/AdminServicedLoanDetailPage').then(m => ({ default: m.AdminServicedLoanDetailPage })));

function RouteFallback() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="flex items-center gap-3 text-gray-500">
        <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
        <span>Loading...</span>
      </div>
    </div>
  );
}

function LoginGuard() {
  const { user, userAccount, isLoading, accountFetched } = useAuth();

  if (isLoading || (user && !accountFetched)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-500">
          <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  if (user) {
    if (userAccount && ['reviewer', 'admin', 'broker'].includes(userAccount.user_role || '')) {
      return <Navigate to="/internal/dashboard" replace />;
    }
    return <Navigate to="/application" replace />;
  }

  return <LoginPage />;
}

function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) {
  const { user, userAccount, isLoading, accountFetched } = useAuth();
  const location = useLocation();

  if (isLoading || (user && !accountFetched)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-500">
          <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && userAccount && !allowedRoles.includes(userAccount.user_role || '')) {
    const defaultRoute = userAccount.user_role === 'borrower' ? '/application' : '/internal/dashboard';
    return <Navigate to={defaultRoute} replace />;
  }

  // If userAccount is null (no DB row) but allowedRoles includes 'borrower', let them through
  // Borrowers created via /apply may not have a user_accounts row with role set
  if (allowedRoles && !userAccount && !allowedRoles.includes('borrower')) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function RoleBasedRedirect() {
  const { user, userAccount, isLoading, accountFetched } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isLoading && accountFetched && user) {
      const from = (location.state as { from?: { pathname: string } })?.from?.pathname;

      if (from && from !== '/login' && from !== '/') {
        navigate(from, { replace: true });
      } else if (userAccount && ['reviewer', 'admin', 'broker'].includes(userAccount.user_role || '')) {
        navigate('/internal/dashboard', { replace: true });
      } else {
        navigate('/application', { replace: true });
      }
    }
  }, [isLoading, accountFetched, user, userAccount, navigate, location]);

  if (isLoading || (user && !accountFetched)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-500">
          <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return null;
}

function AppRoutes() {
  const { isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-500">
          <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <TeamProvider>
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<LoginGuard />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/apply/:posSlug" element={<BorrowerApplyPage />} />
        <Route path="/co-borrower-invite/:token" element={<CoBorrowerInvitePage />} />
        <Route path="/" element={<RoleBasedRedirect />} />

        <Route
          path="/application"
          element={
            <ProtectedRoute allowedRoles={['borrower']}>
              <BorrowerLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<BorrowerHomePage />} />
          <Route path="profile" element={<BorrowerProfilePage />} />
          <Route path="documents" element={<BorrowerDocumentsPage />} />
          <Route path="loans" element={<BorrowerLoansPage />} />
          <Route path="loans/:loanId" element={<BorrowerLoanEditPage />} />
          <Route path="new-loan" element={<NewLoanPage />} />
          <Route path="commercial-intake" element={<BorrowerCommercialIntakePage />} />
          <Route path="servicing" element={<BorrowerServicingPage />} />
          <Route path="servicing/:loanId" element={<BorrowerServicedLoanPage />} />
        </Route>

        <Route path="/borrower" element={<Navigate to="/application" replace />} />
        <Route path="/borrower/*" element={<Navigate to="/application" replace />} />
        <Route path="/dashboard" element={<Navigate to="/application" replace />} />
        <Route path="/profile" element={<Navigate to="/application" replace />} />
        <Route path="/documents" element={<Navigate to="/application" replace />} />

        <Route
          path="/internal"
          element={
            <ProtectedRoute allowedRoles={['reviewer', 'admin', 'broker']}>
              <InternalLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<BrokerDashboardPage />} />
          <Route path="my-borrowers" element={<BrokerBorrowersPage />} />
          <Route path="my-borrowers/:borrowerId" element={<BrokerBorrowerDetailPage />} />
          <Route path="loans/:loanId/review" element={<BrokerLoanReviewPage />} />
          <Route path="settings" element={<BrokerSettingsPage />} />
          <Route path="borrowers" element={<BorrowerQueuePage />} />
          <Route path="borrowers/:borrowerId" element={<BorrowerFilePage />} />
          <Route path="placerbot" element={<InternalPlacerBotPage />} />
          <Route path="loans" element={<AllLoansPage />} />
          <Route path="files" element={<AllFilesPage />} />
          <Route path="applications" element={<AllApplicationsPage />} />
          <Route path="funnel" element={<FunnelPage />} />
          <Route path="servicing" element={<AdminServicingListPage />} />
          <Route path="servicing/new" element={<OnboardServicedLoanPage />} />
          <Route path="servicing/:loanId" element={<AdminServicedLoanDetailPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </TeamProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
