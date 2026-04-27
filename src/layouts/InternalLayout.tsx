import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard,
  Users,
  Bot,
  LogOut,
  Menu,
  X,
  Shield,
  Settings,
  Briefcase
} from 'lucide-react';
import { useState } from 'react';

const brokerNavItems = [
  { to: '/internal/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/internal/my-borrowers', icon: Users, label: 'My Borrowers' },
  { to: '/internal/settings', icon: Settings, label: 'Settings' },
];

const adminNavItems = [
  { to: '/internal/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/internal/my-borrowers', icon: Users, label: 'My Borrowers' },
  { to: '/internal/borrowers', icon: Users, label: 'All Borrowers' },
  { to: '/internal/loans', icon: Briefcase, label: 'All Loans' },
  { to: '/internal/placerbot', icon: Bot, label: 'PlacerBot' },
  { to: '/internal/settings', icon: Settings, label: 'Settings' },
];

export function InternalLayout() {
  const { userAccount, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const role = userAccount?.user_role;
  const navItems = (role === 'reviewer' || role === 'admin') ? adminNavItems : brokerNavItems;

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-slate-800 text-white sticky top-0 z-40">
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-amber-400 to-amber-500 rounded-lg flex items-center justify-center">
                <Shield className="w-4 h-4 text-slate-800" />
              </div>
              <span className="text-lg font-semibold hidden sm:block">
                Loan Platform
              </span>
            </div>

            <nav className="hidden md:flex items-center gap-1">
              {navItems.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/internal/dashboard'}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-slate-700 text-white'
                        : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
                    }`
                  }
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </NavLink>
              ))}
            </nav>

            <div className="flex items-center gap-3">
              {userAccount && (
                <div className="hidden sm:flex items-center gap-2 pr-3 border-r border-slate-600">
                  <div className="w-7 h-7 bg-amber-500 rounded-full flex items-center justify-center">
                    <span className="text-xs font-medium text-slate-800">
                      {userAccount.first_name?.[0]}{userAccount.last_name?.[0]}
                    </span>
                  </div>
                  <div className="text-sm">
                    <span className="text-slate-200">{userAccount.first_name}</span>
                    <span className="text-slate-400 text-xs ml-2 capitalize">
                      {userAccount.user_role}
                    </span>
                  </div>
                </div>
              )}
              <button
                onClick={handleSignOut}
                className="flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2 text-slate-300 hover:text-white"
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-700 bg-slate-800">
            <nav className="px-4 py-3 space-y-1">
              {navItems.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-slate-700 text-white'
                        : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
                    }`
                  }
                >
                  <Icon className="w-5 h-5" />
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
        )}
      </header>

      <main className="p-4 sm:p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}
