"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft, Package, Truck, MapPin, Phone, User, Clock, MessageSquare, CheckCircle } from "lucide-react";

interface ShipmentDetail {
  id: number;
  order: {
    id: number;
    order_reference: string;
    status: string;
    created_at: string;
    buyer: { full_name: string; phone: string };
    seller: { full_name: string; phone: string };
  };
  driver_shipment_reference: string | null;
  driver_shipment_id: number | null;
  pickup_address_line: string;
  destination_address_line: string;
  pickup_region: { name: string };
  pickup_zone?: { name: string };
  destination_region: { name: string };
  destination_zone?: { name: string };
  delivery_fee_proposed_birr: string;
  driver_status?: string;
  last_status_update?: string;
}

export default function ShipmentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const [shipment, setShipment] = useState<ShipmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadShipment();
  }, [params.id]);

  async function loadShipment() {
    try {
      setLoading(true);
      const response = await fetch(`/api/v1/payments/shipments/${params.id}/`, {
        credentials: "include",
      });
      
      if (!response.ok) throw new Error("Failed to load shipment details");
      
      const data = await response.json();
      setShipment(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load shipment");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-700"></div>
      </div>
    );
  }

  if (error || !shipment) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
            <p className="text-red-700 mb-4">{error || "Shipment not found"}</p>
            <button
              onClick={() => router.push("/logistics")}
              className="px-4 py-2 bg-green-700 text-white rounded-lg hover:bg-green-800"
            >
              Back to Logistics
            </button>
          </div>
        </div>
      </div>
    );
  }

  const timeline = [
    { status: "pending", label: "Order Placed", completed: true },
    { status: "paid", label: "Payment Confirmed", completed: ["paid", "shipment_authorized", "driver_assigned", "in_transit", "delivered", "completed"].includes(shipment.order.status) },
    { status: "shipment_authorized", label: "Finding Driver", completed: ["shipment_authorized", "driver_assigned", "in_transit", "delivered", "completed"].includes(shipment.order.status) },
    { status: "driver_assigned", label: "Driver Assigned", completed: ["driver_assigned", "in_transit", "delivered", "completed"].includes(shipment.order.status) },
    { status: "in_transit", label: "In Transit", completed: ["in_transit", "delivered", "completed"].includes(shipment.order.status) },
    { status: "delivered", label: "Delivered", completed: ["delivered", "completed"].includes(shipment.order.status) },
    { status: "completed", label: "Completed", completed: shipment.order.status === "completed" },
  ];

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => router.push("/logistics")}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Logistics</span>
        </button>
        
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Order {shipment.order.order_reference}
            </h1>
            {shipment.driver_shipment_reference && (
              <p className="text-gray-600">Shipment: {shipment.driver_shipment_reference}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-gray-900">{shipment.delivery_fee_proposed_birr} ETB</p>
            <p className="text-sm text-gray-600">Delivery Fee</p>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">Delivery Timeline</h2>
        <div className="relative">
          {timeline.map((step, index) => (
            <div key={step.status} className="flex items-start mb-8 last:mb-0">
              <div className="flex flex-col items-center mr-4">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  step.completed ? "bg-green-600" : "bg-gray-300"
                }`}>
                  {step.completed ? (
                    <CheckCircle className="h-5 w-5 text-white" />
                  ) : (
                    <div className="w-3 h-3 rounded-full bg-white"></div>
                  )}
                </div>
                {index < timeline.length - 1 && (
                  <div className={`w-0.5 h-12 mt-2 ${
                    step.completed ? "bg-green-600" : "bg-gray-300"
                  }`}></div>
                )}
              </div>
              <div className="flex-1 pt-1">
                <p className={`font-medium ${step.completed ? "text-gray-900" : "text-gray-500"}`}>
                  {step.label}
                </p>
                {step.completed && step.status === shipment.order.status && (
                  <p className="text-sm text-gray-600 mt-1">Current status</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pickup & Delivery Info */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Pickup & Delivery</h2>
          
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 text-gray-400 mt-1 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900 mb-1">Pickup Location</p>
                <p className="text-sm text-gray-600">{shipment.pickup_region.name}</p>
                {shipment.pickup_zone && (
                  <p className="text-sm text-gray-600">{shipment.pickup_zone.name}</p>
                )}
                {shipment.driver_shipment_id && (
                  <p className="text-sm text-gray-500 mt-1">{shipment.pickup_address_line}</p>
                )}
              </div>
            </div>

            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 text-green-600 mt-1 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900 mb-1">Delivery Location</p>
                <p className="text-sm text-gray-600">{shipment.destination_region.name}</p>
                {shipment.destination_zone && (
                  <p className="text-sm text-gray-600">{shipment.destination_zone.name}</p>
                )}
                {shipment.driver_shipment_id && (
                  <p className="text-sm text-gray-500 mt-1">{shipment.destination_address_line}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Seller Info */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Seller Information</h2>
          
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <User className="h-5 w-5 text-gray-400" />
              <div>
                <p className="text-sm font-medium text-gray-900">{shipment.order.seller.full_name}</p>
                <p className="text-sm text-gray-600">Seller</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <Phone className="h-5 w-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-900">{shipment.order.seller.phone}</p>
                <p className="text-sm text-gray-600">Contact</p>
              </div>
            </div>
          </div>
        </div>

        {/* Driver Info (if assigned) */}
        {shipment.driver_shipment_id && (
          <div className="bg-white border border-gray-200 rounded-lg p-6 lg:col-span-2">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Driver Information</h2>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                  <Truck className="h-6 w-6 text-green-700" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">Driver Assigned</p>
                  <p className="text-sm text-gray-600">Shipment ID: {shipment.driver_shipment_id}</p>
                  {shipment.last_status_update && (
                    <p className="text-xs text-gray-500 mt-1">
                      Last update: {new Date(shipment.last_status_update).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
              
              <button
                onClick={() => router.push(`/chat?shipment=${shipment.driver_shipment_id}`)}
                className="flex items-center gap-2 px-4 py-2 bg-green-700 text-white rounded-lg hover:bg-green-800"
              >
                <MessageSquare className="h-4 w-4" />
                <span>Message</span>
              </button>
            </div>
          </div>
        )}

        {/* Order Details */}
        <div className="bg-white border border-gray-200 rounded-lg p-6 lg:col-span-2">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Order Details</h2>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-gray-600 mb-1">Order Date</p>
              <p className="text-sm font-medium text-gray-900">
                {new Date(shipment.order.created_at).toLocaleDateString()}
              </p>
            </div>
            
            <div>
              <p className="text-sm text-gray-600 mb-1">Status</p>
              <p className="text-sm font-medium text-gray-900 capitalize">
                {shipment.order.status.replace(/_/g, " ")}
              </p>
            </div>
            
            <div>
              <p className="text-sm text-gray-600 mb-1">Delivery Fee</p>
              <p className="text-sm font-medium text-gray-900">
                {shipment.delivery_fee_proposed_birr} ETB
              </p>
            </div>
            
            <div>
              <p className="text-sm text-gray-600 mb-1">Order ID</p>
              <p className="text-sm font-medium text-gray-900">
                {shipment.order.order_reference}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
