import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  MapPin,
  Users,
  ShieldCheck,
  FileCheck2,
  Building,
  TrendingUp,
  BarChart3,
  Search,
  Filter,
  Eye,
  SlidersHorizontal,
} from 'lucide-react';

export const TopUserAdminDashboard: React.FC = () => {
  const { regionalMetrics, allUsers, setActiveView } = useApp();
  const [selectedRegionFilter, setSelectedRegionFilter] = useState('All');

  const totalUsersAcrossEthiopia = regionalMetrics.reduce((sum, r) => sum + r.totalUsers, 0);
  const totalFarmersAcrossEthiopia = regionalMetrics.reduce((sum, r) => sum + r.farmersCount, 0);
  const totalWholesalersAcrossEthiopia = regionalMetrics.reduce((sum, r) => sum + r.wholesalersCount, 0);

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <Building className="w-4 h-4" />
            <span>National Administrative Bureau · Cross-Regional Governance</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-1">
            Top User Administrator Console
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Federal hierarchy oversight: Regional Administrator allocations, Zonal Bureau monitoring, and accredited census.
          </p>
        </div>

        <button
          onClick={() => setActiveView('reports_regional')}
          className="flex items-center gap-2 px-4 py-2 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg shadow-xs transition-colors"
        >
          <BarChart3 className="w-4 h-4" />
          <span>Inspect Regional Reports</span>
        </button>
      </div>

      {/* Aggregate Federal KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="text-xs text-slate-500">Federal Agribusiness Registry</div>
          <div className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-1">
            {totalUsersAcrossEthiopia.toLocaleString()} Participants
          </div>
          <div className="text-[11px] text-emerald-600 font-semibold mt-0.5">
            11 Regional States & 2 Charter Cities
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="text-xs text-slate-500">Accredited Primary Producers</div>
          <div className="text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400 mt-1">
            {totalFarmersAcrossEthiopia.toLocaleString()} Farmers
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Holders of certified MoA farm deeds</div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="text-xs text-slate-500">Accredited Trade Buyers</div>
          <div className="text-2xl font-bold font-mono text-blue-600 mt-1">
            {totalWholesalersAcrossEthiopia.toLocaleString()} Wholesalers
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Terminal hubs & export aggregators</div>
        </div>
      </div>

      {/* Regional Hierarchy Grid */}
      <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
              National Administrative Hierarchy & Regional Centers
            </h3>
            <p className="text-xs text-slate-400">
              Click any regional bureau to view zonal leadership and operational metrics
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {regionalMetrics.map((reg) => (
            <div
              key={reg.region}
              className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:border-[#15803D] transition-colors space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-emerald-600" />
                  <span>{reg.region}</span>
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                  {reg.zones.length} Zones
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1 pt-1 text-xs">
                <div>
                  <div className="text-[10px] text-slate-400">Farmers</div>
                  <div className="font-bold font-mono">{reg.farmersCount.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Wholesalers</div>
                  <div className="font-bold font-mono">{reg.wholesalersCount.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Retailers</div>
                  <div className="font-bold font-mono">{reg.retailersCount.toLocaleString()}</div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200 dark:border-slate-700/60 flex items-center justify-between text-xs">
                <span className="text-slate-400 font-mono">{reg.totalTransactions} transactions</span>
                <button
                  onClick={() => setActiveView('reports_regional')}
                  className="font-semibold text-[#15803D] dark:text-emerald-400 hover:underline"
                >
                  Regional Audit →
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
