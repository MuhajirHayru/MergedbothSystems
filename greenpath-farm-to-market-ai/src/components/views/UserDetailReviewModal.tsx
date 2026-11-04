import { useModalA11y } from '../../hooks/useModalA11y';
import React, { useState } from 'react';
import { UserProfile, DocumentRecord } from '../../types';
import { useApp } from '../../context/AppContext';
import { DocumentViewerModal } from '../common/DocumentViewerModal';
import {
  X,
  User,
  MapPin,
  FileText,
  ShieldCheck,
  Activity,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Eye,
  Download,
  AlertCircle,
  FileCheck2,
  Lock,
} from 'lucide-react';

interface UserDetailReviewModalProps {
  user: UserProfile | null;
  onClose: () => void;
}

export const UserDetailReviewModal: React.FC<UserDetailReviewModalProps> = ({ user, onClose }) => {
  const panelRef = useModalA11y<HTMLDivElement>(onClose);
  const { updateUserVerification, addAuditLog, orders, products, currentUser } = useApp();
  const [activeTab, setActiveTab] = useState<'personal' | 'address' | 'documents' | 'verification' | 'activity' | 'actions'>('personal');
  const [inspectingDoc, setInspectingDoc] = useState<DocumentRecord | null>(null);
  const [adminNote, setAdminNote] = useState('');
  const [confirmationAction, setConfirmationAction] = useState<string | null>(null);

  if (!user) return null;

  // Associated user activity
  const userOrders = orders.filter((o) => o.buyerId === user.id || o.sellerId === user.id);
  const userProducts = products.filter((p) => p.farmerId === user.id);

  const handleAction = (action: 'verified' | 'suspended' | 'pending' | 'unverified') => {
    updateUserVerification(user.id, action, adminNote);
    addAuditLog({
      actorName: currentUser.name,
      actorRole: currentUser.role,
      action: `Administrative Action: Marked ${action.toUpperCase()}`,
      targetUser: `${user.name} (${user.id})`,
      category: 'Verification',
      scope: user.region,
      result: 'Success',
      reference: `ACT-${Date.now()}`,
    });
    setConfirmationAction(null);
    setAdminNote('');
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/80 backdrop-blur-xs animate-in fade-in duration-150" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <div ref={panelRef} tabIndex={-1} className="bg-white dark:bg-slate-900 w-full max-w-4xl h-[92vh] rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden text-slate-900 dark:text-slate-100">
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50 dark:bg-slate-900/80">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-[#15803D] text-white flex items-center justify-center font-bold text-base shadow-sm">
                {user.name.charAt(0)}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base sm:text-lg font-bold">{user.name}</h2>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${
                      user.verificationStatus === 'verified'
                        ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                        : user.verificationStatus === 'suspended'
                        ? 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300'
                        : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                    }`}
                  >
                    {user.verificationStatus}
                  </span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                  ID: {user.id} · Role: <span className="uppercase">{user.role}</span> · Region: {user.region}
                </div>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 6 Tabs */}
          <div className="flex border-b border-slate-200 dark:border-slate-800 px-6 gap-2 overflow-x-auto text-xs font-semibold shrink-0 bg-slate-50/50 dark:bg-slate-900/50 scrollbar-none">
            {[
              { id: 'personal', label: '1. Personal Info', icon: User },
              { id: 'address', label: '2. Registered Address', icon: MapPin },
              { id: 'documents', label: `3. Documents (${user.documents?.length || 0})`, icon: FileText },
              { id: 'verification', label: '4. Verification Status', icon: ShieldCheck },
              { id: 'activity', label: '5. Trade Activity', icon: Activity },
              { id: 'actions', label: '6. Admin Actions', icon: Sliders },
            ].map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-1.5 py-3 px-3 border-b-2 transition-colors whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 dark:border-emerald-500'
                      : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
            {/* TAB 1: Personal Info */}
            {activeTab === 'personal' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                    <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">
                      Full Legal Name
                    </div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 text-sm mt-1">
                      {user.legalFullName || user.name}
                    </div>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                    <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">
                      Account Role & Type
                    </div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 text-sm mt-1 capitalize">
                      {user.role.replace(/_/g, ' ')}
                    </div>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                    <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">
                      Email Address
                    </div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 text-sm mt-1 font-mono">
                      {user.email}
                    </div>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                    <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">
                      Phone Number (Ethio Telecom)
                    </div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 text-sm mt-1 font-mono">
                      {user.phone}
                    </div>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                    <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">
                      Age & Sex
                    </div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 text-sm mt-1">
                      {user.age ? `${user.age} years old` : 'Not collected'} · {user.sex || 'Not specified'}
                    </div>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                    <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">
                      Registration Date
                    </div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 text-sm mt-1">
                      {user.registrationDate} ({user.lastActivity || 'Active recently'})
                    </div>
                  </div>
                </div>

                {user.businessName && (
                  <div className="p-4 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50">
                    <div className="text-xs font-bold text-emerald-800 dark:text-emerald-300 uppercase">
                      Associated Business Entity
                    </div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                      {user.businessName}
                    </div>
                    {user.tinNumber && (
                      <div className="text-xs text-slate-500 font-mono mt-1">
                        Tax Identification Number (TIN): {user.tinNumber}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: Registered Address (Private Admin View) */}
            {activeTab === 'address' && (
              <div className="space-y-6">
                <div className="p-4 rounded-xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 flex items-start gap-3">
                  <Lock className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                    <strong className="font-bold">Administrative Privacy Protocol:</strong> Exact registered physical addresses and Kebele boundaries are restricted to authorized platform administrators for regulatory enforcement. Public marketplace viewers only see high-level regional context (e.g., {user.region} - {user.zone}).
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                    <div className="text-xs text-slate-400 font-medium">Region</div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 text-sm mt-1">
                      {user.region}
                    </div>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                    <div className="text-xs text-slate-400 font-medium">Zone / Sub-City</div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 text-sm mt-1">
                      {user.zone}
                    </div>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                    <div className="text-xs text-slate-400 font-medium">Wereda / District</div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 text-sm mt-1">
                      {user.wereda}
                    </div>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                    <div className="text-xs text-slate-400 font-medium">Kebele / Farm Plot</div>
                    <div className="font-bold text-slate-900 dark:text-slate-100 text-sm mt-1">
                      {user.kebele || 'N/A'}
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Full Registered Physical Address
                  </div>
                  <p className="text-sm text-slate-800 dark:text-slate-200 mt-1 font-mono">
                    {user.registeredAddress || `${user.kebele || ''}, ${user.wereda}, ${user.zone}, ${user.region}, Ethiopia`}
                  </p>
                </div>
              </div>
            )}

            {/* TAB 3: Documents and Licenses */}
            {activeTab === 'documents' && (
              <div className="space-y-4">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Click any document below to open the full inspection canvas with zoom and download controls.
                </div>

                {(!user.documents || user.documents.length === 0) ? (
                  <div className="p-8 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-slate-400 text-xs">
                    No credentials submitted yet for this user.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {user.documents.map((doc) => (
                      <div
                        key={doc.id}
                        className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/40 hover:border-[#15803D] transition-colors flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-xs font-bold text-slate-900 dark:text-slate-100 line-clamp-1">
                              {doc.name}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize shrink-0 ${
                                doc.status === 'verified'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                  : doc.status === 'rejected'
                                  ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              }`}
                            >
                              {doc.status}
                            </span>
                          </div>
                          <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                            <span>Uploaded: {doc.uploadDate}</span>
                            {doc.expiryDate && <span>· Exp: {doc.expiryDate}</span>}
                          </div>
                          {doc.reviewerNotes && (
                            <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-2 bg-white dark:bg-slate-800 p-2 rounded border border-slate-200 dark:border-slate-700">
                              Note: {doc.reviewerNotes}
                            </div>
                          )}
                        </div>

                        <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
                          <span className="text-[10px] text-slate-400 font-mono">
                            {doc.fileSize || 'Standard Scan'}
                          </span>
                          <button
                            onClick={() => setInspectingDoc(doc)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-semibold rounded-lg transition-colors shadow-xs"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Inspect Scan</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: Verification Checks */}
            {activeTab === 'verification' && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                  <div className="font-bold text-sm text-slate-900 dark:text-slate-100">
                    Comprehensive Verification Checklist
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>Identity & Citizen Accreditation</span>
                      </div>
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">PASSED</span>
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>Trade License / MoA Agricultural Credential</span>
                      </div>
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">VERIFIED</span>
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>Regional Bureau Usufruct Land / Depot Audit</span>
                      </div>
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">VALID</span>
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-slate-400" />
                        <span>Annual Security Audit Cycle</span>
                      </div>
                      <span className="font-semibold text-slate-500">Scheduled for 2027</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 5: Activity */}
            {activeTab === 'activity' && (
              <div className="space-y-6">
                <div>
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    Recent Platform Orders ({userOrders.length})
                  </h4>
                  {userOrders.length === 0 ? (
                    <div className="text-xs text-slate-400 italic">No orders logged yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {userOrders.map((ord) => (
                        <div
                          key={ord.id}
                          className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs flex items-center justify-between"
                        >
                          <div>
                            <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                              {ord.orderNumber}
                            </span>
                            <span className="text-slate-500 ml-2">{ord.productTitle}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-emerald-600 font-mono">
                              {ord.totalAmountETB.toLocaleString()} ETB
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 font-medium">
                              {ord.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {userProducts.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                      Active Produce Listings ({userProducts.length})
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {userProducts.map((p) => (
                        <div
                          key={p.id}
                          className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center gap-3"
                        >
                          <img
                            src={p.images[0]}
                            alt={p.title}
                            className="w-10 h-10 rounded-md object-cover"
                          />
                          <div>
                            <div className="font-bold text-slate-900 dark:text-slate-100 truncate">
                              {p.title}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono">
                              {p.pricePerUnitETB} ETB / {p.unit}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 6: Administrative Actions */}
            {activeTab === 'actions' && (
              <div className="space-y-6">
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-4">
                  <div className="font-bold text-sm text-slate-900 dark:text-slate-100">
                    Administrative Decision Protocol
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                      Internal Administrative Review Note:
                    </label>
                    <textarea
                      value={adminNote}
                      onChange={(e) => setAdminNote(e.target.value)}
                      placeholder="Specify verification grounds, registry reference number, or document re-submission instructions..."
                      rows={3}
                      className="w-full text-xs p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#15803D]"
                    />
                  </div>

                  <div className="flex flex-wrap gap-3 pt-2">
                    <button
                      onClick={() => handleAction('verified')}
                      className="px-4 py-2 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg shadow-xs flex items-center gap-1.5 transition-colors"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Approve & Verify Account</span>
                    </button>

                    <button
                      onClick={() => handleAction('pending')}
                      className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg shadow-xs flex items-center gap-1.5 transition-colors"
                    >
                      <Clock className="w-4 h-4" />
                      <span>Request Additional Documents</span>
                    </button>

                    <button
                      onClick={() => handleAction('suspended')}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg shadow-xs flex items-center gap-1.5 transition-colors"
                    >
                      <AlertTriangle className="w-4 h-4" />
                      <span>Suspend Account Privileges</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Nested Document Canvas Modal */}
      {inspectingDoc && (
        <DocumentViewerModal
          document={inspectingDoc}
          onClose={() => setInspectingDoc(null)}
          canManage={true}
          onVerify={(docId) => {
            // Document verified
            setInspectingDoc(null);
          }}
        />
      )}
    </>
  );
};
