"use client";

import { useEffect, useState } from "react";
import { FileText, DollarSign, CreditCard, TrendingUp, Search, Download } from "lucide-react";
import { useAuth } from "@/lib/auth/context";

interface AuditEvent {
  id: number;
  action: string;
  actor: {
    full_name: string;
    email: string;
  };
  target_user?: {
    full_name: string;
    email: string;
  };
  details: string;
  amount?: string;
  reference?: string;
  created_at: string;
}

export default function FinancialAuditPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    loadAuditEvents();
  }, [actionFilter]);

  async function loadAuditEvents() {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (actionFilter) params.append("action", actionFilter);
      if (search) params.append("search", search);
      if (dateFrom) params.append("date_from", dateFrom);
      if (dateTo) params.append("date_to", dateTo);
      
      const response = await fetch(`/api/v1/financial-manager/audit/?${params}`, {
        credentials: "include",
      });
      
      if (!response.ok) throw new Error("Failed to load audit events");
      
      const data = await response.json();
      setEvents(data.results || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit events");
    } finally {
      setLoading(false);
    }
  }

  function getActionBadge(action: string) {
    const actionMap: Record<string, { label: string; className: string }> = {
      withdrawal_request: { label: "Withdrawal Request", className: "bg-blue-100 text-blue-800" },
      withdrawal_approved: { label: "Withdrawal Approved", className: "bg-green-100 text-green-800" },
      withdrawal_rejected: { label: "Withdrawal Rejected", className: "bg-red-100 text-red-800" },
      wallet_credit: { label: "Wallet Credit", className: "bg-green-100 text-green-800" },
      wallet_debit: { label: "Wallet Debit", className: "bg-red-100 text-red-800" },
      escrow_hold: { label: "Escrow Hold", className: "bg-yellow-100 text-yellow-800" },
      escrow_release: { label: "Escrow Release", className: "bg-green-100 text-green-800" },
      bank_account_added: { label: "Bank Account Added", className: "bg-purple-100 text-purple-800" },
      bank_account_verified: { label: "Bank Verified", className: "bg-green-100 text-green-800" },
      delivery_fee_credited: { label: "Delivery Fee Paid", className: "bg-green-100 text-green-800" },
    };
    
    const config = actionMap[action] || { label: action.replace(/_/g, " "), className: "bg-gray-100 text-gray-800" };
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${config.className}`}>
        {config.label}
      </span>
    );
  }

  async function exportToCSV() {
    try {
      const params = new URLSearchParams();
      if (actionFilter) params.append("action", actionFilter);
      if (search) params.append("search", search);
      if (dateFrom) params.append("date_from", dateFrom);
      if (dateTo) params.append("date_to", dateTo);
      params.append("export", "csv");
      
      const response = await fetch(`/api/v1/financial-manager/audit/?${params}`, {
        credentials: "include",
      });
      
      if (!response.ok) throw new Error("Failed to export audit data");
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `financial-audit-${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export audit data");
    }
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
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <FileText className="h-8 w-8 text-green-700" />
              <h1 className="text-3xl font-bold text-gray-900">Financial Audit Trail</h1>
            </div>
            <p className="text-gray-600">Track all financial operations and approvals</p>
          </div>
          <button
            onClick={exportToCSV}
            className="flex items-center gap-2 px-4 py-2 bg-green-700 text-white rounded-lg hover:bg-green-800"
          >
            <Download className="h-4 w-4" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 space-y-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by user, reference, or details..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadAuditEvents()}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>
          
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
          >
            <option value="">All Actions</option>
            <option value="withdrawal_request">Withdrawal Requests</option>
            <option value="withdrawal_approved">Withdrawals Approved</option>
            <option value="withdrawal_rejected">Withdrawals Rejected</option>
            <option value="wallet_credit">Wallet Credits</option>
            <option value="escrow_release">Escrow Releases</option>
            <option value="bank_account_verified">Bank Verifications</option>
            <option value="delivery_fee_credited">Delivery Fees</option>
          </select>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>
          
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>
          
          <div className="flex items-end">
            <button
              onClick={loadAuditEvents}
              className="px-6 py-2 bg-green-700 text-white rounded-lg hover:bg-green-800 transition-colors"
            >
              Apply Filters
            </button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Events</p>
              <p className="text-2xl font-bold text-gray-900">{events.length}</p>
            </div>
            <FileText className="h-8 w-8 text-gray-400" />
          </div>
        </div>
        
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Withdrawals</p>
              <p className="text-2xl font-bold text-blue-600">
                {events.filter(e => e.action.includes("withdrawal")).length}
              </p>
            </div>
            <DollarSign className="h-8 w-8 text-blue-400" />
          </div>
        </div>
        
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Credits</p>
              <p className="text-2xl font-bold text-green-600">
                {events.filter(e => e.action.includes("credit") || e.action.includes("release")).length}
              </p>
            </div>
            <TrendingUp className="h-8 w-8 text-green-400" />
          </div>
        </div>
        
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Bank Actions</p>
              <p className="text-2xl font-bold text-purple-600">
                {events.filter(e => e.action.includes("bank")).length}
              </p>
            </div>
            <CreditCard className="h-8 w-8 text-purple-400" />
          </div>
        </div>
      </div>

      {/* Audit Events Table */}
      {events.length === 0 ? (
        <div className="text-center py-12 bg-white border border-gray-200 rounded-lg">
          <FileText className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No audit events found</h3>
          <p className="text-gray-600">
            {search || actionFilter || dateFrom || dateTo
              ? "Try adjusting your search or filters"
              : "Financial audit events will appear here"}
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date/Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Action
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actor
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Target User
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Reference
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {events.map((event) => (
                  <tr key={event.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {new Date(event.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getActionBadge(event.action)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <div className="text-sm font-medium text-gray-900">
                          {event.actor.full_name}
                        </div>
                        <div className="text-sm text-gray-500">
                          {event.actor.email}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {event.target_user ? (
                        <div className="flex flex-col">
                          <div className="text-sm font-medium text-gray-900">
                            {event.target_user.full_name}
                          </div>
                          <div className="text-sm text-gray-500">
                            {event.target_user.email}
                          </div>
                        </div>
                      ) : (
                        <span className="text-sm text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {event.amount ? `${event.amount} ETB` : "—"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {event.reference || "—"}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900 max-w-xs truncate">
                      {event.details}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
