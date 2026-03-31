import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  Link2, Copy, Check, Save, Upload, Image, Loader2, AlertCircle, CheckCircle2
} from 'lucide-react';

export function BrokerSettingsPage() {
  const { user, userAccount } = useAuth();
  const [posSlug, setPosSlug] = useState('');
  const [originalSlug, setOriginalSlug] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  useEffect(() => {
    async function loadData() {
      if (!user || !userAccount) return;
      setPosSlug(userAccount.pos_slug || '');
      setOriginalSlug(userAccount.pos_slug || '');

      // Load org data
      const { data: orgMember } = await supabase
        .from('organization_members')
        .select('organization_id, organizations(id, name, zapier_webhook_url, logo_url)')
        .eq('user_id', user.id)
        .maybeSingle();

      if (orgMember?.organizations) {
        const org = orgMember.organizations as { id: string; name: string; zapier_webhook_url: string | null; logo_url: string | null };
        setOrgId(org.id);
        setOrgName(org.name || '');
        setWebhookUrl(org.zapier_webhook_url || '');
        setLogoUrl(org.logo_url || null);
      }
      setIsLoading(false);
    }
    loadData();
  }, [user, userAccount]);

  const fullPosUrl = posSlug ? `${window.location.origin}/apply/${posSlug}` : '';

  const handleCopy = () => {
    navigator.clipboard.writeText(fullPosUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const validateSlug = (slug: string) => {
    if (!slug) return 'Slug cannot be empty';
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return 'Only lowercase letters, numbers, and hyphens allowed';
    if (slug.length < 3) return 'Must be at least 3 characters';
    if (slug.length > 50) return 'Must be 50 characters or less';
    return null;
  };

  const handleSaveSlug = async () => {
    const error = validateSlug(posSlug);
    if (error) { setSlugError(error); return; }
    setSlugError(null);
    setSaving(true);

    // Check uniqueness
    if (posSlug !== originalSlug) {
      const { data: existing } = await supabase
        .from('user_accounts')
        .select('id')
        .eq('pos_slug', posSlug)
        .neq('id', user!.id)
        .maybeSingle();
      if (existing) {
        setSlugError('This slug is already taken');
        setSaving(false);
        return;
      }
    }

    await supabase.from('user_accounts').update({ pos_slug: posSlug }).eq('id', user!.id);
    setOriginalSlug(posSlug);
    setSuccess('POS link updated successfully');
    setTimeout(() => setSuccess(null), 3000);
    setSaving(false);
  };

  const handleSaveWebhook = async () => {
    if (!orgId) return;
    setSaving(true);
    await supabase.from('organizations').update({ zapier_webhook_url: webhookUrl || null }).eq('id', orgId);
    setSuccess('Webhook URL updated');
    setTimeout(() => setSuccess(null), 3000);
    setSaving(false);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !orgId) return;
    setUploadingLogo(true);

    const filePath = `${orgId}/logo_${Date.now()}.${file.name.split('.').pop()}`;
    const { error: uploadError } = await supabase.storage
      .from('organization-logos')
      .upload(filePath, file, { upsert: true });

    if (!uploadError) {
      const { data: urlData } = supabase.storage
        .from('organization-logos')
        .getPublicUrl(filePath);

      const publicUrl = urlData.publicUrl;
      await supabase.from('organizations').update({ logo_url: publicUrl }).eq('id', orgId);
      setLogoUrl(publicUrl);
      setSuccess('Logo updated');
      setTimeout(() => setSuccess(null), 3000);
    }
    setUploadingLogo(false);
    e.target.value = '';
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-teal-600 animate-spin" /></div>;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-semibold text-gray-900 tracking-tight">Settings</h1>
        <p className="text-gray-500 mt-1">Manage your application link, branding, and integrations</p>
      </div>

      {success && (
        <div className="px-4 py-3 bg-green-50 border border-green-100 rounded-lg text-sm text-green-700 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> {success}
        </div>
      )}

      {/* POS Link */}
      <div className="border border-gray-200 rounded-xl bg-white p-6">
        <div className="flex items-center gap-3 mb-4">
          <Link2 className="w-5 h-5 text-teal-600" />
          <h2 className="text-lg font-semibold text-gray-900">Application Link (POS)</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Your Slug</label>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center">
                <span className="px-3 py-2.5 bg-gray-100 border border-r-0 border-gray-200 rounded-l-lg text-sm text-gray-500">{window.location.origin}/apply/</span>
                <input
                  type="text"
                  value={posSlug}
                  onChange={e => { setPosSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); setSlugError(null); }}
                  className="flex-1 px-3 py-2.5 border border-gray-200 rounded-r-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
              <button onClick={handleSaveSlug} disabled={saving || posSlug === originalSlug}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors">
                <Save className="w-4 h-4" /> Save
              </button>
            </div>
            {slugError && <p className="text-xs text-red-600 mt-1">{slugError}</p>}
          </div>

          {fullPosUrl && (
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-lg">
              <code className="text-sm text-teal-600">{fullPosUrl}</code>
              <button onClick={handleCopy} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100">
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Organization Branding */}
      <div className="border border-gray-200 rounded-xl bg-white p-6">
        <div className="flex items-center gap-3 mb-4">
          <Image className="w-5 h-5 text-teal-600" />
          <h2 className="text-lg font-semibold text-gray-900">Organization Branding</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Company Logo</label>
            <div className="flex items-center gap-4">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="w-16 h-16 object-contain border border-gray-200 rounded-lg" />
              ) : (
                <div className="w-16 h-16 bg-gray-100 border border-gray-200 rounded-lg flex items-center justify-center">
                  <Image className="w-6 h-6 text-gray-400" />
                </div>
              )}
              <label className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg cursor-pointer transition-colors ${
                uploadingLogo ? 'bg-gray-100 text-gray-400' : 'bg-teal-50 text-teal-700 hover:bg-teal-100'
              }`}>
                <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                {uploadingLogo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {logoUrl ? 'Change Logo' : 'Upload Logo'}
              </label>
            </div>
            <p className="text-xs text-gray-500 mt-2">This logo appears on pre-approval PDF letters</p>
          </div>
        </div>
      </div>

      {/* Zapier Webhook */}
      <div className="border border-gray-200 rounded-xl bg-white p-6">
        <div className="flex items-center gap-3 mb-4">
          <svg className="w-5 h-5 text-orange-500" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 4.5l3.5 7h-7l3.5-7zm0 15l-3.5-7h7l-3.5 7z"/></svg>
          <h2 className="text-lg font-semibold text-gray-900">Zapier Webhook</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Webhook URL</label>
            <div className="flex gap-2">
              <input
                type="url"
                value={webhookUrl}
                onChange={e => setWebhookUrl(e.target.value)}
                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                placeholder="https://hooks.zapier.com/hooks/catch/..."
              />
              <button onClick={handleSaveWebhook} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors">
                <Save className="w-4 h-4" /> Save
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">Events fired: new borrower, doc upload, liquidity verified, pre-approval, loan submitted, loan approved/declined</p>
          </div>
        </div>
      </div>
    </div>
  );
}
