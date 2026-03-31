import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { TeamProvider } from './components/team/TeamContext';
import { LoginPage } from './components/auth/LoginPage';
import { BorrowerLayout } from './layouts/BorrowerLayout';
import { InternalLayout } from './layouts/InternalLayout';
import { ApplicationFlowPage } from './pages/borrower/ApplicationFlowPage';
import { InternalDashboardPage } from './pages/internal/InternalDashboardPage';
import { BorrowerQueuePage } from './pages/internal/BorrowerQueuePage';
import { BorrowerFilePage } from './pages/internal/BorrowerFilePage';
import { InternalPlacerBotPage } from './pages/internal/InternalPlacerBotPage';

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
  const { user, userAccount, entityMembership, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isLoading && user) {
      console.log({
        user,
        entityMembership
      });

      const from = (location.state as { from?: { pathname: string } })?.from?.pathname;

      if (from && from !== '/login' && from !== '/') {
        navigate(from, { replace: true });
      } else if (entityMembership) {
        navigate('/internal/dashboard', { replace: true });
      } else {
        navigate('/dashboard', { replace: true });
      }
    }
  }, [isLoading, user, userAccount, entityMembership, navigate, location]);

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
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<RoleBasedRedirect />} />

        <Route
          path="/application"
          element={
            <ProtectedRoute allowedRoles={['borrower']}>
              <BorrowerLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<ApplicationFlowPage />} />
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
          <Route path="dashboard" element={<InternalDashboardPage />} />
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
