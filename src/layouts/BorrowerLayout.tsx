import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LogOut, HelpCircle, Home, FileText, Briefcase } from 'lucide-react';

const NAV_ITEMS = [
  { label: 'Home', path: '/application', icon: Home },
  { label: 'Documents', path: '/application/documents', icon: FileText },
  { label: 'My Loans', path: '/application/loans', icon: Briefcase },
];

export function BorrowerLayout() {
  const { userAccount, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const isActive = (path: string) => {
    if (path === '/application') return location.pathname === '/application';
    return location.pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-gradient-to-br from-teal-500 to-teal-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">LC</span>
                </div>
                <span className="text-xl font-semibold text-gray-900 hidden sm:block">
                  Loan Center
                </span>
              </div>

              <nav className="hidden sm:flex items-center gap-1">
                {NAV_ITEMS.map(({ label, path, icon: Icon }) => (
                  <Link
                    key={path}
                    to={path}
                    className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                      isActive(path)
                        ? 'text-teal-700 bg-teal-50'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </Link>
                ))}
              </nav>
            </div>

            <div className="flex items-center gap-2">
              {userAccount && (
                <Link
                  to="/application/profile"
                  className="hidden sm:flex items-center gap-2 pr-3 border-r border-gray-200 hover:opacity-80 transition-opacity"
                >
                  <div className="w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center">
                    <span className="text-sm font-medium text-teal-700">
                      {userAccount.first_name?.[0]}{userAccount.last_name?.[0]}
                    </span>
                  </div>
                  <span className="text-sm text-gray-600">
                    {userAccount.first_name}
                  </span>
                </Link>
              )}
              <a
                href="mailto:lindsay@keyrealestatecapital.com?subject=Help%20with%20my%20loan%20application"
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <HelpCircle className="w-4 h-4" />
                <span className="hidden sm:inline">Help</span>
              </a>
              <button
                onClick={handleSignOut}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          </div>
        </div>

        {/* Mobile nav */}
        <div className="sm:hidden border-t border-gray-100 px-4 py-2 flex gap-1">
          {NAV_ITEMS.map(({ label, path, icon: Icon }) => (
            <Link
              key={path}
              to={path}
              className={`flex-1 flex flex-col items-center gap-1 py-2 text-xs font-medium rounded-lg transition-colors ${
                isActive(path)
                  ? 'text-teal-700 bg-teal-50'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          ))}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
    </div>
  );
}
