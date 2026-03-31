import { CheckCircle, User, FileText, Upload, Clock, Briefcase, ArrowRight } from 'lucide-react';
import { getLoanTypeConfig, type BorrowerLoanType } from '../../lib/loanTypeDocuments';

export type LifecycleStage =
  | 'profile_created'
  | 'loan_type_selected'
  | 'documents_uploaded'
  | 'liquidity_verified'
  | 'pre_approved'
  | 'application_started'
  | 'application_submitted';

interface ProgressStep {
  id: LifecycleStage;
  label: string;
  shortLabel: string;
  icon: typeof User;
}

const PROGRESS_STEPS: ProgressStep[] = [
  { id: 'profile_created', label: 'Complete Profile', shortLabel: 'Profile', icon: User },
  { id: 'loan_type_selected', label: 'Select Loan Type', shortLabel: 'Loan Type', icon: FileText },
  { id: 'documents_uploaded', label: 'Upload Documents', shortLabel: 'Documents', icon: Upload },
  { id: 'liquidity_verified', label: 'Under Review', shortLabel: 'Review', icon: Clock },
  { id: 'pre_approved', label: 'Pre-Approval', shortLabel: 'Pre-Approval', icon: CheckCircle },
  { id: 'application_started', label: 'Start Application', shortLabel: 'Application', icon: Briefcase },
];

const STAGE_ORDER: LifecycleStage[] = [
  'profile_created',
  'loan_type_selected',
  'documents_uploaded',
  'liquidity_verified',
  'pre_approved',
  'application_started',
  'application_submitted',
];

function getStageIndex(stage: LifecycleStage): number {
  return STAGE_ORDER.indexOf(stage);
}

interface BorrowerProgressTrackerProps {
  currentStage: LifecycleStage;
  loanType?: BorrowerLoanType | string | null;
  onStepClick?: (stage: LifecycleStage) => void;
  compact?: boolean;
}

export function BorrowerProgressTracker({
  currentStage,
  loanType,
  onStepClick,
  compact = false,
}: BorrowerProgressTrackerProps) {
  const currentIndex = getStageIndex(currentStage);
  const loanConfig = getLoanTypeConfig(loanType as BorrowerLoanType);

  if (compact) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">Your Progress</h3>
          <span className="text-xs text-teal-600 font-medium">
            {Math.round((currentIndex / (PROGRESS_STEPS.length - 1)) * 100)}% Complete
          </span>
        </div>

        <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-4">
          <div
            className="h-full bg-teal-500 rounded-full transition-all duration-500"
            style={{ width: `${(currentIndex / (PROGRESS_STEPS.length - 1)) * 100}%` }}
          />
        </div>

        <div className="space-y-2">
          {PROGRESS_STEPS.map((step, index) => {
            const isCompleted = index < currentIndex;
            const isCurrent = index === currentIndex;
            const Icon = step.icon;

            return (
              <button
                key={step.id}
                onClick={() => onStepClick?.(step.id)}
                disabled={index > currentIndex}
                className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors ${
                  isCurrent
                    ? 'bg-teal-50 border border-teal-200'
                    : isCompleted
                    ? 'hover:bg-gray-50'
                    : 'opacity-50 cursor-not-allowed'
                }`}
              >
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                    isCompleted
                      ? 'bg-teal-500 text-white'
                      : isCurrent
                      ? 'bg-teal-500 text-white'
                      : 'bg-gray-200 text-gray-400'
                  }`}
                >
                  {isCompleted ? (
                    <CheckCircle className="w-4 h-4" />
                  ) : (
                    <Icon className="w-3 h-3" />
                  )}
                </div>
                <span
                  className={`text-sm ${
                    isCurrent ? 'font-medium text-teal-700' : isCompleted ? 'text-gray-700' : 'text-gray-400'
                  }`}
                >
                  {step.shortLabel}
                </span>
                {isCurrent && (
                  <ArrowRight className="w-4 h-4 text-teal-500 ml-auto" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Loan Journey Progress</h2>
        {loanType && loanType !== 'not_sure' && (
          <span className="px-3 py-1 bg-teal-50 text-teal-700 rounded-full text-sm font-medium">
            {loanConfig.label} Loan
          </span>
        )}
      </div>

      <div className="relative">
        <div className="absolute top-5 left-0 right-0 h-0.5 bg-gray-200" />
        <div
          className="absolute top-5 left-0 h-0.5 bg-teal-500 transition-all duration-500"
          style={{
            width: `${(currentIndex / (PROGRESS_STEPS.length - 1)) * 100}%`,
          }}
        />

        <div className="relative flex justify-between">
          {PROGRESS_STEPS.map((step, index) => {
            const isCompleted = index < currentIndex;
            const isCurrent = index === currentIndex;
            const Icon = step.icon;

            return (
              <button
                key={step.id}
                onClick={() => onStepClick?.(step.id)}
                disabled={index > currentIndex}
                className="flex flex-col items-center group"
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                    isCompleted
                      ? 'bg-teal-500 text-white'
                      : isCurrent
                      ? 'bg-teal-500 text-white ring-4 ring-teal-100'
                      : 'bg-gray-200 text-gray-400'
                  } ${index <= currentIndex ? 'group-hover:scale-110' : ''}`}
                >
                  {isCompleted ? <CheckCircle className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                </div>
                <span
                  className={`mt-3 text-xs font-medium text-center max-w-[80px] ${
                    isCurrent ? 'text-teal-700' : isCompleted ? 'text-gray-700' : 'text-gray-400'
                  }`}
                >
                  {step.shortLabel}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {loanType && currentIndex >= 1 && currentIndex < 4 && (
        <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-sm text-gray-600">{loanConfig.preApprovalNote}</p>
        </div>
      )}
    </div>
  );
}

export function getNextStageAction(stage: LifecycleStage): { label: string; description: string } | null {
  switch (stage) {
    case 'profile_created':
      return { label: 'Select Loan Type', description: 'Choose the type of loan that best fits your needs' };
    case 'loan_type_selected':
      return { label: 'Upload Documents', description: 'Upload your financial documents to get started' };
    case 'documents_uploaded':
      return { label: 'Under Review', description: 'Your documents are being reviewed' };
    case 'liquidity_verified':
      return { label: 'View Pre-Approval', description: 'Review your pre-approval status' };
    case 'pre_approved':
      return { label: 'Start Loan Application', description: 'Begin your formal loan application' };
    case 'application_started':
      return { label: 'Complete Application', description: 'Finish and submit your loan application' };
    case 'application_submitted':
      return null;
    default:
      return null;
  }
}

export { getStageIndex, STAGE_ORDER, PROGRESS_STEPS };
