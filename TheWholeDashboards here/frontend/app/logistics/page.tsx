"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Package, Truck, MapPin, Clock, Search, Filter } from "lucide-react";
import { useAuth } from "@/lib/auth/context";

interface Shipment {
  id: number;
  order: {
    id: number;
    order_reference: string;
    status: string;
    created_at: string;
    seller: {
      full_name: string;
    };
  };
  driver_shipment_reference: string | null;
  driver_shipment_id: number | null;
  pickup_address_line: string;
  destination_address_line: string;
  pickup_region: { name: string };
  destination_region: { name: string };
  delivery_fee_proposed_birr: string;
  driver_status?: string;
  last_status_update?: string;
}

export default function LogisticsTrackingPage() {
  const router = useRouter();
  const { isAuthenticated, user } = useAuth();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }
    loadShipments();
  }, [isAuthenticated, router, statusFilter]);

  async function loadShipments() {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter) params.append("status", statusFilter);
      if (search) params.append("search", search);
      
      const response = await fetch(`/api/v1/payments/shipments/?${params}`, {
        credentials: "include",
      });
      
      if (!response.ok) throw new Error("Failed to load shipments");
      
      const data = await response.json();
      setShipments(data.results || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load shipments");
    } finally {
      setLoading(false);
    }
  }

  function getStatusBadge(status: string) {
    const statusMap: Record<string, { label: string; className: string }> = {
      pending: { label: "Pending", className: "bg-yellow-100 text-yellow-800" },
      payment_pending: { label: "Payment Pending", className: "bg-yellow-100 text-yellow-800" },
      paid: { label: "Paid", className: "bg-blue-100 text-blue-800" },
      shipment_authorized: { label: "Finding Driver", className: "bg-purple-100 text-purple-800" },
      driver_assigned: { label: "Driver Assigned", className: "bg-indigo-100 text-indigo-800" },
      in_transit: { label: "In Transit", className: "bg-blue-100 text-blue-800" },
      delivered: { label: "Delivered", className: "bg-green-100 text-green-800" },
      completed: { label: "Completed", className: "bg-green-100 text-green-800" },
      cancelled: { label: "Cancelled", className: "bg-gray-100 text-gray-800" },
    };
    
    const config = statusMap[status] || { label: status, className: "bg-gray-100 text-gray-800" };
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${config.className}`}>
        {config.label}
      </span>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-700"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Logistics Tracking</h1>
        <p className="text-gray-600">Track your order deliveries and shipment status</p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by order or shipment reference..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadShipments()}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>
        
        <div className="flex gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="shipment_authorized">Finding Driver</option>
            <option value="driver_assigned">Driver Assigned</option>
            <option value="in_transit">In Transit</option>
            <option value="delivered">Delivered</option>
            <option value="completed">Completed</option>
          </select>
          
          <button
            onClick={loadShipments}
            className="px-4 py-2 bg-green-700 text-white rounded-lg hover:bg-green-800 transition-colors"
          >
            Search
          </button>
        </div>
      </div>

      {/* Shipments List */}
      {shipments.length === 0 ? (
        <div className="text-center py-12">
          <Package className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No shipments found</h3>
          <p className="text-gray-600">
            {search || statusFilter
              ? "Try adjusting your search or filters"
              : "Your order shipments will appear here once they're ready for delivery"}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {shipments.map((shipment) => (
            <div
              key={shipment.id}
              onClick={() => router.push(`/logistics/${shipment.id}`)}
              className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-lg transition-shadow cursor-pointer"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold text-gray-900">
                      Order {shipment.order.order_reference}
                    </h3>
                    {getStatusBadge(shipment.order.status)}
                  </div>
                  {shipment.driver_shipment_reference && (
                    <p className="text-sm text-gray-600">
                      Shipment: {shipment.driver_shipment_reference}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-gray-900">
                    {shipment.delivery_fee_proposed_birr} ETB
                  </p>
                  <p className="text-xs text-gray-500">Delivery Fee</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div className="flex items-start gap-3">
                  <MapPin className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">Pickup</p>
                    <p className="text-sm text-gray-600">{shipment.pickup_region.name}</p>
                    {shipment.driver_shipment_id && (
                      <p className="text-xs text-gray-500">{shipment.pickup_address_line}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <MapPin className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">Delivery</p>
                    <p className="text-sm text-gray-600">{shipment.destination_region.name}</p>
                    {shipment.driver_shipment_id && (
                      <p className="text-xs text-gray-500">{shipment.destination_address_line}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Clock className="h-4 w-4" />
                  <span>Ordered {new Date(shipment.order.created_at).toLocaleDateString()}</span>
                </div>
                
                {shipment.driver_shipment_id ? (
                  <div className="flex items-center gap-2 text-sm text-green-700 font-medium">
                    <Truck className="h-4 w-4" />
                    <span>Driver Assigned</span>
                  </div>
                ) : (
                  <span className="text-sm text-gray-500">Awaiting driver assignment</span>
                )}
              </div>

              <div className="mt-4 text-sm text-gray-600">
                <span className="font-medium">Seller:</span> {shipment.order.seller.full_name}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
