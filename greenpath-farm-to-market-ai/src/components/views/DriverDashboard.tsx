import React from 'react';
import { useApp } from '../../context/AppContext';
import {
  Truck,
  ExternalLink,
  ShieldCheck,
  FileCheck2,
  MapPin,
  Clock,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  Navigation,
  FileText,
} from 'lucide-react';

export const DriverDashboard: React.FC = () => {
  const { currentUser, waybills, setNotification } = useApp();

  const handleLaunchDriverApp = () => {
    setNotification(
      'Session token authorized. Redirecting to native DriverApp fleet application...'
    );
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" />
            <span>Driver Accreditation & Marketplace Dispatch Integration</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-1">
            Freight Carrier Console
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Accreditation status, commercial license verification, and session integration with DriverApp.
          </p>
        </div>

        {/* Continue to DriverApp Primary Action (Section 7.D) */}
        <button
          onClick={handleLaunchDriverApp}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg shadow-md transition-all hover:scale-105"
        >
          <span>Continue to DriverApp</span>
          <ExternalLink className="w-4 h-4" />
        </button>
      </div>

      {/* Driver Credential & Integration Status Banner */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 to-[#15803D] text-white shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-white/10 flex items-center justify-center font-bold text-2xl border border-white/20">
            <Truck className="w-8 h-8 text-emerald-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-bold">{currentUser.name}</h2>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/30 text-emerald-200 border border-emerald-400/30">
                Accredited Carrier
              </span>
            </div>
            <div className="text-xs text-slate-200 mt-0.5">
              Plate: <strong className="font-mono text-white">{currentUser.truckPlateNumber || 'Not registered'}</strong>
            </div>
          </div>
        </div>

        <div className="text-left sm:text-right text-xs text-slate-200 space-y-1">
          <div>Commercial License: <span className="font-mono text-emerald-300 font-bold">{currentUser.licenseNumber || 'Not on file'}</span></div>
          <div>Regulatory Expiry: <span className="font-mono text-white">{currentUser.licenseExpiryDate || '2027-08-30'}</span></div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Accreditation Status</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400 mt-1">
            Verified & Approved
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Valid across all Ethiopian trade corridors</div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Authorized Active Waybills</span>
            <MapPin className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-1 font-mono">
            {waybills.length} Dispatched
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Meki → Mojo → Addis Ababa Expressway</div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Agreed Freight Fee Status</span>
            <FileText className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-1 font-mono">
            {waybills.length > 0
              ? `${Number(waybills.reduce((s: number, w: any) => s + Number(w.fee ?? w.amount ?? 0), 0)).toLocaleString()} ETB`
              : '—'}
          </div>
          <div className="text-[11px] text-emerald-600 font-semibold mt-0.5">
            {waybills.length > 0 ? 'Agreed delivery fees' : 'No active delivery fees'}
          </div>
        </div>
      </div>

      {/* Authorized Active Shipment Waybills (Integrated from marketplace) */}
      <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
              Authorized Marketplace Cargo Shipments
            </h3>
            <p className="text-xs text-slate-400">
              Dispatched manifests linked to your DriverApp session
            </p>
          </div>
          <button
            onClick={handleLaunchDriverApp}
            className="text-xs text-[#15803D] dark:text-emerald-400 font-bold hover:underline flex items-center gap-1"
          >
            <span>Launch In DriverApp</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="space-y-3">
          {waybills.map((wb) => (
            <div
              key={wb.id}
              className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-sm text-slate-900 dark:text-slate-100">
                    {wb.waybillNumber}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300">
                    {wb.status}
                  </span>
                </div>
                <div className="text-xs text-slate-700 dark:text-slate-300 font-semibold">
                  Cargo: {wb.cropName}
                </div>
                <div className="text-xs text-slate-500 flex items-center gap-1">
                  <Navigation className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{wb.corridor}</span>
                </div>
              </div>

              <div className="flex sm:flex-col sm:items-end justify-between gap-1 text-xs">
                <div className="font-mono font-bold text-emerald-700 dark:text-emerald-400 text-sm">
                  {wb.freightFeeETB.toLocaleString()} ETB
                </div>
                <div className="text-[11px] text-slate-400">Fee Agreement: {wb.feeStatus}</div>
                <div className="text-[11px] text-slate-400">
                  Last Telemetry: {wb.lastTelemetry.locationName} ({wb.lastTelemetry.speedKmH} km/h)
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
