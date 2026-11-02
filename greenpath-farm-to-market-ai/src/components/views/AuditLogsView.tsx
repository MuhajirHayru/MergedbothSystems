import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  FileText,
  Search,
  Filter,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Calendar,
  Building,
} from 'lucide-react';

export const AuditLogsView: React.FC = () => {
  const { auditLogs } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [resultFilter, setResultFilter] = useState('All');

  const filteredLogs = auditLogs.filter((log) => {
    const matchesSearch =
      log.actorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.targetUser.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.reference.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory = categoryFilter === 'All' || log.category === categoryFilter;
    const matchesResult = resultFilter === 'All' || log.result === resultFilter;

    return matchesSearch && matchesCategory && matchesResult;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <FileText className="w-4 h-4" />
            <span>Immutable Federal Audit Trail</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-1">
            Platform Audit Logs & Administrative History
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Read-only chronological trail of financial settlements, user accreditations, and security events.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search action, actor, target user, or reference..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="flex items-center gap-2 text-xs">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            >
              <option value="All">All Categories</option>
              <option value="Financial">Financial</option>
              <option value="Verification">Verification</option>
              <option value="Marketplace">Marketplace</option>
              <option value="Security">Security</option>
              <option value="System">System</option>
            </select>

            <select
              value={resultFilter}
              onChange={(e) => setResultFilter(e.target.value)}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            >
              <option value="All">All Results</option>
              <option value="Success">Success</option>
              <option value="Warning">Warning / Lockout</option>
              <option value="Failed">Failed</option>
            </select>
          </div>
        </div>

        {/* Audit Table */}
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 font-semibold">
                <th className="py-3 px-3">Timestamp</th>
                <th className="py-3 px-3">Actor & Role</th>
                <th className="py-3 px-3">Action Description</th>
                <th className="py-3 px-3">Target Subject</th>
                <th className="py-3 px-2">Category</th>
                <th className="py-3 px-2">Administrative Scope</th>
                <th className="py-3 px-2">Outcome</th>
                <th className="py-3 px-3">Reference ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="py-3 px-3 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                    {log.timestamp}
                  </td>
                  <td className="py-3 px-3 font-semibold text-slate-800 dark:text-slate-200">
                    <div>{log.actorName}</div>
                    <div className="text-[10px] text-slate-400 font-mono capitalize">
                      {log.actorRole}
                    </div>
                  </td>
                  <td className="py-3 px-3 font-medium text-slate-900 dark:text-slate-100">
                    {log.action}
                  </td>
                  <td className="py-3 px-3 text-slate-600 dark:text-slate-400">
                    {log.targetUser}
                  </td>
                  <td className="py-3 px-2">
                    <span className="px-2 py-0.5 rounded font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px]">
                      {log.category}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-slate-500 text-[11px]">
                    {log.scope}
                  </td>
                  <td className="py-3 px-2">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${
                        log.result === 'Success'
                          ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                          : log.result === 'Warning'
                          ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                          : 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300'
                      }`}
                    >
                      {log.result}
                    </span>
                  </td>
                  <td className="py-3 px-3 font-mono text-[11px] text-slate-500">
                    {log.reference}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
