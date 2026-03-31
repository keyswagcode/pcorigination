import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      if (isSignUp) {
        const { error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex">
      <div className="hidden lg:flex w-1/2 bg-neutral-950 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-neutral-900 via-neutral-950 to-black" />
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }} />
        <div className="relative z-10 flex flex-col justify-between p-12 h-full">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-neutral-950" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </div>
              <span className="text-white font-medium text-lg tracking-tight">Credit Platform</span>
            </div>
          </div>

          <div className="space-y-8">
            <h1 className="text-5xl font-light text-white leading-tight tracking-tight">
              Streamlined<br />
              <span className="font-semibold">Credit Operations</span>
            </h1>
            <p className="text-neutral-400 text-lg max-w-md leading-relaxed">
              Centralized platform for loan processing, borrower management, and credit decisioning.
            </p>
          </div>

          <div className="flex items-center gap-8 text-neutral-500 text-sm">
            <span>Secure Access</span>
            <span className="w-1 h-1 bg-neutral-700 rounded-full" />
            <span>Internal Use Only</span>
          </div>
        </div>
      </div>

      <div className="flex w-full lg:w-1/2 items-center justify-center p-8 bg-neutral-50">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-12">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-neutral-950 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </div>
              <span className="text-neutral-950 font-medium tracking-tight">Credit Platform</span>
            </div>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-semibold text-neutral-950 tracking-tight">
              {isSignUp ? 'Create account' : 'Welcome back'}
            </h2>
            <p className="text-neutral-500 mt-2">
              {isSignUp ? 'Enter your details to get started' : 'Enter your credentials to continue'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-white border border-neutral-200 rounded-lg text-neutral-950 text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-950 focus:border-transparent transition-shadow"
                placeholder="name@company.com"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-4 py-3 pr-11 bg-white border border-neutral-200 rounded-lg text-neutral-950 text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-950 focus:border-transparent transition-shadow"
                  placeholder="Enter your password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-600 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 bg-neutral-950 text-white font-medium rounded-lg hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-950 focus:ring-offset-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 group"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>{isSignUp ? 'Creating account...' : 'Signing in...'}</span>
                </>
              ) : (
                <>
                  <span>{isSignUp ? 'Create account' : 'Sign in'}</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-neutral-200">
            <button
              onClick={() => { setIsSignUp(!isSignUp); setError(null); }}
              className="text-sm text-neutral-600 hover:text-neutral-950 transition-colors"
            >
              {isSignUp ? 'Already have an account? Sign in' : "Need an account? Contact administrator"}
            </button>
          </div>

          <p className="text-xs text-neutral-400 mt-8">
            Authorized personnel only. Access is logged and monitored.
          </p>
        </div>
      </div>
    </div>
  );
}
