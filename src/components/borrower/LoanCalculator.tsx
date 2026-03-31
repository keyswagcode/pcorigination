import { useState } from 'react';
import { X, Calculator, DollarSign } from 'lucide-react';
import { formatCurrency, formatInputCurrency, parseCurrency } from '../../shared/utils';

interface LoanCalculatorProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LoanCalculator({ isOpen, onClose }: LoanCalculatorProps) {
  const [loanAmount, setLoanAmount] = useState('');
  const [interestRate, setInterestRate] = useState('8.0');
  const [loanTerm, setLoanTerm] = useState('30');

  if (!isOpen) return null;

  const principal = parseCurrency(loanAmount);
  const annualRate = parseFloat(interestRate) / 100;
  const termMonths = parseInt(loanTerm) * 12;

  const monthlyPayment = (() => {
    if (!principal || !annualRate || !termMonths) return 0;
    const r = annualRate / 12;
    return (principal * r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1);
  })();

  const totalPayment = monthlyPayment * termMonths;
  const totalInterest = totalPayment - principal;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-teal-600" />
            <h2 className="text-lg font-semibold text-gray-900">Loan Calculator</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Loan Amount</label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={loanAmount}
                onChange={e => setLoanAmount(formatInputCurrency(e.target.value))}
                placeholder="500,000"
                className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Interest Rate (%)</label>
              <input
                type="number"
                value={interestRate}
                onChange={e => setInterestRate(e.target.value)}
                step="0.1"
                min="0"
                max="30"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Term (years)</label>
              <select
                value={loanTerm}
                onChange={e => setLoanTerm(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                <option value="10">10 years</option>
                <option value="15">15 years</option>
                <option value="20">20 years</option>
                <option value="25">25 years</option>
                <option value="30">30 years</option>
              </select>
            </div>
          </div>

          {monthlyPayment > 0 && (
            <div className="bg-gradient-to-br from-teal-600 to-teal-700 rounded-xl p-5 text-white">
              <p className="text-teal-200 text-sm mb-1">Monthly Payment</p>
              <p className="text-3xl font-bold">{formatCurrency(monthlyPayment)}</p>

              <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-teal-500">
                <div>
                  <p className="text-teal-200 text-xs">Total Principal</p>
                  <p className="font-semibold">{formatCurrency(principal)}</p>
                </div>
                <div>
                  <p className="text-teal-200 text-xs">Total Interest</p>
                  <p className="font-semibold">{formatCurrency(totalInterest)}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
