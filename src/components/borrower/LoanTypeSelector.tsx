import { Building2, Hammer, FileText, HelpCircle, CheckCircle, ArrowRight } from 'lucide-react';
import { LOAN_TYPE_DOCUMENT_CONFIG, type BorrowerLoanType } from '../../lib/loanTypeDocuments';

interface LoanTypeOption {
  id: BorrowerLoanType;
  icon: typeof Building2;
  color: string;
  bgColor: string;
  borderColor: string;
}

const LOAN_TYPE_OPTIONS: LoanTypeOption[] = [
  {
    id: 'dscr',
    icon: Building2,
    color: 'text-teal-600',
    bgColor: 'bg-teal-50',
    borderColor: 'border-teal-200',
  },
  {
    id: 'fix_flip',
    icon: Hammer,
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
  },
  {
    id: 'bank_statement',
    icon: FileText,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
  },
  {
    id: 'not_sure',
    icon: HelpCircle,
    color: 'text-gray-600',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
  },
];

interface LoanTypeSelectorProps {
  selectedType: BorrowerLoanType | null;
  onSelect: (type: BorrowerLoanType) => void;
  onContinue?: () => void;
  showContinue?: boolean;
}

export function LoanTypeSelector({
  selectedType,
  onSelect,
  onContinue,
  showContinue = true,
}: LoanTypeSelectorProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">What type of loan are you looking for?</h2>
        <p className="text-gray-500">
          This helps us show you the right documents to upload and determine your pre-approval.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {LOAN_TYPE_OPTIONS.map((option) => {
          const config = LOAN_TYPE_DOCUMENT_CONFIG[option.id];
          const isSelected = selectedType === option.id;
          const Icon = option.icon;

          return (
            <button
              key={option.id}
              onClick={() => onSelect(option.id)}
              className={`relative p-5 rounded-xl border-2 text-left transition-all ${
                isSelected
                  ? `${option.borderColor} ${option.bgColor} ring-2 ring-offset-2 ring-teal-500`
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              {isSelected && (
                <div className="absolute top-3 right-3">
                  <CheckCircle className="w-5 h-5 text-teal-600" />
                </div>
              )}

              <div className={`w-10 h-10 rounded-lg ${option.bgColor} flex items-center justify-center mb-3`}>
                <Icon className={`w-5 h-5 ${option.color}`} />
              </div>

              <h3 className="font-semibold text-gray-900 mb-1">{config.label}</h3>
              <p className="text-sm text-gray-500 mb-3">{config.description}</p>

              <div className="text-xs text-gray-400">
                Reserves: {config.liquidityRule.multiplier}x {config.liquidityRule.description}
              </div>
            </button>
          );
        })}
      </div>

      {selectedType && (
        <LoanTypeDetails loanType={selectedType} />
      )}

      {showContinue && selectedType && onContinue && (
        <button
          onClick={onContinue}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 transition-colors"
        >
          Continue to Document Upload
          <ArrowRight className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}

interface LoanTypeDetailsProps {
  loanType: BorrowerLoanType;
}

export function LoanTypeDetails({ loanType }: LoanTypeDetailsProps) {
  const config = LOAN_TYPE_DOCUMENT_CONFIG[loanType];

  return (
    <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
      <h4 className="font-medium text-gray-900 mb-3">
        What you'll need for {config.label} pre-approval:
      </h4>

      <div className="space-y-4">
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Required Documents</p>
          <ul className="space-y-2">
            {config.documents
              .filter(d => d.required)
              .map((doc) => (
                <li key={doc.type} className="flex items-start gap-2 text-sm">
                  <CheckCircle className="w-4 h-4 text-teal-500 mt-0.5 flex-shrink-0" />
                  <span className="text-gray-700">
                    {doc.label}
                    {doc.preferred && (
                      <span className="text-gray-400 ml-1">({doc.preferred})</span>
                    )}
                  </span>
                </li>
              ))}
          </ul>
        </div>

        {config.documents.some(d => !d.required) && (
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Optional Documents</p>
            <ul className="space-y-2">
              {config.documents
                .filter(d => !d.required)
                .map((doc) => (
                  <li key={doc.type} className="flex items-start gap-2 text-sm">
                    <div className="w-4 h-4 rounded-full border border-gray-300 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-500">{doc.label}</span>
                  </li>
                ))}
            </ul>
          </div>
        )}

        <div className="pt-3 border-t border-gray-200">
          <p className="text-sm text-gray-600">
            <span className="font-medium text-gray-700">Reserve Requirement:</span>{' '}
            {config.liquidityRule.multiplier}x {config.liquidityRule.description}
          </p>
        </div>
      </div>
    </div>
  );
}
