import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LogOut, HelpCircle } from 'lucide-react';

export function BorrowerLayout() {
  const { userAccount, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gradient-to-br from-teal-500 to-teal-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">LC</span>
              </div>
              <span className="text-xl font-semibold text-gray-900 hidden sm:block">
                Loan Center
              </span>
            </div>

            <div className="flex items-center gap-2">
              {userAccount && (
                <div className="hidden sm:flex items-center gap-2 pr-3 border-r border-gray-200">
                  <div className="w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center">
                    <span className="text-sm font-medium text-teal-700">
                      {userAccount.first_name?.[0]}{userAccount.last_name?.[0]}
                    </span>
                  </div>
                  <span className="text-sm text-gray-600">
                    {userAccount.first_name}
                  </span>
                </div>
              )}
              <button
                onClick={() => window.location.href = 'mailto:support@example.com'}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <HelpCircle className="w-4 h-4" />
                <span className="hidden sm:inline">Help</span>
              </button>
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
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
    </div>
  );
}
