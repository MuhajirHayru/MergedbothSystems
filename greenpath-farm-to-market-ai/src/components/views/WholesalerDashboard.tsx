import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/apiClient';
import { ApiOrder, buyerIdOf, sellerIdOf, shipmentStateLabel } from '../../lib/orders';
import { Product, Order } from '../../types';
import {
  ShoppingBag,
  Package,
  Layers,
  DollarSign,
  TrendingUp,
  Truck,
  Sparkles,
  MapPin,
  CheckCircle2,
  Clock,
  ArrowRight,
  Store,
  Star,
  Heart,
  ChevronRight,
} from 'lucide-react';

export const WholesalerDashboard: React.FC = () => {
  const { setActiveView, currentUser, setNotification } = useApp();
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState<any>(null);
  const [rawOrders, setRawOrders] = useState<ApiOrder[]>([]);
  const [inventoryListings, setInventoryListings] = useState<any[]>([]);
  const [walletSummary, setWalletSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [dashRes, orderRes, walletRes, invRes] = await Promise.allSettled([
          api.dashboard.wholesaler(),
          api.orders.list(),
          api.wallet.summary(),
          api.products.myWholesalerListings(),
        ]);
        if (cancelled) return;

        if (dashRes.status === 'fulfilled') setDashboard(dashRes.value?.data ?? null);
        
        const rows = orderRes.status === 'fulfilled'
          ? (Array.isArray(orderRes.value?.data?.results) ? orderRes.value.data.results : Array.isArray(orderRes.value?.data) ? orderRes.value.data : [])
          : [];
        setRawOrders(rows as ApiOrder[]);

        if (walletRes.status === 'fulfilled') setWalletSummary(walletRes.value?.data ?? null);

        const invRows = invRes.status === 'fulfilled'
          ? (Array.isArray(invRes.value?.data?.results) ? invRes.value.data.results : Array.isArray(invRes.value?.data) ? invRes.value.data : [])
          : [];
        setInventoryListings(invRows);
      } catch (e: any) {
        setNotification?.(e?.response?.data?.error || 'Failed to load dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  const [activeTab, setActiveTab] = useState<'overview' | 'orders' | 'inventory' | 'favorites'>('overview');

  const meId = String(currentUser?.id || '');
  // Both directions are derived from the backend's real seller/buyer ids.
  const myPurchases = rawOrders.filter((order) => buyerIdOf(order) === meId);
  const incomingSales = rawOrders.filter((order) => sellerIdOf(order) === meId);
  const pendingOrders = myPurchases.filter(
    (order) => !['Completed', 'Rejected', 'Cancelled'].includes(order.status)
  );

  const totalSpentETB = myPurchases.reduce(
    (acc, order) => acc + Number(order.total_amount || 0),
    0
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
            Commercial Wholesaler Hub · {currentUser.region}
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-1">
            Wholesale Trading Console & Cargo Procurement
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Procure fresh produce directly from Ethiopian farming cooperatives with Chapa Escrow protection.
          </p>
        </div>

        <button
          onClick={() => setActiveView('marketplace')}
          className="flex items-center gap-2 px-4 py-2 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg shadow-xs transition-colors"
        >
          <ShoppingBag className="w-4 h-4" />
          <span>Discover Direct Farm Listings</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Active Orders</span>
            <Package className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-2">
            {pendingOrders.length} In-Transit
          </div>
          <div className="text-[11px] text-emerald-600 font-semibold mt-1">Chapa Escrow secured</div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Total Wholesale Spent</span>
            <DollarSign className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-2">
            {totalSpentETB.toLocaleString()} ETB
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Across {myPurchases.length} bulk trades</div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Wallet Available Balance</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400 mt-2">
            {Number(walletSummary?.available_balance ?? 0).toLocaleString()} ETB
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Ready for instant escrow lock</div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Accredited Partner Farmers</span>
            <Heart className="w-4 h-4 text-red-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-2">
            {dashboard?.stats?.favorite_sellers ?? 0} Sellers
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Meki, Ziway, Hawassa & Gondar</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-2 text-xs font-semibold">
        <button
          onClick={() => setActiveTab('overview')}
          className={`py-2.5 px-3 border-b-2 transition-colors ${
            activeTab === 'overview'
              ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Active Procurement Pipeline
        </button>
        <button
          onClick={() => setActiveTab('inventory')}
          className={`py-2.5 px-3 border-b-2 transition-colors ${
            activeTab === 'inventory'
              ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Depot Inventory Stock
        </button>
        <button
          onClick={() => setActiveTab('favorites')}
          className={`py-2.5 px-3 border-b-2 transition-colors ${
            activeTab === 'favorites'
              ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Favorite Farming Cooperatives
        </button>
      </div>

      {/* Orders Table */}
      {activeTab === 'overview' && (
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Current Farm Purchases & Logistics
              </h3>
              <p className="text-xs text-slate-400">
                Track status across Ordered → Seller Approval → Processing → Shipped → Delivered → Payment Release
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/20 text-xs">
            <div>
              <div className="font-bold text-emerald-800 dark:text-emerald-300">
                Incoming orders for your own listings: {incomingSales.length}
              </div>
              <div className="text-emerald-700/80 dark:text-emerald-400/80">
                Retailers ordering your wholesale listings appear in the shared orders workspace,
                where you can accept or reject them with the buyer's escrow state.
              </div>
            </div>
            <button
              onClick={() => {
                setActiveView('orders');
                navigate('/orders');
              }}
              className="px-3 py-1.5 rounded-lg bg-[#15803D] text-white font-bold"
            >
              Open incoming orders →
            </button>
          </div>

          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 font-semibold">
                  <th className="py-3 px-3">Order Number</th>
                  <th className="py-3 px-3">Seller</th>
                  <th className="py-3 px-3">Crop Commodity</th>
                  <th className="py-3 px-2 text-right">Qty</th>
                  <th className="py-3 px-3 text-right">Escrow Amount</th>
                  <th className="py-3 px-3">Delivery</th>
                  <th className="py-3 px-2">Status</th>
                  <th className="py-3 px-3 text-center">Lifecycle Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {myPurchases.map((ord) => (
                  <tr key={ord.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-3 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                      {ord.reference}
                    </td>
                    <td className="py-3 px-3 font-semibold text-slate-800 dark:text-slate-200">
                      {ord.seller_name}
                    </td>
                    <td className="py-3 px-3 text-slate-700 dark:text-slate-300">
                      {ord.product_title}
                    </td>
                    <td className="py-3 px-2 text-right font-mono font-bold">
                      {Number(ord.quantity)} {ord.product_unit}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
                      {Number(ord.total_amount).toLocaleString()} ETB
                    </td>
                    <td className="py-3 px-3 text-slate-500 text-[11px]">
                      {shipmentStateLabel(ord)}
                    </td>
                    <td className="py-3 px-2">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 capitalize">
                        {ord.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <button
                        onClick={() => {
                          setActiveView('orders');
                          navigate(`/orders/${ord.id}`);
                        }}
                        className="text-[11px] font-semibold text-[#15803D] dark:text-emerald-400 hover:underline"
                      >
                        Timeline →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Inventory Tab */}
      {activeTab === 'inventory' && (
        <div className="space-y-6">
          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-emerald-600" />
                  <span>Wholesale Warehouse & Produce Allocation Stock</span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Manage inventory stocks staged for municipal grocery store supply and export dispatch.
                </p>
              </div>
              <button
                onClick={() => setActiveView('marketplace')}
                className="px-4 py-2 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center gap-1.5 self-start sm:self-auto"
              >
                <ShoppingBag className="w-4 h-4" />
                <span>Restock from Cooperative Listings</span>
              </button>
            </div>

            {inventoryListings.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {inventoryListings.map((item: any) => (
                  <div
                    key={item.id}
                    className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                        {item.status || 'ACTIVE'}
                      </span>
                      <span className="font-mono text-xs text-slate-500">{item.unit_of_measure || 'units'}</span>
                    </div>
                    <div>
                      <div className="font-bold text-sm text-slate-900 dark:text-slate-100">{item.title}</div>
                      <div className="text-xs text-slate-400">{item.category}</div>
                    </div>
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] text-slate-400">Available Stock</div>
                        <div className="font-bold font-mono text-emerald-600 dark:text-emerald-400">{item.quantity} {item.unit_of_measure}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-slate-400">Wholesale Price</div>
                        <div className="font-bold font-mono text-slate-900 dark:text-slate-100">{Number(item.price_per_unit).toLocaleString()} ETB</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/20 space-y-3">
                <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center mx-auto">
                  <Package className="w-6 h-6" />
                </div>
                <div className="text-sm font-bold text-slate-900 dark:text-slate-100">No active wholesale stock listings posted</div>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                  Purchased cargo from farmers and cooperatives will appear here once verified, or you can stage wholesale produce batches for municipal grocery distribution.
                </p>
                <button
                  onClick={() => setActiveView('marketplace')}
                  className="px-4 py-2 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg shadow-sm transition-all"
                >
                  Browse Cooperative Harvests
                </button>
              </div>
            )}
          </div>

          {/* Freight Corridor Cargo Procurement Estimator */}
          <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 to-[#15803D] text-white shadow-md space-y-3">
            <div className="flex items-center gap-2">
              <Truck className="w-5 h-5 text-emerald-300" />
              <h4 className="font-bold text-sm">Addis Wholesale Cargo Transit Calculator</h4>
            </div>
            <p className="text-xs text-slate-200 max-w-2xl">
              Real-time transit estimation across key Ethiopian agricultural freight expressways:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <div className="p-3 rounded-xl bg-white/10 border border-white/10">
                <div className="text-[11px] text-emerald-200 font-semibold">Meki → Mojo → Addis Ababa</div>
                <div className="font-bold text-sm mt-1">138 km · ~3.5 Hours</div>
                <div className="text-[10px] text-slate-300 mt-0.5">Primary horticulture expressway</div>
              </div>
              <div className="p-3 rounded-xl bg-white/10 border border-white/10">
                <div className="text-[11px] text-emerald-200 font-semibold">Hawassa → Mojo → Addis</div>
                <div className="font-bold text-sm mt-1">275 km · ~5.5 Hours</div>
                <div className="text-[10px] text-slate-300 mt-0.5">Avocado & Sidama coffee corridor</div>
              </div>
              <div className="p-3 rounded-xl bg-white/10 border border-white/10">
                <div className="text-[11px] text-emerald-200 font-semibold">Ambo → Addis Wholesale</div>
                <div className="font-bold text-sm mt-1">115 km · ~2.5 Hours</div>
                <div className="text-[10px] text-slate-300 mt-0.5">Grain, barley & root crop route</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const RetailerDashboard: React.FC = () => {
  const { products, orders, setActiveView, currentUser } = useApp();

  const myOrders = orders.filter((o) => o.buyerId === currentUser.id || o.buyerRole === 'retailer');
  const partnerHubsCount = new Set(myOrders.map((o) => o.sellerName).filter(Boolean)).size || 1;
  const completedOrders = myOrders.filter((o) => o.status === 'Completed');
  const qualityRate = myOrders.length > 0 
    ? Math.round((completedOrders.length / myOrders.length) * 100) 
    : 100;

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <Store className="w-4 h-4" />
            <span>Municipal Retailer & Grocer Console · {currentUser.region}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-1">
            Retail Restock Hub & Cold-Chain Intake
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Procure fresh produce directly from accredited agricultural wholesalers with Chapa digital payments.
          </p>
        </div>

        <button
          onClick={() => setActiveView('marketplace')}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-xl shadow-xs transition-colors"
        >
          <Store className="w-4 h-4" />
          <span>Browse Wholesale Catalog</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="text-xs text-slate-500">Restock Orders in Pipeline</div>
          <div className="text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400 mt-1">
            {myOrders.length} {myOrders.length === 1 ? 'Delivery' : 'Deliveries'}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Direct farm & wholesale consignments</div>
        </div>
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="text-xs text-slate-500">Active Supplier Hubs</div>
          <div className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-1">
            {partnerHubsCount} Verified {partnerHubsCount === 1 ? 'Hub' : 'Hubs'}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">MoA accredited cooperatives</div>
        </div>
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="text-xs text-slate-500">Quality Confirmation Rate</div>
          <div className="text-2xl font-bold font-mono text-blue-600 dark:text-blue-400 mt-1">
            {qualityRate}% Certified
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Escrow released post inspection</div>
        </div>
      </div>

      {/* Restock Orders Table */}
      <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
        <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
          Store Restock Deliveries
        </h3>
        {myOrders.length > 0 ? (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 font-semibold">
                  <th className="py-3 px-3">Order Ref</th>
                  <th className="py-3 px-3">Supplier Hub</th>
                  <th className="py-3 px-3">Produce</th>
                  <th className="py-3 px-2 text-right">Quantity</th>
                  <th className="py-3 px-3 text-right">Escrow ETB</th>
                  <th className="py-3 px-2">Status</th>
                  <th className="py-3 px-3 text-center">Quality Sign-Off</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {myOrders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-3 px-3 font-mono font-bold">{ord.orderNumber}</td>
                    <td className="py-3 px-3 font-medium">{ord.sellerName}</td>
                    <td className="py-3 px-3">{ord.productTitle}</td>
                    <td className="py-3 px-2 text-right font-mono font-bold">
                      {ord.quantity} {ord.unit}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
                      {ord.totalAmountETB.toLocaleString()} ETB
                    </td>
                    <td className="py-3 px-2">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 capitalize">
                        {ord.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <button
                        onClick={() => setActiveView('orders')}
                        className="text-xs font-semibold text-[#15803D] dark:text-emerald-400 hover:underline"
                      >
                        Inspect Delivery →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 space-y-3">
            <Package className="w-8 h-8 text-slate-400 mx-auto" />
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">No active grocery restock orders in flight</div>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Place wholesale orders for farm-fresh produce to replenish your store shelves with guaranteed Chapa Escrow protection.
            </p>
            <button
              onClick={() => setActiveView('marketplace')}
              className="px-4 py-2 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg shadow-sm"
            >
              Discover Produce
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
