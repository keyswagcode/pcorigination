import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  Link2, Copy, Check, Save, Upload, Image, Loader2, AlertCircle, CheckCircle2,
  UserPlus, Users, Trash2, Shield, Star, Pencil, X
} from 'lucide-react';
import { inviteTeamMember } from '../../services/teamInviteService';
import { saveIscCredentials, clearIscCredentials } from '../../services/iscCreditService';
import { saveValoraCredentials, clearValoraCredentials } from '../../services/valoraAppraisalService';

/** Determine if currentUser can edit targetMember */
function canEditMember(currentRole: string, currentUserId: string, targetMember: { user_id: string; role: string | null; invited_by_user_id?: string | null }): boolean {
  const targetRole = targetMember.role || 'ae';
  // Nobody can edit the owner except themselves
  if (targetRole === 'owner') return currentUserId === targetMember.user_id;
  // Can't edit yourself via this flow (use profile)
  if (currentUserId === targetMember.user_id) return false;
  // Owner can edit everyone
  if (currentRole === 'owner') return true;
  // Admin can edit VPs and AEs (not other admins or owner)
  if (currentRole === 'admin') return targetRole === 'vp' || targetRole === 'ae';
  // VP can edit their own invitees
  if (currentRole === 'vp') return targetMember.invited_by_user_id === currentUserId;
  return false;
}

/** Determine if currentUser can invite new members */
function canInviteMembers(currentRole: string): boolean {
  return ['owner', 'admin', 'vp'].includes(currentRole);
}

export function BrokerSettingsPage() {
  const { user, userAccount, refreshUserAccount } = useAuth();
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
  const [error, setError] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // ISC Credit
  const [iscUsername, setIscUsername] = useState('');
  const [iscPassword, setIscPassword] = useState('');
  const [savingIsc, setSavingIsc] = useState(false);
  const iscConnected = !!userAccount?.isc_username;

  const handleSaveIsc = async () => {
    if (!iscUsername || !iscPassword) return;
    setSavingIsc(true);
    setError(null);
    try {
      await saveIscCredentials(iscUsername, iscPassword);
      await refreshUserAccount();
      setIscPassword('');
      setSuccess('ISC credentials saved');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save ISC credentials');
    } finally {
      setSavingIsc(false);
    }
  };

  const handleDisconnectIsc = async () => {
    setSavingIsc(true);
    setError(null);
    try {
      await clearIscCredentials();
      await refreshUserAccount();
      setIscUsername('');
      setIscPassword('');
      setSuccess('ISC credentials removed');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove ISC credentials');
    } finally {
      setSavingIsc(false);
    }
  };

  // Valora AMC
  const [valoraUsername, setValoraUsername] = useState('');
  const [valoraPassword, setValoraPassword] = useState('');
  const [savingValora, setSavingValora] = useState(false);
  const valoraConnected = !!userAccount?.valora_username;

  const handleSaveValora = async () => {
    if (!valoraUsername || !valoraPassword) return;
    setSavingValora(true);
    setError(null);
    try {
      await saveValoraCredentials(valoraUsername, valoraPassword);
      await refreshUserAccount();
      setValoraPassword('');
      setSuccess('Valora credentials saved');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Valora credentials');
    } finally {
      setSavingValora(false);
    }
  };

  const handleDisconnectValora = async () => {
    setSavingValora(true);
    setError(null);
    try {
      await clearValoraCredentials();
      await refreshUserAccount();
      setValoraUsername('');
      setValoraPassword('');
      setSuccess('Valora credentials removed');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove Valora credentials');
    } finally {
      setSavingValora(false);
    }
  };

  // Team members
  interface TeamMember {
    id: string;
    user_id: string;
    display_name: string | null;
    email: string | null;
    role: string | null;
    invite_status: string | null;
    notify_new_apps: boolean;
    invited_by_user_id: string | null;
  }
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const currentMember = teamMembers.find(m => m.user_id === user?.id);
  const myRole = currentMember?.role || 'ae';
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFirstName, setInviteFirstName] = useState('');
  const [inviteLastName, setInviteLastName] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'vp' | 'ae'>('ae');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ email: string; tempPassword: string } | null>(null);

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

        // Load team members
        const { data: members } = await supabase
          .from('organization_members')
          .select('id, user_id, display_name, email, role, invite_status, notify_new_apps, invited_by_user_id')
          .eq('organization_id', org.id)
          .eq('is_active', true);
        setTeamMembers(members || []);
      } else {
        // Auto-create organization for this broker
        const brokerName = [userAccount.first_name, userAccount.last_name].filter(Boolean).join(' ');
        const { data: newOrg } = await supabase
          .from('organizations')
          .insert({ name: `${brokerName}'s Organization`, slug: userAccount.pos_slug || undefined })
          .select('id')
          .single();

        if (newOrg) {
          await supabase.from('organization_members').insert({
            user_id: user.id,
            organization_id: newOrg.id,
            role: 'owner',
            display_name: brokerName,
            email: userAccount.email,
            is_active: true,
            invite_status: 'active',
          });
          setOrgId(newOrg.id);
          setOrgName(`${brokerName}'s Organization`);
        }
      }
      setIsLoading(false);
    }
    loadData();
  }, [user, userAccount]);

  const loadTeamMembers = async () => {
    if (!orgId) return;
    const { data } = await supabase
      .from('organization_members')
      .select('id, user_id, display_name, email, role, invite_status, notify_new_apps, invited_by_user_id')
      .eq('organization_id', orgId)
      .eq('is_active', true);
    setTeamMembers(data || []);
  };

  const handleInvite = async () => {
    if (!inviteEmail || !inviteFirstName || !inviteLastName) return;
    setInviting(true);
    setError(null);
    setInviteResult(null);

    try {
      const result = await inviteTeamMember({
        email: inviteEmail,
        firstName: inviteFirstName,
        lastName: inviteLastName,
        brokerRole: inviteRole,
        organizationId: orgId,
      });

      if (!result.success) throw new Error(result.error || 'Failed to invite');

      setInviteResult({ email: inviteEmail, tempPassword: result.tempPassword });
      setSuccess(`Invited ${inviteFirstName} ${inviteLastName} as ${inviteRole.toUpperCase()}`);
      setTimeout(() => setSuccess(null), 5000);
      setInviteEmail('');
      setInviteFirstName('');
      setInviteLastName('');
      setShowInviteForm(false);
      await loadTeamMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite team member');
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    await supabase.from('organization_members').update({ is_active: false }).eq('id', memberId);
    await loadTeamMembers();
  };

  const handleToggleNotify = async (memberId: string, current: boolean) => {
    await supabase.from('organization_members').update({ notify_new_apps: !current }).eq('id', memberId);
    await loadTeamMembers();
  };

  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editMemberName, setEditMemberName] = useState('');
  const [editMemberEmail, setEditMemberEmail] = useState('');
  const [editMemberRole, setEditMemberRole] = useState('');

  const startEditMember = (member: TeamMember) => {
    setEditingMemberId(member.id);
    setEditMemberName(member.display_name || '');
    setEditMemberEmail(member.email || '');
    setEditMemberRole(member.role || 'ae');
  };

  const userRoleForBrokerRole = (brokerRole: string): 'admin' | 'broker' => {
    return brokerRole === 'admin' || brokerRole === 'owner' ? 'admin' : 'broker';
  };

  const handleSaveMember = async (memberId: string, userId: string) => {
    await supabase.from('organization_members').update({
      display_name: editMemberName,
      email: editMemberEmail,
      role: editMemberRole,
    }).eq('id', memberId);
    await supabase.from('user_accounts').update({
      first_name: editMemberName.split(' ')[0] || '',
      last_name: editMemberName.split(' ').slice(1).join(' ') || '',
      email: editMemberEmail,
      broker_role: editMemberRole,
      user_role: userRoleForBrokerRole(editMemberRole),
    }).eq('id', userId);
    setEditingMemberId(null);
    await loadTeamMembers();
  };

  const handleChangeRole = async (memberId: string, userId: string, newRole: string) => {
    await supabase.from('organization_members').update({ role: newRole }).eq('id', memberId);
    await supabase.from('user_accounts').update({
      broker_role: newRole,
      user_role: userRoleForBrokerRole(newRole),
    }).eq('id', userId);
    await loadTeamMembers();
  };

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
    await refreshUserAccount();
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

    if (!orgId) {
      setError('No organization found. Please refresh the page.');
      setUploadingLogo(false);
      return;
    }

    const filePath = `${orgId}/logo_${Date.now()}.${file.name.split('.').pop()}`;
    const { error: uploadError } = await supabase.storage
      .from('organization-logos')
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      setError(`Logo upload failed: ${uploadError.message}`);
    } else {
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

      {/* ISC Credit Bureau */}
      <div className="border border-gray-200 rounded-xl bg-white p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h.01M11 15h2m4 4H7a2 2 0 01-2-2V7a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2z"/></svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Credit Pull (ISC)</h2>
              <p className="text-sm text-gray-500">Your personal ISC Credit Bureau login. Used to soft-pull credit on your borrowers.</p>
            </div>
          </div>
          {iscConnected && (
            <span className="px-3 py-1 bg-teal-100 text-teal-700 text-xs font-medium rounded-full">Connected</span>
          )}
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ISC Username</label>
            <input
              type="text"
              value={iscUsername || (iscConnected ? userAccount?.isc_username || '' : '')}
              onChange={e => setIscUsername(e.target.value)}
              autoComplete="off"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
              placeholder="your-isc-login"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ISC Password</label>
            <input
              type="password"
              value={iscPassword}
              onChange={e => setIscPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 font-mono"
              placeholder={iscConnected ? '••••••••• (saved — re-enter to update)' : 'Enter your ISC password'}
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSaveIsc}
              disabled={savingIsc || !iscUsername || !iscPassword}
              className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50"
            >
              {savingIsc ? 'Saving…' : iscConnected ? 'Update Credentials' : 'Save Credentials'}
            </button>
            {iscConnected && (
              <button
                onClick={handleDisconnectIsc}
                disabled={savingIsc}
                className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 disabled:opacity-50"
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Valora AMC */}
      <div className="border border-gray-200 rounded-xl bg-white p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Order Appraisal (Valora AMC)</h2>
              <p className="text-sm text-gray-500">Your personal Valora AMC login. Used to order appraisals straight from a loan.</p>
            </div>
          </div>
          {valoraConnected && (
            <span className="px-3 py-1 bg-teal-100 text-teal-700 text-xs font-medium rounded-full">Connected</span>
          )}
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Valora Username</label>
            <input
              type="text"
              value={valoraUsername || (valoraConnected ? userAccount?.valora_username || '' : '')}
              onChange={e => setValoraUsername(e.target.value)}
              autoComplete="off"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
              placeholder="your-valora-login"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Valora Password</label>
            <input
              type="password"
              value={valoraPassword}
              onChange={e => setValoraPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 font-mono"
              placeholder={valoraConnected ? '••••••••• (saved — re-enter to update)' : 'Enter your Valora password'}
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSaveValora}
              disabled={savingValora || !valoraUsername || !valoraPassword}
              className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50"
            >
              {savingValora ? 'Saving…' : valoraConnected ? 'Update Credentials' : 'Save Credentials'}
            </button>
            {valoraConnected && (
              <button
                onClick={handleDisconnectValora}
                disabled={savingValora}
                className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 disabled:opacity-50"
              >
                Disconnect
              </button>
            )}
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

      {/* Team Management */}
      <div className="border border-gray-200 rounded-xl bg-white p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Users className="w-5 h-5 text-teal-600" />
            <h2 className="text-lg font-semibold text-gray-900">Team Members</h2>
          </div>
          {!showInviteForm && canInviteMembers(myRole) && (
            <button
              onClick={() => { setShowInviteForm(true); setInviteResult(null); }}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              Invite Member
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}

        {/* Invite result with temp password */}
        {inviteResult && (
          <div className="mb-4 px-5 py-5 bg-teal-50 border-2 border-teal-200 rounded-xl">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5 text-teal-600" />
              <p className="text-sm font-semibold text-teal-800">Account created for {inviteResult.email}</p>
            </div>
            <p className="text-xs text-teal-700 mb-3">Share these login credentials with the team member:</p>

            <div className="bg-white rounded-lg border border-teal-200 divide-y divide-teal-100">
              <div className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500">Login URL</p>
                  <code className="text-sm text-teal-700">{window.location.origin}/login</code>
                </div>
                <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/login`)}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-teal-600 bg-teal-50 rounded hover:bg-teal-100">
                  <Copy className="w-3 h-3" /> Copy
                </button>
              </div>
              <div className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500">Email</p>
                  <code className="text-sm text-gray-900">{inviteResult.email}</code>
                </div>
                <button onClick={() => navigator.clipboard.writeText(inviteResult.email)}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-teal-600 bg-teal-50 rounded hover:bg-teal-100">
                  <Copy className="w-3 h-3" /> Copy
                </button>
              </div>
              <div className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500">Temporary Password</p>
                  <code className="text-sm font-bold text-gray-900">{inviteResult.tempPassword}</code>
                </div>
                <button onClick={() => navigator.clipboard.writeText(inviteResult.tempPassword)}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-teal-600 bg-teal-50 rounded hover:bg-teal-100">
                  <Copy className="w-3 h-3" /> Copy
                </button>
              </div>
            </div>

            <button
              onClick={() => {
                const text = `Login URL: ${window.location.origin}/login\nEmail: ${inviteResult.email}\nTemporary Password: ${inviteResult.tempPassword}\n\nPlease change your password after logging in.`;
                navigator.clipboard.writeText(text);
              }}
              className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-teal-700 bg-white border border-teal-200 rounded-lg hover:bg-teal-50 transition-colors"
            >
              <Copy className="w-4 h-4" /> Copy All Credentials
            </button>

            <p className="text-xs text-gray-500 mt-3">An email invite will be sent automatically. You can also share the credentials above directly.</p>
          </div>
        )}

        {/* Invite form */}
        {showInviteForm && (
          <div className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">First Name *</label>
                <input type="text" value={inviteFirstName} onChange={e => setInviteFirstName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="John" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Last Name *</label>
                <input type="text" value={inviteLastName} onChange={e => setInviteLastName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="Doe" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email *</label>
              <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600" placeholder="john@company.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Role *</label>
              <div className="grid grid-cols-3 gap-2">
                {([['admin', 'Admin'], ['vp', 'VP'], ['ae', 'AE']] as const).map(([val, label]) => (
                  <button key={val} type="button" onClick={() => setInviteRole(val)}
                    className={`px-3 py-2 border-2 rounded-lg text-sm font-medium transition-all ${
                      inviteRole === val ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {inviteRole === 'admin' ? 'Can see all borrowers and manage team' :
                 inviteRole === 'vp' ? 'Can see their borrowers + all AEs reporting to them' :
                 'Can only see their own borrowers'}
              </p>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setShowInviteForm(false); setError(null); }}
                className="px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleInvite} disabled={inviting || !inviteEmail || !inviteFirstName || !inviteLastName}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors">
                {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                Send Invite
              </button>
            </div>
          </div>
        )}

        {/* Team member list */}
        {/* Pending Invites */}
        {teamMembers.filter(m => m.invite_status === 'pending').length > 0 && (
          <div className="mb-4">
            <h3 className="text-xs font-semibold text-amber-700 uppercase mb-2">Pending Invites ({teamMembers.filter(m => m.invite_status === 'pending').length})</h3>
            <div className="border border-amber-200 rounded-lg bg-amber-50 divide-y divide-amber-100">
              {teamMembers.filter(m => m.invite_status === 'pending').map(member => (
                <div key={member.id} className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-amber-100 rounded-full flex items-center justify-center">
                      <span className="text-xs font-medium text-amber-700">
                        {(member.display_name || '?').split(' ').map(n => n[0]).join('').slice(0, 2)}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{member.display_name || member.email}</p>
                      <div className="flex items-center gap-2">
                        {member.email && <span className="text-xs text-gray-500">{member.email}</span>}
                        <select
                          value={member.role || 'ae'}
                          onChange={e => handleChangeRole(member.id, member.user_id, e.target.value)}
                          className={`px-1.5 py-0.5 text-xs font-medium rounded border-0 cursor-pointer ${
                            member.role === 'admin' ? 'bg-purple-100 text-purple-700' :
                            member.role === 'vp' ? 'bg-blue-100 text-blue-700' :
                            'bg-gray-100 text-gray-600'
                          }`}
                        >
                          <option value="admin">ADMIN</option>
                          <option value="vp">VP</option>
                          <option value="ae">AE</option>
                        </select>
                        <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-700">Pending</span>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => handleRemoveMember(member.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 transition-colors" title="Cancel invite">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Active Members */}
        {teamMembers.filter(m => m.invite_status !== 'pending').length > 0 && (
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Active Members</h3>
        )}

        {teamMembers.filter(m => m.invite_status !== 'pending').length > 0 ? (
          <div className="divide-y divide-gray-100">
            {teamMembers.filter(m => m.invite_status !== 'pending').map(member => (
              editingMemberId === member.id ? (
                <div key={member.id} className="py-3 px-3 bg-gray-50 rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-500 uppercase">Edit Member</p>
                    <button onClick={() => setEditingMemberId(null)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Name</label>
                      <input type="text" value={editMemberName} onChange={e => setEditMemberName(e.target.value)}
                        className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-600" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Email</label>
                      <input type="email" value={editMemberEmail} onChange={e => setEditMemberEmail(e.target.value)}
                        className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-600" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Role</label>
                    <div className="flex gap-2">
                      {[['admin', 'Admin'], ['vp', 'VP'], ['ae', 'AE']].map(([val, label]) => (
                        <button key={val} type="button" onClick={() => setEditMemberRole(val)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${editMemberRole === val ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-gray-200 bg-white text-gray-600'}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditingMemberId(null)} className="px-3 py-1.5 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg">Cancel</button>
                    <button onClick={() => handleSaveMember(member.id, member.user_id)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700">
                      <Save className="w-3 h-3" /> Save
                    </button>
                  </div>
                </div>
              ) : (
                <div key={member.id} className="py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-gray-100 rounded-full flex items-center justify-center">
                      <Shield className="w-4 h-4 text-gray-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{member.display_name || member.email}</p>
                      <div className="flex items-center gap-2">
                        {member.email && <span className="text-xs text-gray-500">{member.email}</span>}
                        <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${
                          member.role === 'owner' ? 'bg-amber-100 text-amber-700' :
                          member.role === 'admin' ? 'bg-purple-100 text-purple-700' :
                          member.role === 'vp' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>{(member.role || 'ae').toUpperCase()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleToggleNotify(member.id, member.notify_new_apps)}
                      className={`p-1.5 rounded-lg transition-colors ${
                        member.notify_new_apps ? 'text-amber-500 hover:text-amber-600' : 'text-gray-300 hover:text-gray-400'
                      }`}
                      title={member.notify_new_apps ? 'Starred — receives new app alerts' : 'Click to star'}
                    >
                      <Star className={`w-4 h-4 ${member.notify_new_apps ? 'fill-amber-400' : ''}`} />
                    </button>
                    {canEditMember(myRole, user?.id || '', { user_id: member.user_id, role: member.role, invited_by_user_id: member.invited_by_user_id }) && (
                      <>
                        <button onClick={() => startEditMember(member)}
                          className="p-1.5 text-gray-400 hover:text-teal-600 transition-colors" title="Edit member">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleRemoveMember(member.id)}
                          className="p-1.5 text-gray-400 hover:text-red-500 transition-colors" title="Remove member">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-4">No team members yet. Invite your first team member above.</p>
        )}
      </div>
    </div>
  );
}
