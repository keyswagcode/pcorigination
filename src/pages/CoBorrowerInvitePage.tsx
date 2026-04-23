import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowRight, Building2, Shield, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1';
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function callFunction(body: Record<string, unknown>) {
  const res = await fetch(`${FUNCTIONS_URL}/co-borrower-invite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
];

interface InviteData {
  co_borrower_name: string;
  co_borrower_email: string;
  inviter_name: string;
  status: string;
}

export function CoBorrowerInvitePage() {
  const { token } = useParams<{ token: string }>();

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<InviteData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [ssn, setSsn] = useState('');
  const [creditScore, setCreditScore] = useState('');
  const [addressStreet, setAddressStreet] = useState('');
  const [addressCity, setAddressCity] = useState('');
  const [addressState, setAddressState] = useState('');
  const [addressZip, setAddressZip] = useState('');
  const [consent, setConsent] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!token) { setLoadError('Missing invite token'); setLoading(false); return; }
    callFunction({ action: 'get', invite_token: token })
      .then((data: InviteData) => {
        setInvite(data);
        setEmail(data.co_borrower_email || '');
        const nameParts = (data.co_borrower_name || '').trim().split(/\s+/);
        setFirstName(nameParts[0] || '');
        setLastName(nameParts.slice(1).join(' ') || '');
        if (data.status === 'completed') setSubmitted(true);
      })
      .catch(err => setLoadError(err instanceof Error ? err.message : 'Invite not found'))
      .finally(() => setLoading(false));
  }, [token]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      await callFunction({
        action: 'submit',
        invite_token: token,
        borrower_name: `${firstName} ${lastName}`.trim(),
        email,
        phone,
        date_of_birth: dateOfBirth,
        ssn,
        credit_score: creditScore,
        address_street: addressStreet,
        address_city: addressCity,
        address_state: addressState,
        address_zip: addressZip,
      });
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  const formComplete = firstName && lastName && email && phone && dateOfBirth
    && ssn.replace(/\D/g, '').length === 9 && creditScore
    && addressStreet && addressCity && addressState && addressZip && consent;

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
      </div>
    );
  }

  if (loadError || !invite) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">Invite Not Found</h1>
          <p className="text-gray-500">This invite link is invalid or has expired. Please ask the primary borrower to resend the invite.</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-teal-600" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">Thanks!</h1>
          <p className="text-gray-500">Your information has been sent to {invite.inviter_name}. You can close this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex">
      {/* Left panel */}
      <div className="hidden lg:flex w-1/2 bg-teal-950 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-teal-900 via-teal-950 to-black" />
        <div className="relative z-10 flex flex-col justify-between p-12 h-full">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center">
              <Building2 className="w-6 h-6 text-teal-950" />
            </div>
            <span className="text-white font-medium text-lg tracking-tight">Co-Borrower Invite</span>
          </div>

          <div className="space-y-8">
            <h1 className="text-5xl font-light text-white leading-tight tracking-tight">
              You've been invited as a<br /><span className="font-semibold">co-borrower</span>
            </h1>
            <p className="text-teal-300 text-lg max-w-md leading-relaxed">
              {invite.inviter_name} added you to their loan application. We just need a few details from you to move things forward.
            </p>
            <div className="bg-teal-900/50 border border-teal-800 rounded-lg px-5 py-4">
              <p className="text-teal-200 text-sm">Invited by</p>
              <p className="text-white font-medium text-lg">{invite.inviter_name}</p>
            </div>
          </div>

          <div className="flex items-center gap-8 text-teal-500 text-sm">
            <span>Secure & Encrypted</span>
            <span className="w-1 h-1 bg-teal-700 rounded-full" />
            <span>~2 minutes</span>
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex w-full lg:w-1/2 items-center justify-center p-8 bg-neutral-50">
        <div className="w-full max-w-sm py-8">
          <div className="lg:hidden mb-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 bg-teal-600 rounded-lg flex items-center justify-center">
                <Building2 className="w-5 h-5 text-white" />
              </div>
              <span className="text-gray-900 font-medium tracking-tight">Co-Borrower Invite</span>
            </div>
            <div className="bg-teal-50 border border-teal-100 rounded-lg px-4 py-3 mb-4">
              <p className="text-teal-600 text-sm">Invited by <span className="font-medium">{invite.inviter_name}</span></p>
            </div>
          </div>

          <div className="mb-6">
            <h2 className="text-2xl font-semibold text-gray-900 tracking-tight">Your Information</h2>
            <p className="text-gray-500 mt-2">We need these details to verify your identity and add you to the application.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
                <input
                  type="text" value={firstName} onChange={e => setFirstName(e.target.value)}
                  className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                  placeholder="Jane" required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
                <input
                  type="text" value={lastName} onChange={e => setLastName(e.target.value)}
                  className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                  placeholder="Doe" required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                placeholder="you@email.com" required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cell Phone *</label>
              <input
                type="tel" value={phone} onChange={e => setPhone(formatPhone(e.target.value))}
                className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                placeholder="(555) 123-4567" required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth *</label>
                <input
                  type="date" value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)}
                  className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Credit Score *</label>
                <input
                  type="number" value={creditScore} onChange={e => setCreditScore(e.target.value)}
                  className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                  placeholder="720" min={300} max={850} required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Social Security Number *</label>
              <div className="relative">
                <input
                  type="text" value={ssn} onChange={e => setSsn(formatSSN(e.target.value))}
                  className="w-full px-3 py-2.5 pr-10 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                  placeholder="XXX-XX-XXXX" required
                />
                <Shield className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-teal-500" />
              </div>
              <p className="text-xs text-gray-400 mt-1">Encrypted and secure. Used for identity verification only.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Primary Address *</label>
              <input
                type="text" value={addressStreet} onChange={e => setAddressStreet(e.target.value)}
                className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent mb-2"
                placeholder="123 Main St" required
              />
              <div className="grid grid-cols-6 gap-2">
                <input
                  type="text" value={addressCity} onChange={e => setAddressCity(e.target.value)}
                  className="col-span-3 px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                  placeholder="City" required
                />
                <select
                  value={addressState} onChange={e => setAddressState(e.target.value)}
                  className="col-span-1 px-2 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                  required
                >
                  <option value="">ST</option>
                  {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <input
                  type="text" value={addressZip}
                  onChange={e => setAddressZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
                  className="col-span-2 px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent"
                  placeholder="Zip" required
                />
              </div>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}
                  className="mt-0.5 w-4 h-4 text-teal-600 border-gray-300 rounded focus:ring-teal-500"
                />
                <span className="text-xs text-gray-600 leading-relaxed">
                  I authorize Key Real Estate Capital to use my information, including my SSN, for purposes of evaluating this loan application. I understand any credit inquiry will be a soft pull that will not affect my credit score.
                </span>
              </label>
            </div>

            {submitError && (
              <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">{submitError}</div>
            )}

            <button
              type="submit"
              disabled={submitting || !formComplete}
              className="w-full py-3 px-4 bg-teal-600 text-white font-medium rounded-lg hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:ring-offset-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 group"
            >
              {submitting ? (
                <><Loader2 className="w-4 h-4 animate-spin" /><span>Submitting...</span></>
              ) : (
                <><span>Submit Information</span><ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" /></>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
