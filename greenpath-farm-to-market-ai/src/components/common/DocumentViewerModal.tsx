import React, { useState } from 'react';
import { DocumentRecord } from '../../types';
import { X, ZoomIn, ZoomOut, Download, CheckCircle2, AlertTriangle, ShieldCheck, FileText, Calendar, UserCheck } from 'lucide-react';

interface DocumentViewerModalProps {
  document: DocumentRecord | null;
  onClose: () => void;
  onVerify?: (docId: string) => void;
  onReject?: (docId: string, reason: string) => void;
  canManage?: boolean;
}

export const DocumentViewerModal: React.FC<DocumentViewerModalProps> = ({
  document,
  onClose,
  onVerify,
  onReject,
  canManage = false,
}) => {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  if (!document) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 w-full max-w-4xl h-[90vh] rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden text-slate-900 dark:text-slate-100">
        {/* Top Bar */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50 dark:bg-slate-900/80">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-950/80 text-[#15803D] dark:text-emerald-400">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm sm:text-base">{document.name}</h3>
              <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                <span>Uploaded: {document.uploadDate}</span>
                {document.fileSize && <span>· {document.fileSize}</span>}
                {document.expiryDate && (
                  <span className="text-amber-600 dark:text-amber-400 font-medium">
                    · Valid until: {document.expiryDate}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setZoomLevel((z) => Math.max(0.7, z - 0.2))}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
              title="Zoom out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono font-medium px-1">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              onClick={() => setZoomLevel((z) => Math.min(2.5, z + 0.2))}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
              title="Zoom in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <a
              href={document.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 ml-1"
              title="Download original scan"
            >
              <Download className="w-4 h-4" />
            </a>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Document Inspection Canvas */}
        <div className="flex-1 bg-slate-100 dark:bg-slate-950 overflow-auto p-4 flex items-center justify-center relative">
          <div
            style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'center center' }}
            className="transition-transform duration-100 max-w-full max-h-full shadow-2xl rounded-lg overflow-hidden bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800"
          >
            <img
              src={document.fileUrl}
              alt={document.name}
              className="max-h-[65vh] w-auto object-contain block"
            />
          </div>
        </div>

        {/* Status & Review Controls */}
        <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Current Status:
            </span>
            <span
              className={`text-xs font-bold px-2.5 py-0.5 rounded-full capitalize ${
                document.status === 'verified'
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  : document.status === 'rejected'
                  ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
              }`}
            >
              {document.status}
            </span>
            {document.verifiedBy && (
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                · Verified by: {document.verifiedBy}
              </span>
            )}
          </div>

          {canManage && (
            <div className="flex items-center gap-2">
              {showRejectInput ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Reason for rejection..."
                    className="text-xs px-2.5 py-1.5 border border-red-300 dark:border-red-900 rounded-md bg-red-50/50 dark:bg-red-950/20 w-48 text-slate-900 dark:text-slate-100"
                  />
                  <button
                    onClick={() => {
                      if (onReject && rejectReason) {
                        onReject(document.id, rejectReason);
                        setShowRejectInput(false);
                      }
                    }}
                    className="px-3 py-1.5 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-md"
                  >
                    Confirm Reject
                  </button>
                  <button
                    onClick={() => setShowRejectInput(false)}
                    className="text-xs text-slate-500 hover:text-slate-700"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => setShowRejectInput(true)}
                    className="px-3 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 rounded-lg transition-colors border border-red-200 dark:border-red-900/60"
                  >
                    Flag / Reject Document
                  </button>
                  {onVerify && (
                    <button
                      onClick={() => onVerify(document.id)}
                      className="px-4 py-1.5 text-xs font-semibold bg-[#15803D] hover:bg-[#166534] text-white rounded-lg transition-colors shadow-xs flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Verify & Approve Document</span>
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
