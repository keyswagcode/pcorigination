import type { BorrowerStatus } from '../../shared/types';
import {
  Clock,
  CheckCircle,
  AlertCircle,
  FileText,
  Search,
  XCircle,
  ShieldCheck
} from 'lucide-react';

interface BorrowerStatusBadgeProps {
  status: BorrowerStatus;
  size?: 'sm' | 'md' | 'lg';
}

const statusConfig: Record<BorrowerStatus, {
  label: string;
  color: string;
  bgColor: string;
  icon: typeof Clock;
}> = {
  draft: {
    label: 'Draft',
    color: 'text-gray-600',
    bgColor: 'bg-gray-100',
    icon: FileText
  },
  submitted: {
    label: 'Submitted',
    color: 'text-blue-700',
    bgColor: 'bg-blue-100',
    icon: Clock
  },
  documents_processing: {
    label: 'Processing',
    color: 'text-amber-700',
    bgColor: 'bg-amber-100',
    icon: Clock
  },
  prequalified: {
    label: 'Pre-Approved',
    color: 'text-teal-700',
    bgColor: 'bg-teal-100',
    icon: CheckCircle
  },
  under_review: {
    label: 'Under Review',
    color: 'text-indigo-700',
    bgColor: 'bg-indigo-100',
    icon: Search
  },
  additional_docs_requested: {
    label: 'Docs Requested',
    color: 'text-orange-700',
    bgColor: 'bg-orange-100',
    icon: AlertCircle
  },
  approved: {
    label: 'Approved',
    color: 'text-green-700',
    bgColor: 'bg-green-100',
    icon: ShieldCheck
  },
  conditionally_approved: {
    label: 'Conditionally Approved',
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-100',
    icon: CheckCircle
  },
  declined: {
    label: 'Declined',
    color: 'text-red-700',
    bgColor: 'bg-red-100',
    icon: XCircle
  }
};

export function BorrowerStatusBadge({ status, size = 'md' }: BorrowerStatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.draft;
  const Icon = config.icon;

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
    lg: 'text-sm px-3 py-1.5'
  };

  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-3.5 h-3.5',
    lg: 'w-4 h-4'
  };

  return (
    <span className={`inline-flex items-center gap-1.5 font-medium rounded-full ${config.bgColor} ${config.color} ${sizeClasses[size]}`}>
      <Icon className={iconSizes[size]} />
      {config.label}
    </span>
  );
}
