import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/apiClient';
import { Product, Order } from '../../types';
import {
  Package,
  ShoppingBag,
  TrendingUp,
  DollarSign,
  Plus,
  Edit,
  Trash2,
  CheckCircle2,
  XCircle,
  Upload,
  Camera,
  Image,
  Clock,
  ArrowRight,
  Eye,
  X,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const normalizeProduct = (p: any) => ({
  id: p.id,
  status: p.status || 'ACTIVE',
  title: p.title,    amharicTitle: p.name_am || p.amharic_title || p.amharicTitle || '',
    oromoTitle: p.name_om || p.oromo_title || p.oromoTitle || '',
    category: p.category,
  variety: p.catalog_variety_name || p.variety || 'Standard Cultivar',
  grade: p.grade || 'Grade 1 Domestic',
  unit: p.unit_of_measure || p.unit || 'kg',
  pricePerUnitETB: Number(p.price_per_unit ?? p.pricePerUnitETB ?? 0),
  availableQuantity: Number(p.quantity ?? p.availableQuantity ?? 0),
  minOrder: p.min_order ?? p.minOrder ?? 1,
  description: p.description || '',
  images: Array.isArray(p.images) ? p.images : [],
});

const normalizeOrder = (o: any) => ({
  id: o.id,
  orderNumber: o.reference || o.orderNumber || o.id,
  buyerName: o.buyer_name || o.wholesaler_name || o.buyerName || 'Buyer',
  productTitle: o.product_title || o.productTitle || 'Product',
  quantity: Number(o.quantity ?? 0),
  unit: o.unit || 'units',
  totalAmountETB: Number(o.total_amount ?? o.totalAmountETB ?? 0),
  status: o.status,
  createdAt: o.created_at || o.createdAt,
});

export const FarmerDashboard: React.FC = () => {
  const { currentUser, setNotification, setActiveView } = useApp();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'overview' | 'products' | 'orders' | 'wallet' | 'add_product'>('overview');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [myProducts, setMyProducts] = useState<any[]>([]);
  const [myOrders, setMyOrders] = useState<any[]>([]);
  const [walletSummary, setWalletSummary] = useState<any>(null);
  const [walletTransactions, setWalletTransactions] = useState<any[]>([]);
  const [walletPayouts, setWalletPayouts] = useState<any[]>([]);
  const [walletBankAccounts, setWalletBankAccounts] = useState<any[]>([]);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [dashRes, prodRes, orderRes, walletRes, txRes, payoutRes, bankRes] = await Promise.all([
          api.dashboard.farmer(),
          api.products.myFarmerListings(),
          api.orders.list(),
          api.wallet.summary(),
          api.wallet.transactions(),
          api.wallet.payouts(),
          api.wallet.bankAccounts(),
        ]);
        if (cancelled) return;
        setDashboardData(dashRes?.data ?? null);
        const products = Array.isArray(prodRes?.data?.results) ? prodRes.data.results : Array.isArray(prodRes?.data) ? prodRes.data : [];
        const orders = Array.isArray(orderRes?.data?.results) ? orderRes.data.results : Array.isArray(orderRes?.data) ? orderRes.data : [];
        setMyProducts(products.map(normalizeProduct));
        setMyOrders(orders.map(normalizeOrder));
        setWalletSummary(walletRes?.data ?? null);
        const transactions = Array.isArray(txRes?.data?.results) ? txRes.data.results : Array.isArray(txRes?.data) ? txRes.data : [];
        const payouts = Array.isArray(payoutRes?.data?.results) ? payoutRes.data.results : Array.isArray(payoutRes?.data) ? payoutRes.data : [];
        const bankAccounts = Array.isArray(bankRes?.data?.results) ? bankRes.data.results : Array.isArray(bankRes?.data) ? bankRes.data : [];
        setWalletTransactions(transactions);
        setWalletPayouts(payouts);
        setWalletBankAccounts(bankAccounts);
        setError(null);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load dashboard data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  // Database-backed marketplace categories for the listing form.
  useEffect(() => {
    let cancelled = false;
    api.products
      .categories()
      .then((res: any) => {
        const rows = res?.data?.categories || [];
        if (cancelled || !Array.isArray(rows) || rows.length === 0) return;
        setCategoryOptions(rows);
        setCategory((current) =>
          rows.some((row: any) => row.value === current) ? current : rows[0].value
        );
      })
      .catch(() => {
        /* leave the selector empty; the API rejects unknown categories */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Add Product Form State (Supports up to 8 images)
  const [title, setTitle] = useState('');
  const [amharicTitle, setAmharicTitle] = useState('');
  const [oromoTitle, setOromoTitle] = useState('');
  // Categories come from the database catalog, never from a hardcoded list.
  const [categoryOptions, setCategoryOptions] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [category, setCategory] = useState<string>('Vegetables');
  const [variety, setVariety] = useState('');
  const [grade, setGrade] = useState<Product['grade']>('Grade 1 Domestic');
  const [unit, setUnit] = useState<Product['unit']>('crate (25kg)');
  const [pricePerUnitETB, setPricePerUnitETB] = useState<number>(1800);
  const [availableQuantity, setAvailableQuantity] = useState<number>(100);
  const [minOrder, setMinOrder] = useState<number>(5);
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [newImageFiles, setNewImageFiles] = useState<File[]>([]);
  const [newImagePreviews, setNewImagePreviews] = useState<string[]>([]);

  // Farmer's orders and products (loaded from backend)
  const pendingOrders = myOrders.filter((o: any) => o.status === 'Pending seller approval');

  // Total earnings
  const totalEarnedETB = myOrders
    .filter((o: any) => o.status === 'Completed' || o.status === 'Awaiting payment release')
    .reduce((sum: number, o: any) => sum + Number(o.total_amount || o.totalAmountETB || 0), 0);

  // Sales trend chart (derived from real orders)
  const salesChartData = myOrders.reduce((acc: any[], o: any) => {
    const d = o.createdAt ? new Date(o.createdAt) : null;
    const week = d ? `Wk ${Math.ceil(d.getDate() / 7)}` : 'Unknown';
    const existing = acc.find((x) => x.week === week);
    if (existing) {
      existing.salesETB += Number(o.totalAmountETB || 0);
      existing.volumeKg += Number(o.quantity || 0);
    } else {
      acc.push({ week, salesETB: Number(o.totalAmountETB || 0), volumeKg: Number(o.quantity || 0) });
    }
    return acc;
  }, []);

  const handleImageFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const slots = 8 - images.length - newImageFiles.length;
    if (slots <= 0) {
      setNotification('Maximum 8 images allowed per product listing.');
      return;
    }
    const accepted = Array.from(files)
      .filter((file) => file.type.startsWith('image/') && file.size <= 5 * 1024 * 1024)
      .slice(0, slots);
    if (accepted.length < Math.min(files.length, slots)) {
      setNotification('Only JPG, PNG or WEBP images up to 5 MB are accepted.');
    }
    setNewImageFiles((prev) => [...prev, ...accepted]);
    setNewImagePreviews((prev) => [
      ...prev,
      ...accepted.map((file) => URL.createObjectURL(file)),
    ]);
  };

  const handleRemoveImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRemoveNewImage = (index: number) => {
    const preview = newImagePreviews[index];
    if (preview) URL.revokeObjectURL(preview);
    setNewImageFiles((prev) => prev.filter((_, i) => i !== index));
    setNewImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const refetchListings = async () => {
    try {
      const res = await api.products.myFarmerListings();
      const products = Array.isArray(res?.data?.results) ? res.data.results : Array.isArray(res?.data) ? res.data : [];
      setMyProducts(products.map(normalizeProduct));
    } catch (e) {
      // ignore
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !pricePerUnitETB) return;

    const payload = {
      title,
      name_am: amharicTitle,
      name_om: oromoTitle,
      description,
      category,
      quantity: availableQuantity,
      unit_of_measure: unit,
      price_per_unit: pricePerUnitETB,
      ...(images.length > 0 ? { images } : {}),
    };

    try {
      let listingId = editingProduct?.id;
      if (editingProduct) {
        await api.products.updateFarmerListing(editingProduct.id, payload);
      } else {
        const created = await api.products.createFarmerListing(payload);
        listingId = created?.data?.id;
      }
      if (listingId && newImageFiles.length > 0) {
        for (const file of newImageFiles) {
          await api.products.uploadListingImage('farmer', listingId, file);
        }
      }
      setEditingProduct(null);
      await refetchListings();
      setNotification('Product saved successfully.');
    } catch (err: any) {
      setNotification(err?.message || 'Failed to save product.');
    }

    setActiveTab('products');
    resetForm();
  };

  const resetForm = () => {
    setTitle('');
    setAmharicTitle('');
    setOromoTitle('');
    setVariety('');
    setDescription('');
    setPricePerUnitETB(1800);
    setAvailableQuantity(100);
    setImages([]);
    setNewImageFiles([]);
    setNewImagePreviews((prev) => {
      prev.forEach((url) => URL.revokeObjectURL(url));
      return [];
    });
  };

  const handleStartEdit = (prod: Product) => {
    setEditingProduct(prod);
    setTitle(prod.title);
    setAmharicTitle(prod.amharicTitle);
    setOromoTitle(prod.oromoTitle || '');
    setCategory(prod.category);
    setVariety(prod.variety);
    setGrade(prod.grade);
    setUnit(prod.unit);
    setPricePerUnitETB(prod.pricePerUnitETB);
    setAvailableQuantity(prod.availableQuantity);
    setMinOrder(prod.minOrder);
    setDescription(prod.description);
    setImages(prod.images);
    setNewImageFiles([]);
    setNewImagePreviews((prev) => {
      prev.forEach((url) => URL.revokeObjectURL(url));
      return [];
    });
    setActiveTab('add_product');
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
            Producer Agribusiness Workspace · {currentUser.region}
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-1">
            Farmer Dashboard & Crop Management
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Manage your crop listings, approve incoming wholesaler orders, and track harvest revenue.
          </p>
        </div>

        <button
          onClick={() => {
            setEditingProduct(null);
            resetForm();
            setActiveTab('add_product');
          }}
          className="flex items-center gap-2 px-4 py-2 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg shadow-xs transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>Add New Crop Listing</span>
        </button>
      </div>

      {/* KPI Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Active Produce Listings</span>
            <Package className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-2">
            {myProducts.filter((p: any) => p.status === 'ACTIVE').length} Listings
          </div>
          <div className="text-[11px] text-emerald-600 font-semibold mt-1">Staged in marketplace</div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Pending Wholesale Orders</span>
            <ShoppingBag className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-amber-600 mt-2">
            {pendingOrders.length} Orders
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Awaiting farm gate approval</div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Total Sales Earned</span>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400 mt-2">
            {totalEarnedETB.toLocaleString()} ETB
          </div>
          <div className="text-[11px] text-emerald-600 font-semibold mt-1">Disbursed via Chapa Escrow</div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Cooperative Accreditations</span>
            <CheckCircle2 className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-2">
            Grade 1 Export
          </div>
          <div className="text-[11px] text-slate-400 mt-1">MoA License Verified</div>
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
          Overview & Harvest Trends
        </button>
        <button
          onClick={() => setActiveTab('products')}
          className={`py-2.5 px-3 border-b-2 transition-colors ${
            activeTab === 'products'
              ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          My Crop Listings ({myProducts.filter((p: any) => p.status !== 'DELETED').length})
        </button>
        <button
          onClick={() => setActiveTab('orders')}
          className={`py-2.5 px-3 border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === 'orders'
              ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>Wholesaler Orders ({myOrders.length})</span>
          {pendingOrders.length > 0 && (
            <span className="w-4 h-4 rounded-full bg-amber-500 text-white text-[10px] flex items-center justify-center font-bold">
              {pendingOrders.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('wallet')}
          className={`py-2.5 px-3 border-b-2 transition-colors ${activeTab === 'wallet' ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
        >
          Wallet & Payouts
        </button>
        <button
          onClick={() => setActiveTab('add_product')}
          className={`py-2.5 px-3 border-b-2 transition-colors ${
            activeTab === 'add_product'
              ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          {editingProduct ? 'Edit Crop Listing' : 'Publish New Crop'}
        </button>
      </div>

      {/* TAB 1: Overview & Sales Chart */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  Weekly Sales Revenue & Volume (ETB)
                </h3>
                <p className="text-xs text-slate-400">
                  Direct farm gate dispatches settled through platform escrow
                </p>
              </div>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={salesChartData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(val: any) => [`${Number(val || 0).toLocaleString()} ETB`, 'Revenue']}
                    contentStyle={{ backgroundColor: '#0F172A', borderRadius: '8px', color: '#FFF' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="salesETB"
                    name="Gross Sales (ETB)"
                    stroke="#15803D"
                    fill="#15803D"
                    fillOpacity={0.3}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: My Crop Listings (Edit / Stock / Delete) */}
      {activeTab === 'products' && (
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {myProducts.filter((p: any) => p.status !== 'DELETED').map((p) => (
              <div
                key={p.id}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col justify-between space-y-3"
              >
                <div>
                  <img
                    src={p.images[0] || '/placeholder.svg'}
                    alt={p.title}
                    className="w-full aspect-video rounded-lg object-cover mb-3"
                  />
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-[#15803D] dark:text-emerald-400">{p.category}</span>
                    <span className="text-slate-400">{p.images.length} images</span>
                  </div>
                  <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 mt-1">{p.title}</h4>
                  <div className="text-xs text-slate-400">{p.amharicTitle}</div>
                  <div className="mt-2 text-sm font-mono font-bold text-slate-900 dark:text-slate-100">
                    {p.pricePerUnitETB.toLocaleString()} ETB / {p.unit}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Available: <strong className="font-mono">{p.availableQuantity} {p.unit}</strong>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <button
                    onClick={() => handleStartEdit(p)}
                    className="flex items-center gap-1 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-[#15803D]"
                  >
                    <Edit className="w-3.5 h-3.5" />
                    <span>Edit / Stock</span>
                  </button>

                  <button
                    onClick={async () => { try { await api.products.deleteFarmerListing(p.id); await refetchListings(); setNotification('Product deleted.'); } catch (e: any) { setNotification(e?.message || 'Delete failed.'); } }}
                    className="flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Deactivate</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: Wholesaler Orders (Approve / Reject / Process) */}
      {activeTab === 'orders' && (
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 font-semibold">
                  <th className="py-3 px-3">Order Number</th>
                  <th className="py-3 px-3">Buyer (Wholesaler)</th>
                  <th className="py-3 px-3">Crop / Variety</th>
                  <th className="py-3 px-2 text-right">Qty</th>
                  <th className="py-3 px-3 text-right">Escrow Amount</th>
                  <th className="py-3 px-2">Status</th>
                  <th className="py-3 px-3 text-center">Farmer Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {myOrders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-3 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                      {ord.orderNumber}
                    </td>
                    <td className="py-3 px-3 font-medium text-slate-800 dark:text-slate-200">
                      {ord.buyerName}
                    </td>
                    <td className="py-3 px-3 text-slate-700 dark:text-slate-300">
                      {ord.productTitle}
                    </td>
                    <td className="py-3 px-2 text-right font-mono font-semibold">
                      {ord.quantity} {ord.unit}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
                      {ord.totalAmountETB.toLocaleString()} ETB
                    </td>
                    <td className="py-3 px-2">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 capitalize">
                        {ord.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      {ord.status === 'Pending seller approval' ? (
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => {
                              // Acceptance/rejection needs the full escrow and
                              // delivery context, and rejection requires a
                              // reason, so it happens on the order detail page.
                              setActiveView('orders');
                              navigate(`/orders/${ord.id}`);
                            }}
                            className="px-2.5 py-1 bg-[#15803D] hover:bg-[#166534] text-white font-bold rounded shadow-xs"
                          >
                            Review & respond
                          </button>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-[11px]">
                          Selling is in process ({ord.status})
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: Wallet & Payouts */}
      {activeTab === 'wallet' && (
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/20">
              <p className="text-xs font-semibold text-slate-500">Available Balance</p>
              <p className="text-lg font-bold text-emerald-700">{Number(walletSummary?.available_balance ?? 0).toLocaleString()} ETB</p>
            </div>
            <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20">
              <p className="text-xs font-semibold text-slate-500">Held Balance</p>
              <p className="text-lg font-bold text-amber-700">{Number(walletSummary?.held_balance ?? 0).toLocaleString()} ETB</p>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40">
              <p className="text-xs font-semibold text-slate-500">Bank Accounts</p>
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{walletBankAccounts.length}</p>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold mb-2">Payout Requests</h3>
            {walletPayouts.length === 0 ? (
              <p className="text-xs text-slate-500">No payout requests yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {walletPayouts.map((p: any) => (
                  <li key={p.id} className="py-2 flex items-center justify-between gap-3 text-xs">
                    <span>{p.destination || p.id} · {Number(p.amount ?? 0).toLocaleString()} ETB</span>
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 font-bold">{p.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-sm font-bold mb-2">Recent Wallet Transactions</h3>
            {walletTransactions.length === 0 ? (
              <p className="text-xs text-slate-500">No wallet transactions yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {walletTransactions.slice(0, 10).map((t: any) => (
                  <li key={t.id} className="py-2 flex items-center justify-between gap-3 text-xs">
                    <span>{t.description || t.transaction_type || 'Transaction'}</span>
                    <span className="font-mono font-bold">{Number(t.available_delta ?? 0) >= 0 ? '+' : ''}{Number(t.available_delta ?? 0).toLocaleString()} ETB</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: Add / Edit Product Form (Supports up to 8 images) */}
      {activeTab === 'add_product' && (
        <form
          onSubmit={handleSaveProduct}
          className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-6"
        >
          <div className="border-b border-slate-200 dark:border-slate-800 pb-4">
            <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
              {editingProduct ? 'Edit Produce Listing' : 'Publish Agricultural Produce Listing'}
            </h3>
            <p className="text-xs text-slate-400">
              Upload up to 8 high-resolution photos and define harvest specifications
            </p>
          </div>

          {/* Up to 8 Images Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Product Image Gallery (Up to 8 Images) · {images.length}/8 Uploaded
              </label>
              <div className="flex items-center gap-2">
                <label className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload File</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      handleImageFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </label>
                <label className="px-2.5 py-1 bg-emerald-50 dark:bg-emerald-950/40 text-[#15803D] dark:text-emerald-400 rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
                  <Camera className="w-3.5 h-3.5" />
                  <span>Camera Capture</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      handleImageFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2">
              {images.map((img, idx) => (
                <div
                  key={`saved-${idx}`}
                  className="relative aspect-square rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 group"
                >
                  <img src={img} alt="Crop" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => handleRemoveImage(idx)}
                    className="absolute top-1 right-1 p-1 bg-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {newImagePreviews.map((preview, idx) => (
                <div
                  key={`new-${idx}`}
                  className="relative aspect-square rounded-lg overflow-hidden border border-emerald-300 dark:border-emerald-800 bg-slate-100 group"
                >
                  <img src={preview} alt="New upload" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => handleRemoveNewImage(idx)}
                    className="absolute top-1 right-1 p-1 bg-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Form Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block font-semibold mb-1">Product Title (English)</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Highland Red Beef Tomatoes"
                required
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">Title in Amharic (የምርት ስም)</label>
              <input
                type="text"
                value={amharicTitle}
                onChange={(e) => setAmharicTitle(e.target.value)}
                placeholder="የደጋ ቀይ ቲማቲም"
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">Title in Afaan Oromo (Maqaa Oromiffa)</label>
              <input
                type="text"
                value={oromoTitle}
                onChange={(e) => setOromoTitle(e.target.value)}
                placeholder="Timaatima Diimaa Gaaraa"
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              >
                {(categoryOptions.length > 0
                  ? categoryOptions
                  : [{ value: category, label: category }]
                ).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold mb-1">Price per Unit (ETB)</label>
              <input
                type="number"
                value={pricePerUnitETB}
                onChange={(e) => setPricePerUnitETB(Number(e.target.value))}
                required
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono font-bold"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">Packaging Unit</label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value as any)}
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              >
                <option value="crate (25kg)">crate (25kg)</option>
                <option value="quintal (100kg)">quintal (100kg)</option>
                <option value="kg">kg</option>
                <option value="ton">ton</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold mb-1">Available Stock Quantity</label>
              <input
                type="number"
                value={availableQuantity}
                onChange={(e) => setAvailableQuantity(Number(e.target.value))}
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">Product Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Specify variety, brix rating, post-harvest packaging, and recommended transport speed..."
              rows={3}
              className="w-full text-xs p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setActiveTab('products')}
              className="px-4 py-2 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg shadow-xs"
            >
              {editingProduct ? 'Save Modifications' : 'Publish Listing'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
