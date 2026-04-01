import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { TeamProvider } from './components/team/TeamContext';
import { LoginPage } from './components/auth/LoginPage';
import { BorrowerLayout } from './layouts/BorrowerLayout';
import { InternalLayout } from './layouts/InternalLayout';
import { BorrowerHomePage } from './pages/borrower/BorrowerHomePage';
import { NewLoanPage } from './pages/borrower/NewLoanPage';
import { BorrowerQueuePage } from './pages/internal/BorrowerQueuePage';
import { BorrowerFilePage } from './pages/internal/BorrowerFilePage';
import { InternalPlacerBotPage } from './pages/internal/InternalPlacerBotPage';
import { BorrowerApplyPage } from './pages/BorrowerApplyPage';
import { BorrowerDocumentsPage } from './pages/borrower/BorrowerDocumentsPage';
import { BorrowerLoansPage } from './pages/borrower/BorrowerLoansPage';
import { BorrowerProfilePage } from './pages/borrower/BorrowerProfilePage';
import { BorrowerLoanEditPage } from './pages/borrower/BorrowerLoanEditPage';
import { BrokerDashboardPage } from './pages/broker/BrokerDashboardPage';
import { BrokerBorrowersPage } from './pages/broker/BrokerBorrowersPage';
import { BrokerBorrowerDetailPage } from './pages/broker/BrokerBorrowerDetailPage';
import { BrokerLoanReviewPage } from './pages/broker/BrokerLoanReviewPage';
import { BrokerSettingsPage } from './pages/broker/BrokerSettingsPage';

function LoginGuard() {
  const { user, userAccount, isLoading } = useAuth();

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

  if (user) {
    if (userAccount && ['reviewer', 'admin', 'broker'].includes(userAccount.user_role || '')) {
      return <Navigate to="/internal/dashboard" replace />;
    }
    return <Navigate to="/application" replace />;
  }

  return <LoginPage />;
}

function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) {
  const { user, userAccount, isLoading } = useAuth();
  const location = useLocation();

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

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && userAccount && !allowedRoles.includes(userAccount.user_role || '')) {
    const defaultRoute = userAccount.user_role === 'borrower' ? '/application' : '/internal/dashboard';
    return <Navigate to={defaultRoute} replace />;
  }

  return <>{children}</>;
}

function RoleBasedRedirect() {
  const { user, userAccount, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isLoading && user) {
const from = (location.state as { from?: { pathname: string } })?.from?.pathname;

      if (from && from !== '/login' && from !== '/') {
        navigate(from, { replace: true });
      } else if (userAccount && ['reviewer', 'admin', 'broker'].includes(userAccount.user_role || '')) {
        navigate('/internal/dashboard', { replace: true });
      } else {
        navigate('/application', { replace: true });
      }
    }
  }, [isLoading, user, userAccount, navigate, location]);

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
      <Routes>
        <Route path="/login" element={<LoginGuard />} />
        <Route path="/apply/:posSlug" element={<BorrowerApplyPage />} />
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
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
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
