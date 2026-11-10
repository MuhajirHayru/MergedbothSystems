import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/apiClient';
import { establishDriverAppSession, DRIVER_APP_URL } from '../../lib/api/client';
import { Truck, ShieldCheck, MapPin, Clock, CheckCircle2, AlertCircle, ChevronRight, Navigation, FileText, Gavel, DollarSign, Activity, Compass, Eye, Layers, Lock, Unlock, Radio, RefreshCw, Phone, ArrowRight, Sparkles, ExternalLink } from 'lucide-react';
import { DriverFreightBoard, DriverAssignmentsPanel } from './FreightBiddingPanels';

export const DriverDashboard: React.FC = () => {
  const { currentUser, waybills, setNotification, setActiveView } = useApp();

  const [activeTab, setActiveTab] = useState<'hub' | 'jobs' | 'deliveries' | 'corridor' | 'earnings'>('hub');
  const [isAvailable, setIsAvailable] = useState<boolean>(true);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [driverAppLaunching, setDriverAppLaunching] = useState(false);

  // Secure handoff: the DriverApp backend verifies the Marketplace credential
  // server-side, establishes its own browser session, then we open the app.
  const handleLaunchDriverApp = async () => {
    setDriverAppLaunching(true);
    try {
      await establishDriverAppSession();
      window.open(DRIVER_APP_URL, '_blank', 'noopener,noreferrer');
      setNotification('DriverApp session established — opening the driver portal.');
    } catch (err) {
      setNotification(err instanceof Error ? err.message : 'The DriverApp could not be opened.');
    } finally {
      setDriverAppLaunching(false);
    }
  };
  const [isSharingLocation, setIsSharingLocation] = useState<boolean>(false);
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [locationStatus, setLocationStatus] = useState<string>('Ready to broadcast');
  const [selectedWaybillForPin, setSelectedWaybillForPin] = useState<any | null>(null);
  const [pinType, setPinType] = useState<'pickup' | 'delivery'>('pickup');
  const [inputPin, setInputPin] = useState('');
  const [pinVerifying, setPinVerifying] = useState(false);
  const [pinSuccess, setPinSuccess] = useState(false);

  const watchIdRef = useRef<number | null>(null);

  // Load driver availability from API
  useEffect(() => {
    let cancelled = false;
    api.freight.availability()
      .then((res: any) => {
        if (!cancelled && res?.data?.available !== undefined) {
          setIsAvailable(Boolean(res.data.available));
        }
      })
      .catch(() => {
        /* fallback default available */
      });
    return () => { cancelled = true; };
  }, []);

  const handleToggleAvailability = async () => {
    setAvailabilityLoading(true);
    const newStatus = !isAvailable;
    try {
      await api.freight.setAvailability(newStatus);
      setIsAvailable(newStatus);
      setNotification(`Availability updated: You are now ${newStatus ? 'ON-DUTY (Available for Bids)' : 'OFF-DUTY'}.`);
    } catch {
      setNotification('Could not update availability status. Please try again.');
    } finally {
      setAvailabilityLoading(false);
    }
  };

  const handleToggleLocationSharing = () => {
    if (isSharingLocation) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setIsSharingLocation(false);
      setLocationStatus('GPS sharing stopped');
      setNotification('Live GPS location sharing disabled.');
    } else {
      if (!('geolocation' in navigator)) {
        setNotification('Geolocation is not supported by your browser.');
        return;
      }
      setLocationStatus('Acquiring GPS fix...');
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          setCurrentCoords({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: Math.round(pos.coords.accuracy),
          });
          setIsSharingLocation(true);
          setLocationStatus(`Live telemetry active (±${Math.round(pos.coords.accuracy)}m)`);
        },
        (err) => {
          setIsSharingLocation(false);
          setLocationStatus(`Location error: ${err.message}`);
          setNotification(`GPS error: ${err.message}`);
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 }
      );
      setNotification('Live GPS location sharing enabled along corridor.');
    }
  };

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  const handleVerifyPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputPin.trim()) return;
    setPinVerifying(true);
    setTimeout(() => {
      setPinVerifying(false);
      setPinSuccess(true);
      setTimeout(() => {
        setNotification(`${pinType === 'pickup' ? 'Pickup' : 'Delivery'} PIN verified successfully! Cargo transfer authorized.`);
        setSelectedWaybillForPin(null);
        setInputPin('');
        setPinSuccess(false);
      }, 1000);
    }, 800);
  };

  const totalFees = waybills.reduce((s: number, w: any) => s + Number(w.freightFeeETB ?? w.amount ?? 0), 0);

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Top Banner & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <Truck className="w-4 h-4" />
            <span>Integrated Cargo Fleet & Freight Hub</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-1">
            Freight Carrier Console & Dispatch
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Accredited carrier portal for Ethiopian agricultural freight corridors with live telemetry and escrow settlement.
          </p>
        </div>

        {/* Status Actions */}
        <div className="flex items-center gap-2.5">
          {/* Duty Switch */}
          <button
            onClick={handleToggleAvailability}
            disabled={availabilityLoading}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all ${
              isAvailable
                ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 shadow-xs'
                : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
            }`}
          >
            <span className={`w-2.5 h-2.5 rounded-full ${isAvailable ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
            <span>{isAvailable ? 'On-Duty (Available)' : 'Off-Duty'}</span>
          </button>

          {/* DriverApp secure handoff */}
          <button
            onClick={() => void handleLaunchDriverApp()}
            disabled={driverAppLaunching}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-300 transition-all disabled:opacity-60"
            title="Open the GreenPath DriverApp with your Marketplace session"
          >
            <ExternalLink className="w-3.5 h-3.5 text-emerald-600" />
            <span>{driverAppLaunching ? 'Establishing session…' : 'Open DriverApp'}</span>
          </button>

          {/* GPS Telemetry Broadcast */}
          <button
            onClick={handleToggleLocationSharing}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all ${
              isSharingLocation
                ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-300 dark:border-blue-800 text-blue-800 dark:text-blue-300 shadow-xs'
                : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
            }`}
          >
            <Radio className={`w-3.5 h-3.5 ${isSharingLocation ? 'text-blue-600 animate-spin' : 'text-slate-400'}`} />
            <span>{isSharingLocation ? 'Broadcasting GPS' : 'Share GPS Location'}</span>
          </button>
        </div>
      </div>

      {/* Driver Credential & Profile Card */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-[#15803D] text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-xs flex items-center justify-center font-bold text-2xl border border-white/20 shrink-0">
            <Truck className="w-8 h-8 text-emerald-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-bold">{currentUser.name || 'Commercial Freight Carrier'}</h2>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/30 text-emerald-200 border border-emerald-400/30">
                MoA Accredited
              </span>
            </div>
            <div className="text-xs text-slate-300 mt-0.5 flex flex-wrap gap-x-4 gap-y-1">
              <span>Plate: <strong className="font-mono text-white">{currentUser.truckPlateNumber || '3-ET-B49102'}</strong></span>
              <span>Vehicle: <strong className="text-white">Isuzu FSR Cargo (4.5 Ton)</strong></span>
              <span>Zone: <strong className="text-white">{currentUser.zone || 'East Shewa (Meki-Mojo)'}</strong></span>
            </div>
          </div>
        </div>

        <div className="text-left md:text-right text-xs text-slate-200 space-y-1 border-t md:border-t-0 border-white/10 pt-3 md:pt-0">
          <div>License Class: <span className="font-mono text-emerald-300 font-bold">{currentUser.licenseNumber || 'DRV-ETH-99201'}</span></div>
          <div>Telebirr / Chapa Wallet: <span className="font-mono text-white font-bold">{currentUser.phone || '+251 91 123 4567'}</span></div>
          <div className="text-[11px] text-emerald-200">{locationStatus}</div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-1 sm:gap-2 text-xs font-semibold overflow-x-auto scrollbar-thin">
        <button
          onClick={() => setActiveTab('hub')}
          className={`py-2.5 px-3 border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'hub'
              ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
          }`}
        >
          Active Manifests & Waybills ({waybills.length})
        </button>
        <button
          onClick={() => setActiveTab('jobs')}
          className={`py-2.5 px-3 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'jobs'
              ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
          }`}
        >
          <Gavel className="w-3.5 h-3.5" />
          <span>Freight Bidding Board</span>
        </button>
        <button
          onClick={() => setActiveTab('deliveries')}
          className={`py-2.5 px-3 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'deliveries'
              ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
          }`}
        >
          <MapPin className="w-3.5 h-3.5" />
          <span>My Freight Deliveries</span>
        </button>
        <button
          onClick={() => setActiveTab('corridor')}
          className={`py-2.5 px-3 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'corridor'
              ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
          }`}
        >
          <Compass className="w-3.5 h-3.5" />
          <span>Corridor Route & Telemetry</span>
        </button>
        <button
          onClick={() => setActiveTab('earnings')}
          className={`py-2.5 px-3 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'earnings'
              ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
          }`}
        >
          <DollarSign className="w-3.5 h-3.5" />
          <span>Freight Earnings & Fuel</span>
        </button>
      </div>

      {/* TAB: Hub Overview & Manifests */}
      {activeTab === 'hub' && (
        <div className="space-y-6">
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Active Assigned Waybills</span>
                <MapPin className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-1">
                {waybills.length} Dispatched
              </div>
              <div className="text-[11px] text-emerald-600 font-medium mt-0.5">En route on Mojo Expressway</div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Total Freight Fee Balance</span>
                <DollarSign className="w-4 h-4 text-blue-600" />
              </div>
              <div className="text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400 mt-1">
                {totalFees.toLocaleString()} ETB
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">Escrow release upon delivery PIN verification</div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Carrier Compliance Rating</span>
                <CheckCircle2 className="w-4 h-4 text-purple-600" />
              </div>
              <div className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-1">
                99.8% On-Time
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">Cold-chain handling verified</div>
            </div>
          </div>

          {/* Active Cargo Waybills Table */}
          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  Authorized Cargo Shipments & Waybills
                </h3>
                <p className="text-xs text-slate-400">
                  Confirm cargo pickup and delivery using buyer/seller 4-digit security PINs
                </p>
              </div>
              <button
                onClick={() => setActiveTab('jobs')}
                className="text-xs font-bold text-[#15803D] dark:text-emerald-400 hover:underline flex items-center gap-1"
              >
                <span>Find More Freight Jobs →</span>
              </button>
            </div>

            {waybills.length > 0 ? (
              <div className="space-y-3">
                {waybills.map((wb) => (
                  <div
                    key={wb.id}
                    className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-sm text-slate-900 dark:text-slate-100">
                          {wb.waybillNumber}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300">
                          {wb.status}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-500">
                          Order: {wb.orderNumber}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        Commodity: {wb.cropName} ({wb.quantityQuintals} Quintals)
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-1.5">
                        <Navigation className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>Corridor: {wb.corridor}</span>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 text-xs">
                      <div className="text-left sm:text-right">
                        <div className="text-[10px] text-slate-400">Agreed Delivery Fee</div>
                        <div className="font-mono font-bold text-emerald-700 dark:text-emerald-400 text-base">
                          {wb.freightFeeETB.toLocaleString()} ETB
                        </div>
                        <div className="text-[10px] text-slate-400">Escrow: {wb.feeStatus}</div>
                      </div>

                      <div className="flex gap-2 w-full sm:w-auto">
                        <button
                          onClick={() => {
                            setSelectedWaybillForPin(wb);
                            setPinType('pickup');
                          }}
                          className="flex-1 sm:flex-none px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-1"
                        >
                          <Lock className="w-3.5 h-3.5" />
                          <span>Pickup PIN</span>
                        </button>
                        <button
                          onClick={() => {
                            setSelectedWaybillForPin(wb);
                            setPinType('delivery');
                          }}
                          className="flex-1 sm:flex-none px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-1"
                        >
                          <Unlock className="w-3.5 h-3.5" />
                          <span>Delivery PIN</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 space-y-3">
                <Truck className="w-10 h-10 text-slate-400 mx-auto" />
                <div className="text-sm font-bold text-slate-900 dark:text-slate-100">No active cargo shipments currently assigned</div>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Browse open freight jobs on the bidding board to submit competitive offers for Isuzu and Sino truck cargo hauls.
                </p>
                <button
                  onClick={() => setActiveTab('jobs')}
                  className="px-4 py-2 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg shadow-sm"
                >
                  Browse Available Cargo Jobs
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: Jobs Bidding Board */}
      {activeTab === 'jobs' && (
        <div className="space-y-4">
          <DriverFreightBoard />
        </div>
      )}

      {/* TAB: My Deliveries */}
      {activeTab === 'deliveries' && (
        <div className="space-y-4">
          <DriverAssignmentsPanel />
        </div>
      )}

      {/* TAB: Corridor Route & Telemetry Tracker */}
      {activeTab === 'corridor' && (
        <div className="space-y-6">
          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Compass className="w-4 h-4 text-emerald-600" />
                  <span>Ethiopian Central Freight Corridor Waypoints</span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Real-time checkpoint tracking along the primary agricultural transit expressway
                </p>
              </div>
              <div className="text-xs font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-3 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800">
                Current Corridor: Meki → Mojo → Addis Ababa (138 km)
              </div>
            </div>

            {/* Visual Corridor Milestones */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2">
              <div className="p-4 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/30 space-y-1">
                <div className="flex items-center justify-between text-xs font-bold text-emerald-800 dark:text-emerald-300">
                  <span>1. Meki Farm Gate</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300">Horticulture cooperative staging</div>
                <div className="text-[10px] text-slate-400 font-mono">Elevation: 1,650m · GPS 8.15° N, 38.82° E</div>
              </div>

              <div className="p-4 rounded-xl border border-blue-300 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/30 space-y-1">
                <div className="flex items-center justify-between text-xs font-bold text-blue-800 dark:text-blue-300">
                  <span>2. Mojo Dry Port Inter.</span>
                  <Activity className="w-4 h-4 text-blue-600" />
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300">Toll plaza & weigh station checkpoint</div>
                <div className="text-[10px] text-slate-400 font-mono">Elevation: 1,825m · Toll Verified</div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-1">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                  <span>3. Akaki Kality Gate</span>
                  <Clock className="w-4 h-4 text-amber-500" />
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300">Addis southern municipal customs</div>
                <div className="text-[10px] text-slate-400 font-mono">Expected transit: 45 min</div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-1">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                  <span>4. Wholesale Depot</span>
                  <MapPin className="w-4 h-4 text-slate-400" />
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300">Atikelt Tera central warehouse</div>
                <div className="text-[10px] text-slate-400 font-mono">Chapa Escrow handoff destination</div>
              </div>
            </div>

            {/* Live GPS Telemetry Broadcast Panel */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="font-bold text-xs text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <Radio className={`w-4 h-4 ${isSharingLocation ? 'text-blue-600 animate-pulse' : 'text-slate-400'}`} />
                  <span>Real-time GPS Coordinate Broadcast</span>
                </div>
                <div className="text-xs text-slate-500">
                  {currentCoords
                    ? `Current coordinates: ${currentCoords.lat.toFixed(5)}° N, ${currentCoords.lng.toFixed(5)}° E (Accuracy: ±${currentCoords.accuracy}m)`
                    : 'GPS telemetry is dormant. Click below to share live coordinates with dispatch.'}
                </div>
              </div>
              <button
                onClick={handleToggleLocationSharing}
                className="px-4 py-2 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg shadow-sm transition-all"
              >
                {isSharingLocation ? 'Disable GPS Broadcast' : 'Activate Live GPS Broadcast'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB: Earnings & Fuel */}
      {activeTab === 'earnings' && (
        <div className="space-y-6">
          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
            <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-600" />
              <span>Freight Settlement & Carrier Wallet</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
                <div className="text-xs text-slate-500">Available Disbursed Balance</div>
                <div className="text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400 mt-1">
                  18,450 ETB
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">Ready for Telebirr / CBE withdrawal</div>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
                <div className="text-xs text-slate-500">In-Transit Locked Escrow</div>
                <div className="text-2xl font-bold font-mono text-amber-600 mt-1">
                  {totalFees.toLocaleString()} ETB
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">Released upon delivery sign-off</div>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
                <div className="text-xs text-slate-500">Fuel & Toll Allowance Advance</div>
                <div className="text-2xl font-bold font-mono text-blue-600 mt-1">
                  4,500 ETB
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">Pre-authorized corridor fuel</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Security PIN Verification Modal */}
      {selectedWaybillForPin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Verify {pinType === 'pickup' ? 'Farm Gate Pickup' : 'Warehouse Delivery'} PIN</span>
                </h3>
                <div className="text-xs text-slate-400">Waybill: {selectedWaybillForPin.waybillNumber}</div>
              </div>
              <button
                onClick={() => setSelectedWaybillForPin(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleVerifyPin} className="space-y-4">
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {pinType === 'pickup'
                  ? 'Request the 4-digit Pickup Authorization PIN from the farmer or cooperative manager to verify produce collection.'
                  : 'Request the 4-digit Delivery Handover PIN from the warehouse intake clerk to finalize cargo custody and release escrow.'}
              </p>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Enter 4-Digit Security PIN:
                </label>
                <input
                  type="password"
                  maxLength={4}
                  value={inputPin}
                  onChange={(e) => setInputPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••"
                  autoFocus
                  className="w-full text-center text-2xl tracking-[0.5em] font-mono py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-[#15803D]"
                />
              </div>

              {pinSuccess && (
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>PIN Authenticated! Updating freight custody record...</span>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedWaybillForPin(null)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inputPin.length !== 4 || pinVerifying}
                  className="flex-1 py-2.5 rounded-xl bg-[#15803D] hover:bg-[#166534] disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white text-xs font-bold shadow-sm transition-all"
                >
                  {pinVerifying ? 'Verifying...' : 'Authenticate PIN'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
