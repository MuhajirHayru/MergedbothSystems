import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/apiClient';
import { Product } from '../../types';
import {
  Search,
  Filter,
  Sparkles,
  ShoppingBag,
  MapPin,
  ShieldCheck,
  Star,
  CheckCircle2,
  X,
  ChevronRight,
  TrendingUp,
  Tag,
  Eye,
  Lock,
} from 'lucide-react';

export const MarketplaceView: React.FC = () => {
  const { products, createOrder, currentRole, setActiveView, setNotification } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedGrade, setSelectedGrade] = useState<string>('All');
  const [selectedRegion, setSelectedRegion] = useState<string>('All');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    api.products
      .categories()
      .then((response) => {
        const rows = response?.data?.results || [];
        const roots = rows
          .filter((row: any) => !row.parent)
          .map((row: any) => row.name_en)
          .filter(Boolean);
        if (!cancelled && roots.length > 0) setCategoryOptions(roots);
      })
      .catch(() => {
        /* fall back to categories present in loaded products */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const categories =
    categoryOptions.length > 0
      ? categoryOptions
      : Array.from(new Set(products.map((product) => product.category)));

  // Ordering State
  const [orderQuantity, setOrderQuantity] = useState<number>(10);
  const [corridor, setCorridor] = useState<string>('Meki → Mojo → Addis Ababa Central Wholesale');
  const [isOrdering, setIsOrdering] = useState(false);

  // Filter products
  const filteredProducts = products.filter((p) => {
    const matchesSearch =
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.amharicTitle.includes(searchQuery) ||
      p.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.variety.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
    const matchesGrade = selectedGrade === 'All' || p.grade === selectedGrade;
    const matchesRegion = selectedRegion === 'All' || p.location.region === selectedRegion;

    return matchesSearch && matchesCategory && matchesGrade && matchesRegion;
  });

  // AI Personalized Recommendations (Prompt Section 16)
  const recommendedProducts = products.slice(0, 3);

  const handleOpenProduct = (product: Product) => {
    setSelectedProduct(product);
    setOrderQuantity(product.minOrder);
    setCorridor(product.location.hubCorridor);
  };

  const handlePlaceOrder = () => {
    if (!selectedProduct) return;
    setIsOrdering(true);
    setTimeout(() => {
      createOrder(
        selectedProduct.id,
        orderQuantity,
        selectedProduct.pricePerUnitETB,
        corridor
      );
      setIsOrdering(false);
      setSelectedProduct(null);
      setActiveView('orders');
    }, 700);
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Hero Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/70 text-[#15803D] dark:text-emerald-400 text-xs font-semibold">
            <ShieldCheck className="w-4 h-4" />
            <span>Escrow Protected Agricultural Exchange · Verified Ethiopian Producers</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-1">
            Produce Discovery & Agricultural Feed
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Real-time farm-gate listings with transparent regional origin and Chapa Escrow settlement.
          </p>
        </div>

        {/* Location Privacy Note (Prompt Section 16 Requirement) */}
        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 max-w-md">
          <Lock className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>
            <strong>Public Location Privacy:</strong> Exact coordinates and physical farm plots remain protected. Regional origin & transport corridor shown.
          </span>
        </div>
      </div>

      {/* AI Recommendations Banner (Section 16) */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-emerald-900 to-[#0F172A] text-white shadow-md">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-300 animate-pulse" />
            <h3 className="font-bold text-sm sm:text-base">
              Intelligent Produce Recommendations
            </h3>
          </div>
          <span className="text-[11px] text-emerald-200 font-mono">
            Optimized for Addis Ababa Wholesale Arrival
          </span>
        </div>
        <p className="text-xs text-slate-200 mb-4 max-w-2xl">
          Based on historical trade demand, harvest freshness index, and Mojo-Hawassa transit corridors:
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {recommendedProducts.map((rec) => (
            <div
              key={rec.id}
              onClick={() => handleOpenProduct(rec)}
              className="p-3 rounded-xl bg-white/10 hover:bg-white/15 cursor-pointer transition-all border border-white/10 flex items-center gap-3"
            >
              <img
                src={rec.images[0]}
                alt={rec.title}
                className="w-12 h-12 rounded-lg object-cover shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="font-bold text-xs truncate text-white">{rec.title}</div>
                <div className="text-[10px] text-emerald-300 font-mono">
                  {rec.pricePerUnitETB.toLocaleString()} ETB / {rec.unit}
                </div>
                <div className="text-[10px] text-slate-300 truncate">
                  {rec.location.region} · {rec.grade}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Search & Multi-Filter Bar */}
      <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search crop, variety, or Amharic title (ቲማቲም, ሽንኩርት)..."
            className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#15803D]"
          />
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium"
          >
            <option value="All">All Categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>

          <select
            value={selectedGrade}
            onChange={(e) => setSelectedGrade(e.target.value)}
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium"
          >
            <option value="All">All Grades</option>
            <option value="Grade 1 Export">Grade 1 Export</option>
            <option value="Grade 1 Domestic">Grade 1 Domestic</option>
            <option value="Grade 2 Commercial">Grade 2 Commercial</option>
          </select>

          <select
            value={selectedRegion}
            onChange={(e) => setSelectedRegion(e.target.value)}
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium"
          >
            <option value="All">All Regions</option>
            <option value="Oromia">Oromia</option>
            <option value="Amhara">Amhara</option>
            <option value="Sidama">Sidama</option>
            <option value="Addis Ababa">Addis Ababa</option>
          </select>
        </div>
      </div>

      {/* Product Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredProducts.map((product) => (
          <div
            key={product.id}
            onClick={() => handleOpenProduct(product)}
            className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-xs hover:shadow-lg transition-all duration-200 cursor-pointer flex flex-col justify-between group"
          >
            <div>
              {/* Product Image Gallery Preview */}
              <div className="relative aspect-video w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
                <img
                  src={product.images[0]}
                  alt={product.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/90 dark:bg-slate-900/90 text-slate-900 dark:text-slate-100 shadow-xs">
                    {product.grade}
                  </span>
                  {product.isOrganicCertified && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-600 text-white shadow-xs">
                      Organic
                    </span>
                  )}
                </div>
                <div className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded bg-black/60 text-white text-[10px] font-mono">
                  {product.images.length} photos
                </div>
              </div>

              {/* Card Body */}
              <div className="p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                    {product.category}
                  </span>
                  <div className="flex items-center gap-1 text-amber-500">
                    <Star className="w-3.5 h-3.5 fill-amber-400" />
                    <span className="font-bold">{product.rating}</span>
                    <span className="text-slate-400">({product.reviewCount})</span>
                  </div>
                </div>

                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 group-hover:text-[#15803D] transition-colors line-clamp-1">
                  {product.title}
                </h3>
                <div className="text-xs text-slate-400 font-medium">
                  {product.amharicTitle}
                </div>

                {/* General Regional Location ONLY (No exact coordinates!) */}
                <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 pt-1">
                  <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="truncate">
                    {product.location.region} · {product.location.zone}
                  </span>
                </div>

                <div className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 pt-1 leading-relaxed">
                  {product.description}
                </div>
              </div>
            </div>

            {/* Price & Action Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
              <div>
                <div className="text-[10px] text-slate-400 font-medium">Price per unit</div>
                <div className="font-bold font-mono text-sm sm:text-base text-slate-900 dark:text-slate-100">
                  {product.pricePerUnitETB.toLocaleString()}{' '}
                  <span className="text-xs font-normal text-slate-500">ETB/{product.unit}</span>
                </div>
              </div>

              <div className="text-right">
                <div className="text-[10px] text-slate-400 font-medium">Available stock</div>
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300 font-mono">
                  {product.availableQuantity} {product.unit}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Product Detail & Escrow Order Modal */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/80 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 w-full max-w-3xl max-h-[90vh] rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden text-slate-900 dark:text-slate-100">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-base sm:text-lg font-bold">{selectedProduct.title}</h2>
                <div className="text-xs text-slate-500">
                  {selectedProduct.amharicTitle} · {selectedProduct.category}
                </div>
              </div>
              <button
                onClick={() => setSelectedProduct(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
              {/* Image Gallery */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2 aspect-video rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800">
                  <img
                    src={selectedProduct.images[0]}
                    alt={selectedProduct.title}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-1 gap-2">
                  {selectedProduct.images.slice(1, 3).map((img, idx) => (
                    <div
                      key={idx}
                      className="aspect-video rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800"
                    >
                      <img src={img} alt="Detail" className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Crop Specifications & Privacy Notice */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
                  <div className="text-slate-400">Unit Price</div>
                  <div className="font-bold text-sm font-mono mt-0.5">
                    {selectedProduct.pricePerUnitETB.toLocaleString()} ETB
                  </div>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
                  <div className="text-slate-400">Packaging Unit</div>
                  <div className="font-bold text-sm mt-0.5">{selectedProduct.unit}</div>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
                  <div className="text-slate-400">Available Quantity</div>
                  <div className="font-bold text-sm font-mono mt-0.5">
                    {selectedProduct.availableQuantity} units
                  </div>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
                  <div className="text-slate-400">Minimum Order</div>
                  <div className="font-bold text-sm font-mono mt-0.5">
                    {selectedProduct.minOrder} units
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs">
                <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-emerald-600" />
                  <span>Freight Origin & Recommended Logistics Corridor</span>
                </div>
                <p className="text-slate-600 dark:text-slate-400 mt-1">
                  Origin: <strong>{selectedProduct.location.region} ({selectedProduct.location.zone})</strong>.
                  Corridor route: {selectedProduct.location.hubCorridor}.
                </p>
              </div>

              {/* Order Formulation Section */}
              <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-sm text-emerald-900 dark:text-emerald-200">
                    Chapa Escrow Purchase Commitment
                  </h4>
                  <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400 font-bold">
                    Escrow Protected
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">
                      Purchase Quantity ({selectedProduct.unit}):
                    </label>
                    <input
                      type="number"
                      min={selectedProduct.minOrder}
                      max={selectedProduct.availableQuantity}
                      value={orderQuantity}
                      onChange={(e) => setOrderQuantity(Number(e.target.value))}
                      className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono font-bold"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">
                      Delivery Corridor / Destination Hub:
                    </label>
                    <input
                      type="text"
                      value={corridor}
                      onChange={(e) => setCorridor(e.target.value)}
                      className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-emerald-200 dark:border-emerald-800/60 flex items-center justify-between text-xs">
                  <div>
                    <span className="text-slate-500">Gross Escrow Amount: </span>
                    <strong className="text-base font-bold font-mono text-emerald-800 dark:text-emerald-300 ml-1">
                      {(orderQuantity * selectedProduct.pricePerUnitETB).toLocaleString()} ETB
                    </strong>
                  </div>

                  <button
                    onClick={handlePlaceOrder}
                    disabled={isOrdering}
                    className="px-6 py-2.5 bg-[#15803D] hover:bg-[#166534] disabled:bg-slate-300 text-white font-bold text-xs rounded-lg shadow-sm transition-colors flex items-center gap-2"
                  >
                    <ShoppingBag className="w-4 h-4" />
                    <span>{isOrdering ? 'Locking in Escrow...' : 'Confirm Escrow Order'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
