import React from 'react';

interface StatusBadgeProps {
  status: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  let dotColor = 'bg-slate-400';
  let textColor = 'text-slate-700';

  const normalized = status.toLowerCase();

  if (
    normalized.includes('approved') ||
    normalized.includes('completed') ||
    normalized.includes('delivered') ||
    normalized.includes('available') ||
    normalized.includes('verified') ||
    normalized.includes('operational')
  ) {
    dotColor = 'bg-emerald-600';
    textColor = 'text-emerald-800';
  } else if (
    normalized.includes('pending') ||
    normalized.includes('process') ||
    normalized.includes('requested') ||
    normalized.includes('negotiating') ||
    normalized.includes('transit') ||
    normalized.includes('low')
  ) {
    dotColor = 'bg-amber-500';
    textColor = 'text-amber-800';
  } else if (
    normalized.includes('rejected') ||
    normalized.includes('failed') ||
    normalized.includes('sold') ||
    normalized.includes('deficit')
  ) {
    dotColor = 'bg-rose-600';
    textColor = 'text-rose-800';
  }

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${textColor}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} aria-hidden="true" />
      <span>{status}</span>
    </span>
  );
};
