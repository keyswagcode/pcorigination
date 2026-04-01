import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Eye, EyeOff, Lock, CheckCircle2, Loader2 } from 'lucide-react';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Supabase will auto-detect the recovery token from the URL hash
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setHasSession(true);
      }
      setChecking(false);
    });

    // Also check if we already have a session
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setHasSession(true);
      setChecking(false);
    });
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setSuccess(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setIsLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-neutral-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-neutral-950 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Lock className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-semibold text-neutral-950 tracking-tight">
            {success ? 'Password Updated' : 'Reset Password'}
          </h1>
          <p className="text-neutral-500 mt-2">
            {success
              ? 'Your password has been updated. Redirecting to login...'
              : hasSession
                ? 'Enter your new password below'
                : 'This link may have expired. Please request a new one.'}
          </p>
        </div>

        {success ? (
          <div className="px-4 py-4 bg-green-50 border border-green-100 rounded-lg text-center">
            <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" />
            <p className="text-sm text-green-700">Password reset successfully! Redirecting...</p>
          </div>
        ) : hasSession ? (
          <form onSubmit={handleReset} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">New Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-4 py-3 pr-11 bg-white border border-neutral-200 rounded-lg text-neutral-950 text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-950 focus:border-transparent"
                  placeholder="At least 6 characters"
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">Confirm Password</label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 bg-white border border-neutral-200 rounded-lg text-neutral-950 text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-950 focus:border-transparent"
                placeholder="Confirm your new password"
                required
              />
            </div>

            {error && (
              <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">{error}</div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 bg-neutral-950 text-white font-medium rounded-lg hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-950 focus:ring-offset-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /><span>Updating...</span></>
              ) : (
                <span>Update Password</span>
              )}
            </button>
          </form>
        ) : (
          <div className="text-center">
            <p className="text-sm text-neutral-500 mb-4">The reset link has expired or is invalid.</p>
            <button
              onClick={() => navigate('/login')}
              className="text-sm text-neutral-950 font-medium hover:underline"
            >
              Go to login to request a new link
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
