interface ConfidenceBarProps {
  value: number;
  label?: string;
  height?: string;
  showLabel?: boolean;
}

export function ConfidenceBar({ value, label, height = 'h-2', showLabel = true }: ConfidenceBarProps) {
  const percentage = Math.min(Math.max(value * 100, 0), 100);
  const color = percentage >= 80 ? 'bg-green-500' : percentage >= 60 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="w-full">
      {showLabel && label && (
        <div className="flex justify-between items-center mb-1">
          <span className="text-sm text-gray-600">{label}</span>
          <span className="text-sm font-semibold text-gray-900">{percentage.toFixed(0)}%</span>
        </div>
      )}
      <div className={`w-full bg-gray-200 rounded-full overflow-hidden ${height}`}>
        <div
          className={`${color} ${height} rounded-full transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
