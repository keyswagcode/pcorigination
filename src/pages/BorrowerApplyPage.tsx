import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { ArrowRight, ArrowLeft, Eye, EyeOff, Building2, Shield } from 'lucide-react';
import { sendNewApplicationAlert } from '../services/newAppAlertService';

type Step = 'credentials' | 'profile';

export function BorrowerApplyPage() {
  const { posSlug } = useParams<{ posSlug: string }>();
  const navigate = useNavigate();
  const { user, userAccount, isLoading: authLoading } = useAuth();

  const [step, setStep] = useState<Step>('credentials');
  const [isSignUp, setIsSignUp] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brokerName, setBrokerName] = useState<string | null>(null);
  const [brokerValid, setBrokerValid] = useState<boolean | null>(null);
  const [resolvedBrokerId, setResolvedBrokerId] = useState<string | null>(null);

  // Credentials
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Profile info
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [ssn, setSsn] = useState('');
  const [creditScore, setCreditScore] = useState('');
  const [addressStreet, setAddressStreet] = useState('');
  const [addressCity, setAddressCity] = useState('');
  const [addressState, setAddressState] = useState('');
  const [addressZip, setAddressZip] = useState('');
  const [creditConsent, setCreditConsent] = useState(false);

  // Track created user for profile step
  const [createdUserId, setCreatedUserId] = useState<string | null>(null);

  const US_STATES = [
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
    'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
    'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
  ];

  useEffect(() => {
    async function validateBroker() {
      if (!posSlug) { setBrokerValid(false); return; }
      const { data } = await supabase
        .from('user_accounts')
        .select('id, first_name, last_name, user_role')
        .eq('pos_slug', posSlug)
        .in('user_role', ['broker', 'admin', 'reviewer'])
        .maybeSingle();
      if (data) {
        setBrokerValid(true);
        setResolvedBrokerId(data.id);
        setBrokerName([data.first_name, data.last_name].filter(Boolean).join(' ') || 'Your Broker');
      } else {
        setBrokerValid(false);
      }
    }
    validateBroker();
  }, [posSlug]);

  useEffect(() => {
    if (authLoading || !user) return;
    if (userAccount && userAccount.user_role !== 'borrower') return;

    const userId = user.id;
    const userEmail = user.email || '';
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('borrowers')
        .select('id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

      if (data) {
        navigate('/application', { replace: true });
      } else {
        setCreatedUserId(userId);
        // Seed email from the authenticated user so the profile insert uses
        // the account email even when the borrower skipped the credentials form
        if (userEmail) setEmail(prev => prev || userEmail);
        setStep('profile');
      }
    })();

    return () => { cancelled = true; };
  }, [authLoading, user, userAccount, navigate]);

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  };

  const formatSSN = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 9);
    if (digits.length <= 3) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  };

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      if (isSignUp) {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { role: 'borrower', broker_id: resolvedBrokerId } }
        });
        if (signUpError) throw signUpError;

        // Sign in immediately to get an active session
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        if (signInData.user) {
          setCreatedUserId(signInData.user.id);
          setStep('profile');
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        // Login will trigger redirect via useEffect
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const userId = createdUserId || user?.id;
    if (!userId) {
      setError('No user session found. Please try again.');
      setIsLoading(false);
      return;
    }

    try {
      const ssnDigits = ssn.replace(/\D/g, '');

      // Update user_accounts with name
      const { error: updateError } = await supabase
        .from('user_accounts')
        .update({ first_name: firstName, last_name: lastName })
        .eq('id', userId);
      if (updateError) throw updateError;

      // Create borrower record
      const { error: borrowerError } = await supabase.from('borrowers').insert({
        user_id: userId,
        borrower_name: `${firstName} ${lastName}`.trim(),
        email,
        phone: phone.replace(/\D/g, ''),
        date_of_birth: dateOfBirth || null,
        ssn_last4: ssnDigits.slice(-4),
        ssn_encrypted: ssnDigits, // TODO: encrypt server-side
        credit_score: creditScore ? parseInt(creditScore) : null,
        address_street: addressStreet,
        address_city: addressCity,
        address_state: addressState,
        address_zip: addressZip,
        state_of_residence: addressState,
        broker_id: resolvedBrokerId,
        credit_consent: creditConsent,
        credit_consent_at: creditConsent ? new Date().toISOString() : null,
        borrower_status: 'draft',
        lifecycle_stage: 'profile_created',
      });
      if (borrowerError) throw borrowerError;

      // Send new application alert to broker + starred team members
      if (resolvedBrokerId) {
        sendNewApplicationAlert({
          borrowerName: `${firstName} ${lastName}`.trim(),
          borrowerEmail: email,
          brokerId: resolvedBrokerId,
        });
      }

      navigate('/application', { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const profileComplete = firstName && lastName && phone && dateOfBirth && ssn.replace(/\D/g, '').length === 9 && creditScore && addressStreet && addressCity && addressState && addressZip && creditConsent;

  if (brokerValid === null) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-500">
          <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  if (brokerValid === false) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-6">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Building2 className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">Invalid Application Link</h1>
          <p className="text-gray-500">This application link is not valid. Please contact your broker for the correct link.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex">
      {/* Left panel */}
      <div className="hidden lg:flex w-1/2 bg-teal-950 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-teal-900 via-teal-950 to-black" />
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }} />
        <div className="relative z-10 flex flex-col justify-between p-12 h-full">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center">
                <Building2 className="w-6 h-6 text-teal-950" />
              </div>
              <span className="text-white font-medium text-lg tracking-tight">Loan Application</span>
            </div>
          </div>

          <div className="space-y-8">
            <h1 className="text-5xl font-light text-white leading-tight tracking-tight">
              {step === 'credentials' ? (
                <>Start Your<br /><span className="font-semibold">Loan Journey</span></>
              ) : (
                <>Tell Us<br /><span className="font-semibold">About Yourself</span></>
              )}
            </h1>
            <p className="text-teal-300 text-lg max-w-md leading-relaxed">
              {step === 'credentials'
                ? 'Get pre-qualified in minutes. Upload your documents and we\'ll match you with the best lending options.'
                : 'We need a few details to verify your identity and get you pre-qualified for a loan.'}
            </p>
            {brokerName && (
              <div className="bg-teal-900/50 border border-teal-800 rounded-lg px-5 py-4">
                <p className="text-teal-200 text-sm">Referred by</p>
                <p className="text-white font-medium text-lg">{brokerName}</p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-8 text-teal-500 text-sm">
            <span>Secure & Encrypted</span>
            <span className="w-1 h-1 bg-teal-700 rounded-full" />
            <span>{step === 'credentials' ? 'Fast Pre-Qualification' : 'Step 2 of 2'}</span>
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex w-full lg:w-1/2 items-center justify-center p-8 bg-neutral-50">
        <div className="w-full max-w-sm">
          {/* Mobile header */}
          <div className="lg:hidden mb-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-9 h-9 bg-teal-600 rounded-lg flex items-center justify-center">
                <Building2 className="w-5 h-5 text-white" />
              </div>
              <span className="text-gray-900 font-medium tracking-tight">Loan Application</span>
            </div>
            {brokerName && (
              <div className="bg-teal-50 border border-teal-100 rounded-lg px-4 py-3 mb-4">
                <p className="text-teal-600 text-sm">Referred by <span className="font-medium">{brokerName}</span></p>
              </div>
            )}
          </div>

          {/* Step indicator for signup */}
          {isSignUp && (
            <div className="flex items-center gap-2 mb-6">
              <div className={`h-1.5 flex-1 rounded-full ${step === 'credentials' ? 'bg-teal-600' : 'bg-teal-600'}`} />
              <div className={`h-1.5 flex-1 rounded-full ${step === 'profile' ? 'bg-teal-600' : 'bg-gray-200'}`} />
            </div>
          )}

          {step === 'credentials' ? (
            <>
              <div className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 tracking-tight">
                  {isSignUp ? 'Create your account' : 'Welcome back'}
                </h2>
                <p className="text-gray-500 mt-2">
                  {isSignUp ? 'Sign up to start your loan application' : 'Sign in to continue your application'}
                </p>
              </div>

              <form onSubmit={handleCredentials} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent transition-shadow"
                    placeholder="your@email.com"
                    required
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">Password</label>
                    {!isSignUp && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!email) { setError('Enter your email first'); return; }
                          setError(null);
                          const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
                            redirectTo: `${window.location.origin}/reset-password`,
                          });
                          if (err) { setError(err.message); return; }
                          setError(null);
                          alert('Password reset email sent! Check your inbox.');
                        }}
                        className="text-xs text-teal-600 hover:text-teal-800 transition-colors"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full px-4 py-3 pr-11 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent transition-shadow"
                      placeholder={isSignUp ? 'Create a password (min 6 chars)' : 'Enter your password'}
                      required
                      minLength={6}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">{error}</div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 px-4 bg-teal-600 text-white font-medium rounded-lg hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:ring-offset-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 group"
                >
                  {isLoading ? (
                    <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /><span>{isSignUp ? 'Creating account...' : 'Signing in...'}</span></>
                  ) : (
                    <><span>{isSignUp ? 'Continue' : 'Sign In'}</span><ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" /></>
                  )}
                </button>
              </form>

              <div className="mt-8 pt-6 border-t border-gray-200">
                <button
                  onClick={() => { setIsSignUp(!isSignUp); setError(null); }}
                  className="text-sm text-gray-600 hover:text-teal-600 transition-colors"
                >
                  {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-2xl font-semibold text-gray-900 tracking-tight">Your Information</h2>
                <p className="text-gray-500 mt-2">We need these details to verify your identity and pre-qualify you.</p>
              </div>

              <form onSubmit={handleProfile} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
                    <input
                      type="text"
                      value={firstName}
                      onChange={e => setFirstName(e.target.value)}
                      className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                      placeholder="John"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
                    <input
                      type="text"
                      value={lastName}
                      onChange={e => setLastName(e.target.value)}
                      className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                      placeholder="Doe"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cell Phone *</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(formatPhone(e.target.value))}
                    className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                    placeholder="(555) 123-4567"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth *</label>
                    <input
                      type="date"
                      value={dateOfBirth}
                      onChange={e => setDateOfBirth(e.target.value)}
                      className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Credit Score *</label>
                    <input
                      type="number"
                      value={creditScore}
                      onChange={e => setCreditScore(e.target.value)}
                      className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                      placeholder="720"
                      min={300}
                      max={850}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Social Security Number *</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={ssn}
                      onChange={e => setSsn(formatSSN(e.target.value))}
                      className="w-full px-3 py-2.5 pr-10 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                      placeholder="XXX-XX-XXXX"
                      required
                    />
                    <Shield className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-teal-500" />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Encrypted and secure. Used for identity verification only.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Primary Address *</label>
                  <input
                    type="text"
                    value={addressStreet}
                    onChange={e => setAddressStreet(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent mb-2"
                    placeholder="123 Main St"
                    required
                  />
                  <div className="grid grid-cols-6 gap-2">
                    <input
                      type="text"
                      value={addressCity}
                      onChange={e => setAddressCity(e.target.value)}
                      className="col-span-3 px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                      placeholder="City"
                      required
                    />
                    <select
                      value={addressState}
                      onChange={e => setAddressState(e.target.value)}
                      className="col-span-1 px-2 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                      required
                    >
                      <option value="">ST</option>
                      {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <input
                      type="text"
                      value={addressZip}
                      onChange={e => setAddressZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
                      className="col-span-2 px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                      placeholder="Zip"
                      required
                    />
                  </div>
                </div>

                {/* Credit Consent */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={creditConsent}
                      onChange={e => setCreditConsent(e.target.checked)}
                      className="mt-0.5 w-4 h-4 text-teal-600 border-gray-300 rounded focus:ring-teal-500"
                    />
                    <span className="text-xs text-gray-600 leading-relaxed">
                      I authorize Key Real Estate Capital and its affiliates to obtain my credit report from one or more consumer reporting agencies for the purpose of evaluating my eligibility for a mortgage loan. I understand this will be a <strong>soft credit inquiry</strong> that will not affect my credit score. I consent to the collection and use of my personal information, including my Social Security Number, for credit evaluation purposes.
                    </span>
                  </label>
                </div>

                {error && (
                  <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">{error}</div>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setStep('credentials')}
                    className="px-4 py-3 border border-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={isLoading || !profileComplete}
                    className="flex-1 py-3 px-4 bg-teal-600 text-white font-medium rounded-lg hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:ring-offset-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 group"
                  >
                    {isLoading ? (
                      <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /><span>Creating profile...</span></>
                    ) : (
                      <><span>Start Application</span><ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" /></>
                    )}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
