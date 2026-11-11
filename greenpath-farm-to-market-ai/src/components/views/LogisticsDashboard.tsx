/**
 * Part 26 — Logistics tracking management dashboard.
 * Freight board (authorized shipments) + per-order tracking timeline from the
 * DriverApp shipment feed. For LOGISTICS_MANAGER / SUPER_ADMIN / FM / Support.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, RefreshCw, MapPin, Search, Users, Navigation, ExternalLink, MessageSquare, Mail, Phone, LocateFixed } from 'lucide-react';
import { api } from '../../services/apiClient';
import { Pager } from '../common/Pager';
import { formatApiError } from '../../lib/apiErrors';

interface ShipmentRow {
  order_id: string;
  order_reference: string;
  product: string;
  quantity: string;
  buyer: string;
  buyer_role: string;
  seller: string;
  seller_role: string;
  freight_payer: string;
  freight_payer_role: string;
  pickup: string;
  destination: string;
  cargo_weight_kg: string;
  packaging: string;
  driver_shipment_id: null | number;
  driver_shipment_status: string;
  proposed_fee: null | string;
  agreement: null | { amount: string; pricing_model: string; driver_charge: null | string; platform_fee: null | string; customer_amount: null | string; driver_payee: string };
  payment_status: null | string;
  compensation_paid: boolean;
  order_status: string;
}
interface RegionOption { id: string; name: string }
interface BoardPagination { page: number; page_size: number; total_items: number; has_next: boolean; has_previous: boolean }
interface DriverRow {
  id: string; name: string; available: boolean; phone: string; email: string; vehicle_type: string;
  vehicle_registration: string; capacity_kg: string | null; service_region: string;
  service_zone: string; service_wereda: string; active_shipment_count: number;
  registered_location: { address: string; latitude: string | null; longitude: string | null };
  location_status: 'live' | 'stale' | 'registered' | 'unregistered';
  location: null | { latitude: string; longitude: string; observed_at: string | null; order_reference: string; shipment_status: string };
}

function driverMapPosition(driver: DriverRow) {
  if (driver.location) return { latitude: Number(driver.location.latitude), longitude: Number(driver.location.longitude), source: 'Live GPS' };
  if (driver.registered_location.latitude && driver.registered_location.longitude) return { latitude: Number(driver.registered_location.latitude), longitude: Number(driver.registered_location.longitude), source: 'Registered profile' };
  return null;
}

function geoPoint(latitude: number, longitude: number, zoom: number) {
  const scale = 256 * 2 ** zoom;
  const sin = Math.sin((latitude * Math.PI) / 180);
  return { x: ((longitude + 180) / 360) * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
}

const LiveDriverMap: React.FC<{ drivers: DriverRow[]; selectedDriverId: string | null; onSelectDriver: (id: string) => void }> = ({ drivers, selectedDriverId, onSelectDriver }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 390 });
  const [zoom, setZoom] = useState(6);
  const [centerCoordinates, setCenterCoordinates] = useState({ latitude: 9, longitude: 39.5 });
  useEffect(() => {
    if (!mapRef.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.max(320, Math.round(entry.contentRect.width)), height: Math.max(300, Math.round(entry.contentRect.height)) }));
    observer.observe(mapRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const selected = drivers.find((driver) => driver.id === selectedDriverId);
    const position = selected ? driverMapPosition(selected) : null;
    if (position) setCenterCoordinates({ latitude: position.latitude, longitude: position.longitude });
  }, [selectedDriverId, drivers]);
  const center = useMemo(() => geoPoint(centerCoordinates.latitude, centerCoordinates.longitude, zoom), [centerCoordinates, zoom]);
  const left = center.x - size.width / 2, top = center.y - size.height / 2;
  const tiles = useMemo(() => {
    const minX = Math.floor(left / 256), maxX = Math.floor((left + size.width) / 256);
    const minY = Math.max(0, Math.floor(top / 256)), maxY = Math.min(2 ** zoom - 1, Math.floor((top + size.height) / 256));
    const result: { x: number; y: number; key: string }[] = [];
    for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) result.push({ x, y, key: `${x}-${y}` });
    return result;
  }, [left, top, size.width, size.height, zoom]);
  const mappedDrivers = drivers.filter((driver) => driverMapPosition(driver));
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800"><div><h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Driver locations</h3><p className="text-xs text-slate-500">{mappedDrivers.length} with recorded coordinates · {drivers.filter((d) => d.location).length} live GPS · refreshes every 30 seconds</p></div>
      <div className="flex items-center gap-2"><a className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300" href="https://www.openstreetmap.org/" target="_blank" rel="noreferrer">OpenStreetMap <ExternalLink className="h-3 w-3" /></a><button aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(5, z - 1))} className="h-8 w-8 rounded-lg border text-lg dark:border-slate-700">−</button><span className="min-w-12 text-center text-xs text-slate-500">Zoom {zoom}</span><button aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(9, z + 1))} className="h-8 w-8 rounded-lg border text-lg dark:border-slate-700">+</button></div></div>
    <div ref={mapRef} className="relative h-[390px] overflow-hidden bg-[#e7eee7]" aria-label="Geographic map of current driver GPS positions">
      {tiles.map((tile) => <img key={tile.key} alt="" draggable={false} src={`https://tile.openstreetmap.org/${zoom}/${((tile.x % (2 ** zoom)) + (2 ** zoom)) % (2 ** zoom)}/${tile.y}.png`} className="absolute h-64 w-64 max-w-none" style={{ left: tile.x * 256 - left, top: tile.y * 256 - top }} />)}
      {mappedDrivers.map((driver) => { const position = driverMapPosition(driver)!; const point = geoPoint(position.latitude, position.longitude, zoom); const x = point.x - left, y = point.y - top; if (x < 0 || y < 0 || x > size.width || y > size.height) return null; const active = driver.id === selectedDriverId; return <button key={driver.id} type="button" onClick={() => onSelectDriver(driver.id)} title={`${driver.name} · ${position.source}`} className={`absolute z-10 -translate-x-1/2 -translate-y-full rounded-full border-2 px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg ${active ? 'border-amber-200 bg-amber-700' : position.source === 'Live GPS' ? 'border-white bg-emerald-700' : 'border-white bg-blue-700'}`} style={{ left: x, top: y }}><span className="flex items-center gap-1.5"><Navigation className="h-3 w-3" />{driver.name}</span></button>; })}
      {mappedDrivers.length === 0 && <div className="absolute inset-0 grid place-items-center bg-white/30 p-5 text-center backdrop-blur-[1px]"><div className="max-w-sm rounded-xl border border-slate-200 bg-white/95 p-4 shadow-sm"><MapPin className="mx-auto mb-2 h-5 w-5 text-emerald-700" /><p className="text-sm font-semibold text-slate-800">No drivers have registered map coordinates</p><p className="mt-1 text-xs text-slate-500">Map pins use exact coordinates saved on the driver profile or fresh GPS shared during an assigned shipment. Addresses are never geocoded or guessed.</p></div></div>}
      <div className="absolute bottom-2 left-2 flex gap-3 rounded bg-white/90 px-2 py-1 text-[10px] text-slate-600"><span>© OpenStreetMap contributors</span><span className="text-blue-700">● Registered location</span><span className="text-emerald-700">● Live GPS</span></div>
    </div>
  </section>;
};

export const LogisticsDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [driverSearch, setDriverSearch] = useState('');
  const [driverAvailability, setDriverAvailability] = useState('all');
  const [driverRegion, setDriverRegion] = useState('');
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [regions, setRegions] = useState<RegionOption[]>([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<BoardPagination | null>(null);
  const [timeline, setTimeline] = useState<null | { order: string; driver: null | string; fee: null | string; driver_shipment_status: string; timeline: any[] }>(null);

  const serviceRegions = useMemo(() => [...new Set(drivers.map((driver) => driver.service_region || driver.registered_location.address).filter(Boolean))].sort(), [drivers]);
  const filteredDrivers = useMemo(() => drivers.filter((driver) => {
    const needle = driverSearch.trim().toLowerCase();
    const matchesSearch = !needle || [driver.name, driver.email, driver.phone, driver.vehicle_registration,
      driver.registered_location.address, driver.service_region, driver.service_zone, driver.service_wereda]
      .filter(Boolean).some((value) => String(value).toLowerCase().includes(needle));
    const matchesAvailability = driverAvailability === 'all' || (driverAvailability === 'available' ? driver.available : !driver.available);
    const matchesRegion = !driverRegion || (driver.service_region || driver.registered_location.address) === driverRegion;
    return matchesSearch && matchesAvailability && matchesRegion;
  }), [drivers, driverSearch, driverAvailability, driverRegion]);
  const selectedDriver = drivers.find((driver) => driver.id === selectedDriverId) || null;
  const messageDriver = (driver: DriverRow) => navigate(`/messaging?with=${encodeURIComponent(driver.id)}&name=${encodeURIComponent(driver.name)}`);

  const load = useCallback(async () => {
    setError(''); setLoading(true);
    try {
      const params: Record<string, unknown> = { page, page_size: 25 };
      if (search) params.search = search;
      if (statusFilter) params.shipment_status = statusFilter;
      if (regionFilter) params.region = regionFilter;
      const res = await api.freight.board(params);
      setRows(Array.isArray(res.data.shipments) ? res.data.shipments : []);
      const driverRows = Array.isArray(res.data.drivers) ? res.data.drivers : [];
      setDrivers(driverRows.map((driver: any) => ({
        ...driver,
        email: driver.email || '',
        phone: driver.phone || '',
        registered_location: driver.registered_location || { address: '', latitude: null, longitude: null },
        location_status: driver.location_status || 'unregistered',
      })));
      setSummary(res.data.summary || null);
      setPagination(res.data.pagination || null);
      setRegions(Array.isArray(res.data.regions) ? res.data.regions : []);
    } catch (err) {
      setError(formatApiError(err, 'Freight board could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, regionFilter, page]);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 400 : 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    const refresh = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(refresh);
  }, [load]);

  const openTracking = useCallback(async (orderId: string) => {
    setError('');
    try {
      const res = await api.freight.tracking(orderId);
      setTimeline({ order: res.data.order_reference, driver: res.data.driver, fee: res.data.fee, driver_shipment_status: res.data.driver_shipment_status, timeline: res.data.timeline });
    } catch (err) {
      setError(formatApiError(err, 'Tracking could not be loaded.'));
    }
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <div>
        <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
          <Truck className="w-4 h-4" />
          <span>Logistics operations</span>
        </div>
        <h2 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-0.5">
          Freight &amp; Shipment Tracking Dashboard
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Marketplace-authorized shipments with live agreement, payment, and DriverApp event data.
        </p>
      </div>

      {error && <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{error}</div>}

      <LiveDriverMap drivers={filteredDrivers} selectedDriverId={selectedDriverId} onSelectDriver={setSelectedDriverId} />

      {selectedDriver && <section className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{selectedDriver.name}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${selectedDriver.available ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>{selectedDriver.available ? 'Available' : 'Unavailable'}</span></div>
          <div className="mt-2 grid gap-x-6 gap-y-1 text-xs text-slate-600 sm:grid-cols-2 dark:text-slate-300"><span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{selectedDriver.email}</span><span className="inline-flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" />{selectedDriver.phone || 'Phone not recorded'}</span><span className="inline-flex items-center gap-1.5"><LocateFixed className="h-3.5 w-3.5" />Registered address: {selectedDriver.registered_location.address || 'Not provided'}</span><span>{[selectedDriver.service_region, selectedDriver.service_zone, selectedDriver.service_wereda].filter(Boolean).join(' · ') || 'Service area not specified'}</span><span>{selectedDriver.vehicle_type || 'Vehicle not provided'} · {selectedDriver.capacity_kg ? `${selectedDriver.capacity_kg} kg` : 'Capacity not recorded'}</span><span>{selectedDriver.active_shipment_count} active shipment(s) · {selectedDriver.location_status === 'live' ? `live GPS on ${selectedDriver.location?.order_reference}` : selectedDriver.location_status}</span></div>
        </div><button type="button" onClick={() => messageDriver(selectedDriver)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800"><MessageSquare className="h-4 w-4" />Message driver</button></div>
      </section>}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div><h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100"><Users className="h-4 w-4 text-emerald-700" />Driver roster</h3><p className="text-xs text-slate-500">Approved, eligible drivers · read-only account information</p></div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{filteredDrivers.length} shown · {drivers.length} total · {drivers.filter((d) => d.available).length} available</span>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3 dark:border-slate-800"><div className="relative"><Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" /><input aria-label="Search drivers" value={driverSearch} onChange={(e) => setDriverSearch(e.target.value)} placeholder="Name, email, phone, vehicle, address" className="w-64 max-w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs dark:border-slate-700 dark:bg-slate-800" /></div>
          <select aria-label="Filter driver availability" value={driverAvailability} onChange={(e) => setDriverAvailability(e.target.value)} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"><option value="all">All availability</option><option value="available">Available</option><option value="unavailable">Unavailable</option></select>
          <select aria-label="Filter by registered driver location" value={driverRegion} onChange={(e) => setDriverRegion(e.target.value)} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"><option value="">All driver locations</option>{serviceRegions.map((region) => <option key={region} value={region}>{region}</option>)}</select>
          {(driverSearch || driverRegion || driverAvailability !== 'all') && <button type="button" onClick={() => { setDriverSearch(''); setDriverRegion(''); setDriverAvailability('all'); }} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-emerald-700">Clear filters</button>}</div>
        <div className="max-h-[420px] overflow-auto">
          {drivers.length === 0 ? <p className="p-5 text-center text-xs text-slate-500">No approved driver records were returned by the logistics API.</p> : filteredDrivers.length === 0 ? <p className="p-5 text-center text-xs text-slate-500">No drivers match these filters.</p> : <table className="w-full min-w-[1000px] text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800"><tr><th className="px-4 py-2.5">Driver</th><th className="px-3 py-2.5">Availability</th><th className="px-3 py-2.5">Vehicle / capacity</th><th className="px-3 py-2.5">Registered location</th><th className="px-3 py-2.5">Service area</th><th className="px-3 py-2.5">Shipments</th><th className="px-3 py-2.5">Map pin</th><th className="px-3 py-2.5">Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{filteredDrivers.map((driver) => <tr key={driver.id} onClick={() => setSelectedDriverId(driver.id)} className={`cursor-pointer text-slate-700 dark:text-slate-200 ${selectedDriverId === driver.id ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''}`}>
              <td className="px-4 py-3"><div className="font-semibold">{driver.name}</div><div className="text-[11px] text-slate-500">{driver.email} · {driver.phone || 'No phone on file'}</div></td>
              <td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${driver.available ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{driver.available ? 'Available' : 'Unavailable'}</span></td>
              <td className="px-3 py-3">{driver.vehicle_type || 'Not provided'}<div className="text-[11px] text-slate-500">{driver.capacity_kg ? `${driver.capacity_kg} kg` : 'Capacity not recorded'}</div></td>
              <td className="px-3 py-3">{driver.registered_location.address || 'Not provided'}<div className="text-[11px] text-slate-500">{driver.registered_location.latitude && driver.registered_location.longitude ? `${driver.registered_location.latitude}, ${driver.registered_location.longitude}` : 'Coordinates not registered'}</div></td>
              <td className="px-3 py-3">{[driver.service_region, driver.service_zone, driver.service_wereda].filter(Boolean).join(' · ') || 'Not specified'}</td><td className="px-3 py-3">{driver.active_shipment_count}</td>
              <td className="px-3 py-3"><span className={driver.location_status === 'live' ? 'font-semibold text-emerald-700 dark:text-emerald-400' : 'text-slate-500'}>{driver.location ? `Live GPS · ${driver.location.order_reference}` : driver.registered_location.latitude && driver.registered_location.longitude ? 'Registered coordinates' : 'No coordinates'}</span></td>
              <td className="px-3 py-3"><div className="flex gap-1.5"><button type="button" onClick={(e) => { e.stopPropagation(); setSelectedDriverId(driver.id); }} className="rounded-lg border px-2.5 py-1.5 font-semibold dark:border-slate-700">View</button><button type="button" onClick={(e) => { e.stopPropagation(); messageDriver(driver); }} className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-2.5 py-1.5 font-semibold text-white"><MessageSquare className="h-3.5 w-3.5" />Message</button></div></td>
            </tr>)}</tbody>
          </table>}
        </div>
      </section>

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            ['Authorized shipments', summary.authorized_shipments],
            ['With fee agreement', summary.with_agreement],
            ['Awaiting agreement', summary.awaiting_agreement],
          ].map(([label, value]) => (
            <div key={String(label)} className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">{label}</div>
              <div className="text-lg font-bold font-mono text-slate-900 dark:text-slate-100">{String(value)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center text-xs rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="relative"><Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" /><input value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} placeholder="Search order, product, buyer, seller, driver…"
          className="w-64 max-w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 dark:border-slate-700 dark:bg-slate-800" /></div>
        <select value={statusFilter} onChange={(e) => { setPage(1); setStatusFilter(e.target.value); }}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5">
          <option value="">All shipment states</option>
          <option value="awaiting_agreement">Awaiting agreement</option>
          <option value="agreed">Agreement recorded</option>
        </select>
        <select aria-label="Filter by pickup region" value={regionFilter} onChange={(e) => { setPage(1); setRegionFilter(e.target.value); }}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5">
          <option value="">All pickup regions</option>
          {regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
        </select>
        <button onClick={() => void load()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="p-6 text-center text-xs text-slate-500">Loading shipments…</div>
      ) : rows.length === 0 ? (
        <div className="p-8 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs text-slate-500">No authorized shipments match.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.order_reference} className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{r.order_reference} · {r.product}</div>
                  <div className="text-[11px] text-slate-500">
                    Buyer: {r.buyer} · Seller/shipper: {r.seller} · {r.cargo_weight_kg} kg · {r.packaging}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3" /> {r.pickup} → {r.destination}
                  </div>
                </div>
                <div className="text-right text-xs">
                  <div className="font-mono font-bold">{r.agreement?.amount ? `${r.agreement.amount} ETB agreed freight` : r.proposed_fee ? `${r.proposed_fee} ETB proposed` : 'fee pending'}</div>
                  <div className="text-[11px] text-slate-500">
                    {r.driver_shipment_status ? `driver: ${r.driver_shipment_status.replace(/_/g, ' ')}` : 'not yet in DriverApp'}
                  </div>
                  {r.agreement && (
                    <div className="text-[11px] text-slate-500">
                      {r.agreement.pricing_model === 'A' ? 'Platform-retained fee' : 'Separate platform fee'}
                      {' · '}Freight payer: {r.freight_payer || r.buyer} ({(r.freight_payer_role || r.buyer_role || 'BUYER').replace(/_/g, ' ').toLowerCase()})
                      {' · '}Transport cost: {r.agreement.driver_charge ?? 'not recorded'} ETB
                      {' · '}Platform fee in agreement: {r.agreement.platform_fee ?? 'not recorded'} ETB
                      {' · '}Transport provider: {r.agreement.driver_payee || 'not recorded'}
                      {r.payment_status ? ` · collection ${r.payment_status.toLowerCase()}` : ' · collection not recorded'}
                      {r.compensation_paid ? ' · compensation paid' : ''}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => void openTracking(r.order_id)}
                  className="px-3 py-1.5 rounded-lg border text-xs font-semibold border-slate-300 dark:border-slate-600"
                >
                  Tracking
                </button>
              </div>
              {timeline && timeline.order === r.order_reference && (
                <div className="mt-3 border-t border-slate-100 dark:border-slate-800 pt-3 space-y-1.5">
                  {timeline.timeline.map((e: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className={`w-2 h-2 rounded-full ${i === timeline.timeline.length - 1 ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                      <span className="font-mono text-[11px] text-slate-500">{new Date(e.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-200">{String(e.event_type).replace(/_/g, ' ')}</span>
                      {e.status && <span className="text-slate-500 dark:text-slate-400">→ {String(e.status).replace(/_/g, ' ')}</span>}
                    </div>
                  ))}
                  {timeline.timeline.length === 0 && <div className="text-xs text-slate-500 dark:text-slate-400">No feed events recorded yet.</div>}
                </div>
              )}
            </div>
          ))}
          {pagination && <Pager page={pagination.page} pageSize={pagination.page_size} total={pagination.total_items}
            hasMore={pagination.has_next} onPrev={() => setPage((current) => Math.max(1, current - 1))}
            onNext={() => setPage((current) => current + 1)} />}
        </div>
      )}
    </div>
  );
};
