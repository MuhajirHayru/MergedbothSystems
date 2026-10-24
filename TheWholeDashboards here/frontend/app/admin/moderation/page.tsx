"use client";

import { useEffect, useState } from "react";
import { Shield, AlertTriangle, Eye, Search, Filter } from "lucide-react";
import { useAuth } from "@/lib/auth/context";

interface ModerationEvent {
  id: number;
  message_id: number;
  user: {
    id: number;
    full_name: string;
    email: string;
  };
  conversation_id: number;
  detected_content_type: string;
  action_taken: string;
  created_at: string;
  reviewed_by?: string;
  review_decision?: string;
}

export default function ModerationReviewPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState<ModerationEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  useEffect(() => {
    loadModerationEvents();
  }, [typeFilter]);

  async function loadModerationEvents() {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (typeFilter) params.append("type", typeFilter);
      if (search) params.append("search", search);
      
      const response = await fetch(`/api/v1/admin/moderation-events/?${params}`, {
        credentials: "include",
      });
      
      if (!response.ok) throw new Error("Failed to load moderation events");
      
      const data = await response.json();
      setEvents(data.results || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load moderation events");
    } finally {
      setLoading(false);
    }
  }

  function getContentTypeBadge(type: string) {
    const typeMap: Record<string, { label: string; className: string }> = {
      phone: { label: "Phone Number", className: "bg-red-100 text-red-800" },
      email: { label: "Email Address", className: "bg-orange-100 text-orange-800" },
      address: { label: "Physical Address", className: "bg-yellow-100 text-yellow-800" },
      whatsapp: { label: "WhatsApp", className: "bg-green-100 text-green-800" },
      telegram: { label: "Telegram", className: "bg-blue-100 text-blue-800" },
      gps: { label: "GPS Coordinates", className: "bg-purple-100 text-purple-800" },
    };
    
    const config = typeMap[type] || { label: type, className: "bg-gray-100 text-gray-800" };
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${config.className}`}>
        {config.label}
      </span>
    );
  }

  function getActionBadge(action: string) {
    const actionMap: Record<string, { label: string; className: string }> = {
      blocked: { label: "Blocked", className: "bg-red-100 text-red-800" },
      warned: { label: "Warning Issued", className: "bg-yellow-100 text-yellow-800" },
      flagged: { label: "Flagged for Review", className: "bg-orange-100 text-orange-800" },
      allowed: { label: "Allowed", className: "bg-green-100 text-green-800" },
    };
    
    const config = actionMap[action] || { label: action, className: "bg-gray-100 text-gray-800" };
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
        <div className="flex items-center gap-3 mb-2">
          <Shield className="h-8 w-8 text-green-700" />
          <h1 className="text-3xl font-bold text-gray-900">Content Moderation</h1>
        </div>
        <p className="text-gray-600">Review flagged messages and privacy violations</p>
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
            placeholder="Search by user email or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadModerationEvents()}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>
        
        <div className="flex gap-2">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
          >
            <option value="">All Types</option>
            <option value="phone">Phone Numbers</option>
            <option value="email">Email Addresses</option>
            <option value="address">Physical Addresses</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="telegram">Telegram</option>
            <option value="gps">GPS Coordinates</option>
          </select>
          
          <button
            onClick={loadModerationEvents}
            className="px-4 py-2 bg-green-700 text-white rounded-lg hover:bg-green-800 transition-colors"
          >
            Search
          </button>
        </div>
      </div>

      {/* Statistics Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Events</p>
              <p className="text-2xl font-bold text-gray-900">{events.length}</p>
            </div>
            <AlertTriangle className="h-8 w-8 text-gray-400" />
          </div>
        </div>
        
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Blocked</p>
              <p className="text-2xl font-bold text-red-600">
                {events.filter(e => e.action_taken === "blocked").length}
              </p>
            </div>
            <Shield className="h-8 w-8 text-red-400" />
          </div>
        </div>
        
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Pending Review</p>
              <p className="text-2xl font-bold text-yellow-600">
                {events.filter(e => e.action_taken === "flagged" && !e.review_decision).length}
              </p>
            </div>
            <Eye className="h-8 w-8 text-yellow-400" />
          </div>
        </div>
        
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Reviewed</p>
              <p className="text-2xl font-bold text-green-600">
                {events.filter(e => e.review_decision).length}
              </p>
            </div>
            <Filter className="h-8 w-8 text-green-400" />
          </div>
        </div>
      </div>

      {/* Moderation Events List */}
      {events.length === 0 ? (
        <div className="text-center py-12 bg-white border border-gray-200 rounded-lg">
          <Shield className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No moderation events found</h3>
          <p className="text-gray-600">
            {search || typeFilter
              ? "Try adjusting your search or filters"
              : "Moderation events will appear here when content is flagged"}
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Content Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Action Taken
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date/Time
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {events.map((event) => (
                <tr key={event.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex flex-col">
                      <div className="text-sm font-medium text-gray-900">
                        {event.user.full_name}
                      </div>
                      <div className="text-sm text-gray-500">
                        {event.user.email}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getContentTypeBadge(event.detected_content_type)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getActionBadge(event.action_taken)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(event.created_at).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {event.review_decision ? (
                      <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">
                        Reviewed
                      </span>
                    ) : (
                      <span className="px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800">
                        Pending
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => {/* Navigate to detail view */}}
                      className="text-green-700 hover:text-green-900"
                    >
                      View Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
