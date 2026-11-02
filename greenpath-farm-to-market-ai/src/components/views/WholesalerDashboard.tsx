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
  const [walletSummary, setWalletSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [dashRes, orderRes, walletRes] = await Promise.all([
          api.dashboard.wholesaler(),
          api.orders.list(),
          api.wallet.summary(),
        ]);
        if (cancelled) return;
        setDashboard(dashRes?.data ?? null);
        const rows = Array.isArray(orderRes?.data?.results)
          ? orderRes.data.results
          : Array.isArray(orderRes?.data)
          ? orderRes.data
          : [];
        setRawOrders(rows as ApiOrder[]);
        setWalletSummary(walletRes?.data ?? null);
      } catch (e: any) {
        setNotification?.(e?.response?.data?.error || 'Failed to load dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser?.id]);
  const products: any[] = [];

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
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
          <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
            GreenSource Central Warehouse Hub Inventory
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
              <div className="font-bold text-sm">Highland Red Tomatoes</div>
              <div className="text-xl font-bold font-mono text-emerald-600 mt-1">60 crates</div>
              <div className="text-xs text-slate-400">Available for urban retail allocation</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
              <div className="font-bold text-sm">Cured Red Shallot Onions</div>
              <div className="text-xl font-bold font-mono text-emerald-600 mt-1">40 quintals</div>
              <div className="text-xs text-slate-400">Warehouse bay #2 (Inbound Mojo)</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
              <div className="font-bold text-sm">Export Hass Avocado</div>
              <div className="text-xl font-bold font-mono text-emerald-600 mt-1">40 crates</div>
              <div className="text-xs text-slate-400">Cold storage chamber (8°C)</div>
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

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
            Municipal Retailer & Grocer Console · {currentUser.region}
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-1">
            Retail Restock Hub
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Restock retail groceries directly from accredited agricultural wholesalers with Chapa digital payments.
          </p>
        </div>

        <button
          onClick={() => setActiveView('marketplace')}
          className="flex items-center gap-2 px-4 py-2 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg shadow-xs transition-colors"
        >
          <Store className="w-4 h-4" />
          <span>Browse Wholesale Catalog</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="text-xs text-slate-500">Restock Orders in Transit</div>
          <div className="text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400 mt-1">
            {myOrders.length} Deliveries
          </div>
        </div>
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="text-xs text-slate-500">Partner Wholesalers</div>
          <div className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-1">
            8 Certified Hubs
          </div>
        </div>
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="text-xs text-slate-500">Quality Confirmation Rate</div>
          <div className="text-2xl font-bold font-mono text-blue-600 mt-1">
            99.4% Grade 1
          </div>
        </div>
      </div>

      {/* Restock Orders Table */}
      <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
        <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
          Store Restock Deliveries
        </h3>
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
                  <td className="py-3 px-3 text-right font-mono font-bold text-emerald-700">
                    {ord.totalAmountETB.toLocaleString()} ETB
                  </td>
                  <td className="py-3 px-2">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 capitalize">
                      {ord.status}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-center">
                    <button
                      onClick={() => setActiveView('orders')}
                      className="text-xs font-semibold text-[#15803D] hover:underline"
                    >
                      Inspect Delivery →
                    </button>
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
