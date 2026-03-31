import type { ApplicationStatus } from '../types';

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  'draft',
  'in_progress',
  'submitted',
  'pending_review',
  'needs_revision',
  'preapproved',
  'declined',
  'placed',
  'funded',
];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  draft: 'Draft',
  in_progress: 'In Progress',
  submitted: 'Submitted',
  pending_review: 'Pending Review',
  needs_revision: 'Needs Revision',
  preapproved: 'Pre-Approved',
  declined: 'Declined',
  placed: 'Placed',
  funded: 'Funded',
};

export const STATUS_COLORS: Record<ApplicationStatus, { bg: string; text: string; border: string }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-200' },
  in_progress: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
  submitted: { bg: 'bg-cyan-100', text: 'text-cyan-700', border: 'border-cyan-200' },
  pending_review: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' },
  needs_revision: { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200' },
  preapproved: { bg: 'bg-teal-100', text: 'text-teal-700', border: 'border-teal-200' },
  declined: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200' },
  placed: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200' },
  funded: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200' },
};

export const LOAN_TYPE_LABELS: Record<string, string> = {
  purchase: 'Purchase',
  refinance: 'Refinance',
  cash_out_refinance: 'Cash-Out Refinance',
  dscr: 'DSCR / Rental',
  bridge: 'Bridge',
  fix_flip: 'Fix & Flip',
  construction: 'Construction',
  bank_statement: 'Bank Statement',
  commercial: 'Commercial',
  heloc: 'HELOC',
};

export const PROPERTY_TYPE_LABELS: Record<string, string> = {
  single_family: 'Single Family',
  multifamily: 'Multifamily (2-4)',
  multifamily_5plus: 'Multifamily (5+)',
  condo: 'Condo',
  townhome: 'Townhome',
  mixed_use: 'Mixed Use',
  commercial: 'Commercial',
};

export const VALID_STATUS_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  draft: ['in_progress', 'submitted'],
  in_progress: ['submitted', 'draft'],
  submitted: ['pending_review', 'needs_revision'],
  pending_review: ['preapproved', 'needs_revision', 'declined'],
  needs_revision: ['submitted', 'declined'],
  preapproved: ['placed', 'declined'],
  declined: [],
  placed: ['funded'],
  funded: [],
};
