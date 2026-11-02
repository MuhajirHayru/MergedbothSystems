import React from 'react';
import { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: {
    direction: 'up' | 'down' | 'neutral';
    label: string;
  };
  icon?: LucideIcon;
  badgeText?: string;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  subtitle,
  trend,
  icon: Icon,
  badgeText,
}) => {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
        <span className="font-medium text-slate-600">{title}</span>
        {Icon && <Icon className="w-4 h-4 text-slate-400" />}
      </div>

      <div className="text-2xl font-bold tracking-tight text-slate-900 font-mono tabular-nums">
        {value}
      </div>

      {(subtitle || trend || badgeText) && (
        <div className="mt-2.5 flex items-center gap-2 text-xs text-slate-500">
          {trend && (
            <span
              className={`font-medium ${
                trend.direction === 'up'
                  ? 'text-emerald-700'
                  : trend.direction === 'down'
                  ? 'text-amber-700'
                  : 'text-slate-600'
              }`}
            >
              {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'} {trend.label}
            </span>
          )}
          {trend && subtitle && <span aria-hidden="true">·</span>}
          {subtitle && <span>{subtitle}</span>}
          {badgeText && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-slate-400">{badgeText}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
};
