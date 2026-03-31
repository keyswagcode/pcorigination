import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import type { Borrower, AnalystDecisionRecord, AnalystDecision } from '../../shared/types';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  FileText,
  Save,
  Loader2,
  Plus,
  X,
  Clock
} from 'lucide-react';

interface AnalystDecisionPanelProps {
  borrower: Borrower;
  decisions: AnalystDecisionRecord[];
  onDecisionSaved: () => void;
}

const DECISION_OPTIONS: { value: AnalystDecision; label: string; icon: typeof CheckCircle; color: string }[] = [
  { value: 'approved', label: 'Approve', icon: CheckCircle, color: 'text-green-600 bg-green-100 border-green-300' },
  { value: 'conditionally_approved', label: 'Conditionally Approve', icon: CheckCircle, color: 'text-emerald-600 bg-emerald-100 border-emerald-300' },
  { value: 'declined', label: 'Decline', icon: XCircle, color: 'text-red-600 bg-red-100 border-red-300' },
  { value: 'additional_docs_requested', label: 'Request Documents', icon: FileText, color: 'text-orange-600 bg-orange-100 border-orange-300' },
];

export function AnalystDecisionPanel({ borrower, decisions, onDecisionSaved }: AnalystDecisionPanelProps) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [selectedDecision, setSelectedDecision] = useState<AnalystDecision | null>(null);
  const [notes, setNotes] = useState('');
  const [conditions, setConditions] = useState<string[]>([]);
  const [newCondition, setNewCondition] = useState('');
  const [approvedAmount, setApprovedAmount] = useState('');

  const handleAddCondition = () => {
    if (newCondition.trim()) {
      setConditions([...conditions, newCondition.trim()]);
      setNewCondition('');
    }
  };

  const handleRemoveCondition = (index: number) => {
    setConditions(conditions.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!selectedDecision || !user) return;

    setSaving(true);
    try {
      await supabase.from('analyst_decisions').insert({
        borrower_id: borrower.id,
        analyst_id: user.id,
        decision: selectedDecision,
        notes: notes || null,
        conditions: conditions.length > 0 ? conditions : null,
        approved_amount: approvedAmount ? parseFloat(approvedAmount) : null
      });

      const statusMap: Record<AnalystDecision, string> = {
        approved: 'approved',
        conditionally_approved: 'conditionally_approved',
        declined: 'declined',
        additional_docs_requested: 'additional_docs_requested'
      };

      await supabase
        .from('borrowers')
        .update({ borrower_status: statusMap[selectedDecision] })
        .eq('id', borrower.id);

      setSelectedDecision(null);
      setNotes('');
      setConditions([]);
      setApprovedAmount('');
      onDecisionSaved();
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = (amount: number | null) => {
    if (!amount) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(amount);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-gray-900 mb-4">Make Decision</h3>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {DECISION_OPTIONS.map(option => {
            const Icon = option.icon;
            const isSelected = selectedDecision === option.value;
            return (
              <button
                key={option.value}
                onClick={() => setSelectedDecision(option.value)}
                className={`p-4 rounded-lg border-2 transition-all ${
                  isSelected
                    ? option.color
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <Icon className={`w-6 h-6 mx-auto mb-2 ${isSelected ? '' : 'text-gray-400'}`} />
                <p className={`text-sm font-medium ${isSelected ? '' : 'text-gray-600'}`}>
                  {option.label}
                </p>
              </button>
            );
          })}
        </div>

        {selectedDecision && (
          <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
            {(selectedDecision === 'approved' || selectedDecision === 'conditionally_approved') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Approved Amount ($)
                </label>
                <input
                  type="number"
                  value={approvedAmount}
                  onChange={e => setApprovedAmount(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  placeholder="Enter approved loan amount"
                />
              </div>
            )}

            {(selectedDecision === 'conditionally_approved' || selectedDecision === 'additional_docs_requested') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {selectedDecision === 'conditionally_approved' ? 'Conditions' : 'Required Documents'}
                </label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={newCondition}
                    onChange={e => setNewCondition(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddCondition()}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                    placeholder={selectedDecision === 'conditionally_approved' ? 'Add a condition...' : 'Add a required document...'}
                  />
                  <button
                    onClick={handleAddCondition}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
                {conditions.length > 0 && (
                  <ul className="space-y-2">
                    {conditions.map((condition, index) => (
                      <li key={index} className="flex items-center gap-2 bg-white p-2 rounded border border-gray-200">
                        <span className="flex-1 text-sm text-gray-700">{condition}</span>
                        <button
                          onClick={() => handleRemoveCondition(index)}
                          className="p-1 text-gray-400 hover:text-red-500"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes (Internal)
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Add any internal notes about this decision..."
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Submit Decision
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {decisions.length > 0 && (
        <div>
          <h3 className="font-semibold text-gray-900 mb-4">Decision History</h3>
          <div className="space-y-3">
            {decisions.map(decision => {
              const option = DECISION_OPTIONS.find(o => o.value === decision.decision);
              const Icon = option?.icon || Clock;

              return (
                <div
                  key={decision.id}
                  className="p-4 bg-white border border-gray-200 rounded-lg"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <Icon className={`w-5 h-5 ${
                        decision.decision === 'approved' ? 'text-green-500' :
                        decision.decision === 'conditionally_approved' ? 'text-emerald-500' :
                        decision.decision === 'declined' ? 'text-red-500' :
                        'text-orange-500'
                      }`} />
                      <div>
                        <p className="font-medium text-gray-900 capitalize">
                          {decision.decision.replace('_', ' ')}
                        </p>
                        <p className="text-sm text-gray-500">
                          {new Date(decision.created_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    {decision.approved_amount && (
                      <span className="font-medium text-gray-900">
                        {formatCurrency(decision.approved_amount)}
                      </span>
                    )}
                  </div>

                  {decision.conditions && decision.conditions.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <p className="text-xs font-medium text-gray-500 mb-2">Conditions:</p>
                      <ul className="space-y-1">
                        {decision.conditions.map((condition, i) => (
                          <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                            {condition}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {decision.notes && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <p className="text-xs font-medium text-gray-500 mb-1">Notes:</p>
                      <p className="text-sm text-gray-600">{decision.notes}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
