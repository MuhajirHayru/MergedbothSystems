import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/apiClient';
import { formatApiError } from '../../lib/apiErrors';
import {
  ACTION_LABELS,
  ApiOrder,
  ApiShipmentDetails,
  ORDER_LIFECYCLE,
  buyerIdOf,
  formatDateTime,
  formatEtb,
  formatQuantity,
  isBuyer,
  isSeller,
  mediaUrl,
  paymentClasses,
  sellerIdOf,
  shipmentStateLabel,
  statusClasses,
} from '../../lib/orders';
import { LocationPicker, AdministrativeLocation } from '../staff/LocationPicker';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquare,
  Package,
  ShieldCheck,
  Truck,
  User,
  XCircle,
} from 'lucide-react';

type LoadState = 'loading' | 'ready' | 'missing' | 'denied' | 'error';

interface Props {
  orderId: string;
}

const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
    <div className="text-[11px] text-slate-500 dark:text-slate-400">{label}</div>
    <div className="text-sm font-semibold mt-0.5 break-words">{value}</div>
  </div>
);

export const OrderDetailView: React.FC<Props> = ({ orderId }) => {
  const { currentUser, currentRole, setActiveView, setNotification } = useApp();
  const navigate = useNavigate();

  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [order, setOrder] = useState<ApiOrder | null>(null);
  const [shipment, setShipment] = useState<ApiShipmentDetails | null>(null);
  const [shipmentLoaded, setShipmentLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [feeRevision, setFeeRevision] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [pickupPath, setPickupPath] = useState<AdministrativeLocation[]>([]);
  const [destinationPath, setDestinationPath] = useState<AdministrativeLocation[]>([]);
  const [pickupAddress, setPickupAddress] = useState('');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [cargoWeight, setCargoWeight] = useState('');
  const [packaging, setPackaging] = useState('');
  const [feeProposal, setFeeProposal] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      const res = await api.orders.detail(orderId);
      setOrder(res.data as ApiOrder);
      setState('ready');
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 404) {
        setState('missing');
        setError(
          'This order does not exist, or your account is not a participant in it.'
        );
      } else if (status === 401 || status === 403) {
        setState('denied');
        setError(formatApiError(err, 'You are not authorized to view this order.'));
      } else {
        setState('error');
        setError(formatApiError(err, 'The order could not be loaded.'));
      }
    }
  }, [orderId]);

  const loadShipment = useCallback(async () => {
    try {
      const res = await api.orders.shipmentDetails(orderId);
      setShipment(res.data as ApiShipmentDetails);
    } catch (err: any) {
      // 404 simply means the buyer and seller have not started the delivery
      // arrangement yet; every other failure is shown to the user.
      if (err?.response?.status !== 404) {
        setActionError(
          formatApiError(err, 'The delivery arrangement could not be loaded.')
        );
      }
      setShipment(null);
    } finally {
      setShipmentLoaded(true);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
    void loadShipment();
  }, [load, loadShipment]);

  const refresh = async () => {
    await Promise.all([load(), loadShipment()]);
  };

  const run = async (action: () => Promise<any>, successMessage: string) => {
    setBusy(true);
    setActionError('');
    try {
      await action();
      setNotification?.(successMessage);
      await refresh();
      return true;
    } catch (err: any) {
      setActionError(formatApiError(err, 'The action could not be completed.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleTransition = (next: string) => {
    if (next === 'Rejected') {
      setRejectReason('');
      setRejectOpen(true);
      return;
    }
    void run(
      () => api.orders.updateStatus(orderId, { status: next }),
      `Order moved to ${next}.`
    );
  };

  const submitRejection = async () => {
    const reason = rejectReason.trim();
    if (!reason) {
      setActionError('Give the buyer a reason for rejecting this order.');
      return;
    }
    const ok = await run(
      () => api.orders.updateStatus(orderId, { status: 'Rejected', reason }),
      'Order rejected and the buyer\'s funds returned.'
    );
    if (ok) {
      setRejectOpen(false);
      setRejectReason('');
    }
  };

  const submitDispute = async () => {
    const reason = disputeReason.trim();
    if (!reason) {
      setActionError('Describe the quality problem before raising a dispute.');
      return;
    }
    const ok = await run(
      () => api.orders.dispute(orderId, { reason }),
      'Dispute recorded for financial review.'
    );
    if (ok) {
      setDisputeOpen(false);
      setDisputeReason('');
    }
  };

  const submitShipment = async () => {
    if (pickupPath.length === 0 || destinationPath.length === 0) {
      setActionError('Choose the pickup and destination regions.');
      return;
    }
    if (!pickupAddress.trim() || !destinationAddress.trim() || !packaging.trim()) {
      setActionError('Fill the pickup address, destination address and packaging details.');
      return;
    }
    if (!(Number(cargoWeight) > 0)) {
      setActionError('Enter a cargo weight greater than zero kilograms.');
      return;
    }
    if (meIsBuyer && !(Number(feeProposal) > 0)) {
      setActionError('Propose a positive delivery fee in ETB.');
      return;
    }

    const payload: Record<string, any> = {
      pickup_region: pickupPath[0].id,
      pickup_zone: pickupPath[1]?.id ?? null,
      pickup_wereda: pickupPath[2]?.id ?? null,
      pickup_address_line: pickupAddress.trim(),
      destination_region: destinationPath[0].id,
      destination_zone: destinationPath[1]?.id ?? null,
      destination_wereda: destinationPath[2]?.id ?? null,
      destination_address_line: destinationAddress.trim(),
      cargo_weight_kg: String(Number(cargoWeight)),
      packaging_details: packaging.trim(),
    };
    if (meIsBuyer) payload.delivery_fee_proposal_amount = String(Number(feeProposal));

    const ok = await run(
      () =>
        shipment
          ? api.orders.updateShipmentDetails(orderId, payload)
          : api.orders.createShipmentDetails(orderId, payload),
      'Delivery arrangement saved. Both parties must confirm the same revision.'
    );
    if (ok) {
      setFormOpen(false);
      setPickupPath([]);
      setDestinationPath([]);
      setPickupAddress('');
      setDestinationAddress('');
      setCargoWeight('');
      setPackaging('');
      setFeeProposal('');
    }
  };

  const reviseFee = async () => {
    if (!(Number(feeRevision) > 0)) {
      setActionError('Enter a positive delivery fee in ETB.');
      return;
    }
    const ok = await run(
      () =>
        api.orders.updateShipmentDetails(orderId, {
          delivery_fee_proposal_amount: String(Number(feeRevision)),
        }),
      'Delivery fee revised; both confirmations were reset for the new revision.'
    );
    if (ok) setFeeRevision('');
  };

  if (state === 'loading') {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 flex items-center gap-3 text-slate-500 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading order…
      </div>
    );
  }

  if (state !== 'ready' || !order) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 space-y-4">
        <button
          onClick={() => {
            setActiveView('orders');
            navigate('/orders');
          }}
          className="text-xs font-semibold text-[#15803D] dark:text-emerald-400 flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to orders
        </button>
        <div
          className={`p-5 rounded-2xl border ${
            state === 'missing' || state === 'denied'
              ? 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30'
              : 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30'
          }`}
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <AlertCircle className="w-4 h-4" />
            {state === 'missing'
              ? 'Order not available'
              : state === 'denied'
              ? 'Access denied'
              : 'Order could not be loaded'}
          </div>
          <p className="text-xs mt-1.5 text-slate-700 dark:text-slate-300">{error}</p>
          {state === 'error' && (
            <button
              onClick={() => void load()}
              className="mt-3 px-3 py-1.5 rounded-lg bg-[#15803D] text-white text-xs font-bold"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  const meId = String(currentUser?.id || '');
  const meIsSeller = isSeller(order, meId);
  const meIsBuyer = isBuyer(order, meId);
  const isFinance = currentRole === 'financial_manager' || currentRole === 'super_admin';
  const counterpartyId = meIsSeller ? buyerIdOf(order) : sellerIdOf(order);
  const counterpartyName = meIsSeller ? order.buyer_name : order.seller_name;
  const currentStageIndex = ORDER_LIFECYCLE.indexOf(order.status as any);
  const buyerConfirmed =
    shipment != null &&
    shipment.details_revision > 0 &&
    shipment.buyer_confirmed_revision === shipment.details_revision;
  const sellerConfirmed =
    shipment != null &&
    shipment.details_revision > 0 &&
    shipment.seller_confirmed_revision === shipment.details_revision;
  const myConfirmationDone = meIsBuyer ? buyerConfirmed : meIsSeller ? sellerConfirmed : false;
  const feeAmount = Number(shipment?.delivery_fee_proposal_amount ?? 0);
  const canEditShipment =
    (meIsBuyer || meIsSeller) &&
    !shipment?.authorized &&
    ['Accepted', 'Processing', 'Confirmed', 'Shipped'].includes(order.status);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      {/* Header */}
      <div className="border-b border-slate-200 dark:border-slate-800 pb-4 space-y-3">
        <button
          onClick={() => {
            setActiveView('orders');
            navigate('/orders');
          }}
          className="text-xs font-semibold text-[#15803D] dark:text-emerald-400 flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to orders
        </button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-lg font-bold">{order.reference}</span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${statusClasses(
                  order.status
                )}`}
              >
                {order.status}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Placed {formatDateTime(order.created_at)} · Last updated{' '}
              {formatDateTime(order.updated_at)}
            </p>
          </div>
          <button
            onClick={() => {
              setActiveView('messaging');
              navigate(
                `/messaging?with=${encodeURIComponent(
                  counterpartyId
                )}&name=${encodeURIComponent(counterpartyName || '')}`
              );
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-xs font-semibold"
          >
            <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
            Trade chat with {counterpartyName}
          </button>
        </div>
      </div>

      {actionError && (
        <div className="p-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Lifecycle stepper */}
      <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          Escrow trade lifecycle
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-9 gap-1 pt-1">
          {ORDER_LIFECYCLE.map((stage, index) => {
            const past = currentStageIndex >= index;
            return (
              <div key={stage} className="text-center space-y-1">
                <div
                  className={`h-2 rounded-full ${
                    currentStageIndex === index
                      ? 'bg-emerald-500 animate-pulse'
                      : past
                      ? 'bg-[#15803D]'
                      : 'bg-slate-200 dark:bg-slate-800'
                  }`}
                />
                <span
                  className={`text-[9px] block leading-tight ${
                    past ? 'font-bold' : 'text-slate-400'
                  }`}
                >
                  {stage}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: product + parties */}
        <div className="lg:col-span-2 space-y-5">
          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
            <div className="flex items-center gap-4">
              {order.product_image ? (
                <img
                  src={mediaUrl(order.product_image)}
                  alt={order.product_title}
                  className="w-20 h-20 rounded-xl object-cover border border-slate-200 dark:border-slate-700"
                />
              ) : (
                <div className="w-20 h-20 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <Package className="w-7 h-7 text-slate-400" />
                </div>
              )}
              <div className="min-w-0">
                <div className="text-sm font-bold truncate">{order.product_title}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Quantity: {formatQuantity(order)}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Unit price:{' '}
                  {formatEtb(Number(order.total_amount) / Math.max(Number(order.quantity), 1))}
                </div>
              </div>
              <div className="ml-auto text-right">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Order total
                </div>
                <div className="font-mono font-bold text-[#15803D] dark:text-emerald-400">
                  {formatEtb(order.total_amount)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-xs space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-slate-400" /> Buyer
                </div>
                <div>{order.buyer_name}</div>
                <div className="text-slate-500 dark:text-slate-400">
                  Role: {order.retailer ? 'Retailer' : 'Wholesaler'}
                  {order.buyer_financially_verified ? ' · financially verified' : ''}
                </div>
                {order.counterparty_contact && !meIsBuyer && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {order.counterparty_contact.phone && (
                      <div>Phone: {order.counterparty_contact.phone}</div>
                    )}
                    {order.counterparty_contact.email && (
                      <div>Email: {order.counterparty_contact.email}</div>
                    )}
                  </div>
                )}
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-xs space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-slate-400" /> Seller
                </div>
                <div>{order.seller_name}</div>
                <div className="text-slate-500 dark:text-slate-400">
                  Role: {order.farmer ? 'Farmer' : 'Wholesaler'}
                  {order.seller_is_online ? ' · online' : ''}
                </div>
                {order.counterparty_contact && !meIsSeller && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {order.counterparty_contact.phone && (
                      <div>Phone: {order.counterparty_contact.phone}</div>
                    )}
                    {order.counterparty_contact.email && (
                      <div>Email: {order.counterparty_contact.email}</div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {order.delivery_information && (
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 text-xs">
                <div className="font-bold mb-1">Buyer delivery instructions</div>
                <p className="text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                  {order.delivery_information}
                </p>
              </div>
            )}

            {order.rejection_reason && (
              <div className="p-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-xs">
                <div className="font-bold text-red-700 dark:text-red-300">
                  Seller rejection reason
                </div>
                <p className="text-red-700/90 dark:text-red-300/90 mt-1">
                  {order.rejection_reason}
                </p>
              </div>
            )}

            {order.dispute_reason && (
              <div className="p-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-xs">
                <div className="font-bold text-red-700 dark:text-red-300">Open dispute</div>
                <p className="text-red-700/90 dark:text-red-300/90 mt-1">
                  {order.dispute_reason}
                </p>
              </div>
            )}
          </div>

          {/* Delivery + driver */}
          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Truck className="w-4 h-4 text-emerald-600" /> Delivery arrangement & driver
                assignment
              </div>
              {canEditShipment && !formOpen && (
                <button
                  onClick={() => setFormOpen(true)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold"
                >
                  {shipment ? 'Revise arrangement' : 'Start arrangement'}
                </button>
              )}
            </div>

            {!shipmentLoaded ? (
              <div className="text-xs text-slate-500 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading delivery data…
              </div>
            ) : !shipment ? (
              <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
                <p>
                  The buyer and seller have not recorded the pickup, destination, cargo and
                  delivery fee yet. Driver assignment cannot start before this agreement is
                  confirmed by both parties.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Field
                    label="Delivery fee proposal"
                    value={feeAmount > 0 ? formatEtb(feeAmount) : 'Not proposed yet'}
                  />
                  <Field label="Details revision" value={shipment.details_revision} />
                  <Field
                    label="Shipment authorization"
                    value={
                      shipment.authorized
                        ? 'Authorized by the marketplace'
                        : 'Waiting for both confirmations'
                    }
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                    <div className="font-semibold">Pickup</div>
                    <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                      {shipment.authorized && shipment.pickup_address_line
                        ? shipment.pickup_address_line
                        : shipment.pickup_region_name || shipment.pickup_region || '—'}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                    <div className="font-semibold">Destination</div>
                    <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                      {shipment.authorized && shipment.destination_address_line
                        ? shipment.destination_address_line
                        : shipment.destination_region_name ||
                          shipment.destination_region ||
                          '—'}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span
                    className={`px-2 py-0.5 rounded-full font-bold ${
                      buyerConfirmed
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                    }`}
                  >
                    Buyer {buyerConfirmed ? 'confirmed' : 'pending'}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full font-bold ${
                      sellerConfirmed
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                    }`}
                  >
                    Seller {sellerConfirmed ? 'confirmed' : 'pending'}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {shipmentStateLabel(order)}
                  </span>
                </div>

                {shipment.driver_shipment_id ? (
                  <div className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-xs">
                    <div className="font-bold">
                      Driver shipment #{shipment.driver_shipment_id}
                    </div>
                    <div className="text-emerald-800 dark:text-emerald-300 mt-0.5">
                      Status from the DriverApp: {shipment.driver_shipment_status || 'pending'}
                      {shipment.driver_last_event_at
                        ? ` · last event ${formatDateTime(shipment.driver_last_event_at)}`
                        : ''}
                    </div>
                  </div>
                ) : shipment.authorized ? (
                  <div className="p-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/30 text-xs">
                    The marketplace authorized this shipment. It has been handed to the
                    DriverApp for an eligible driver to accept; this screen shows the driver
                    shipment id as soon as the DriverApp reports it back.
                  </div>
                ) : null}

                {canEditShipment && !myConfirmationDone && feeAmount > 0 && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          api.orders.confirmShipmentDetails(orderId, {
                            details_revision: shipment.details_revision,
                          }),
                        'Delivery arrangement confirmed.'
                      )
                    }
                    className="px-4 py-2 rounded-lg bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white text-xs font-bold"
                  >
                    Confirm details revision {shipment.details_revision}
                  </button>
                )}

                {meIsBuyer && !shipment.authorized && (
                  <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <label className="text-xs flex-1 min-w-[180px]">
                      <span className="block text-slate-500 dark:text-slate-400 mb-1">
                        Revise the delivery fee (ETB)
                      </span>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={feeRevision}
                        onChange={(event) => setFeeRevision(event.target.value)}
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                      />
                    </label>
                    <button
                      disabled={busy}
                      onClick={() => void reviseFee()}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold"
                    >
                      Save fee revision
                    </button>
                  </div>
                )}
              </div>
            )}

            {canEditShipment && formOpen && (
              <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {shipment
                    ? 'Saving new details creates a new revision and resets both confirmations.'
                    : 'Record the pickup, destination, cargo and fee. Both the buyer and the seller must confirm the same revision before the marketplace authorizes a driver.'}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <LocationPicker
                    value={pickupPath[pickupPath.length - 1]?.id ?? null}
                    onChange={() => undefined}
                    onPathChange={setPickupPath}
                    label="Pickup region"
                    rootLevel="REGION"
                  />
                  <LocationPicker
                    value={destinationPath[destinationPath.length - 1]?.id ?? null}
                    onChange={() => undefined}
                    onPathChange={setDestinationPath}
                    label="Destination region"
                    rootLevel="REGION"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    value={pickupAddress}
                    onChange={(event) => setPickupAddress(event.target.value)}
                    placeholder="Pickup address line"
                    className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                  />
                  <input
                    value={destinationAddress}
                    onChange={(event) => setDestinationAddress(event.target.value)}
                    placeholder="Destination address line"
                    className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                  />
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={cargoWeight}
                    onChange={(event) => setCargoWeight(event.target.value)}
                    placeholder="Cargo weight (kg)"
                    className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                  />
                  <input
                    value={packaging}
                    onChange={(event) => setPackaging(event.target.value)}
                    placeholder="Packaging details"
                    className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                  />
                  {meIsBuyer ? (
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={feeProposal}
                      onChange={(event) => setFeeProposal(event.target.value)}
                      placeholder="Delivery fee proposal (ETB)"
                      className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                    />
                  ) : (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 self-center">
                      Only the buyer proposes the delivery fee.
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={busy}
                    onClick={() => void submitShipment()}
                    className="px-4 py-2 rounded-lg bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white text-xs font-bold"
                  >
                    {shipment ? 'Save new revision' : 'Save arrangement'}
                  </button>
                  <button
                    onClick={() => setFormOpen(false)}
                    className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: payment + actions */}
        <div className="space-y-5">
          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Escrow & payment
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">Order total</span>
                <span className="font-mono font-bold">{formatEtb(order.total_amount)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">Payment state</span>
                <span className={`font-bold ${paymentClasses(order.payment_status)}`}>
                  {order.payment_status_display || 'No escrow record'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">Agreement</span>
                <span className="font-bold">{order.agreement_status || '—'}</span>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              The marketplace holds the buyer's goods funds. Seller acceptance never charges
              the buyer again, and release still requires delivery, buyer quality
              confirmation and financial release.
            </p>
          </div>

          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Order record
            </div>
            <ul className="text-xs space-y-2">
              <li className="flex items-start gap-2">
                <Clock className="w-3.5 h-3.5 mt-0.5 text-slate-400" />
                <span>
                  Submitted
                  <span className="block text-slate-500 dark:text-slate-400">
                    {formatDateTime(order.created_at)}
                  </span>
                </span>
              </li>
              {order.delivered_at && (
                <li className="flex items-start gap-2">
                  <Truck className="w-3.5 h-3.5 mt-0.5 text-emerald-600" />
                  <span>
                    Delivery confirmed
                    <span className="block text-slate-500 dark:text-slate-400">
                      {formatDateTime(order.delivered_at)}
                    </span>
                  </span>
                </li>
              )}
              {order.quality_confirmed_at && (
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-emerald-600" />
                  <span>
                    Buyer quality confirmation
                    <span className="block text-slate-500 dark:text-slate-400">
                      {formatDateTime(order.quality_confirmed_at)}
                    </span>
                  </span>
                </li>
              )}
              <li className="flex items-start gap-2">
                <Clock className="w-3.5 h-3.5 mt-0.5 text-slate-400" />
                <span>
                  Last status change
                  <span className="block text-slate-500 dark:text-slate-400">
                    {formatDateTime(order.updated_at)}
                  </span>
                </span>
              </li>
            </ul>
          </div>

          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Available actions
            </div>
            {meIsSeller && order.status === 'Pending seller approval' && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                The buyer's payment reservation is verified by the backend before an
                acceptance is recorded.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {(order.allowed_transitions || []).map((next) => (
                <button
                  key={next}
                  disabled={busy}
                  onClick={() => handleTransition(next)}
                  className={`px-3 py-2 rounded-lg text-white text-xs font-bold disabled:opacity-60 ${
                    next === 'Rejected' || next === 'Cancelled'
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-[#15803D] hover:bg-[#166534]'
                  }`}
                >
                  {ACTION_LABELS[next] || next}
                </button>
              ))}

              {order.status === 'Awaiting quality confirmation' && meIsBuyer && (
                <>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => api.orders.confirmQuality(orderId),
                        'Quality confirmed — awaiting financial release.'
                      )
                    }
                    className="px-3 py-2 rounded-lg bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white text-xs font-bold"
                  >
                    Confirm product quality
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setDisputeReason('');
                      setDisputeOpen(true);
                    }}
                    className="px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-xs font-bold"
                  >
                    Raise quality dispute
                  </button>
                </>
              )}

              {order.status === 'Awaiting payment release' && isFinance && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => api.orders.release(orderId),
                      'Escrow released to the seller.'
                    )
                  }
                  className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold"
                >
                  Release escrow to seller
                </button>
              )}

              {order.status === 'Disputed' && isFinance && (
                <>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          api.orders.resolveDispute(orderId, { decision: 'release' }),
                        'Dispute resolved with release.'
                      )
                    }
                    className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold"
                  >
                    Resolve: release funds
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => api.orders.resolveDispute(orderId, { decision: 'refund' }),
                        'Dispute resolved with refund.'
                      )
                    }
                    className="px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-xs font-bold"
                  >
                    Resolve: refund buyer
                  </button>
                </>
              )}

              {(order.allowed_transitions || []).length === 0 &&
                order.status !== 'Awaiting quality confirmation' &&
                order.status !== 'Awaiting payment release' &&
                order.status !== 'Disputed' && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    No action is available to your account at this stage.
                  </p>
                )}
            </div>
          </div>
        </div>
      </div>

      {/* Rejection dialog */}
      {rejectOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="flex items-center gap-2 font-bold text-sm text-red-700 dark:text-red-400">
              <XCircle className="w-4 h-4" /> Reject {order.reference}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              The buyer sees this reason. Rejecting follows the existing cancellation rules:
              the escrow reservation is returned to the buyer and the stock is released.
            </p>
            <textarea
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              rows={3}
              placeholder="Why can this order not be fulfilled?"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRejectOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold"
              >
                Keep order
              </button>
              <button
                disabled={busy}
                onClick={() => void submitRejection()}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-xs font-bold"
              >
                Reject order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dispute dialog */}
      {disputeOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="flex items-center gap-2 font-bold text-sm text-red-700 dark:text-red-400">
              <AlertCircle className="w-4 h-4" /> Raise a quality dispute
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Financial staff review the dispute. Escrow release is blocked while a dispute
              is open.
            </p>
            <textarea
              value={disputeReason}
              onChange={(event) => setDisputeReason(event.target.value)}
              rows={3}
              placeholder="Describe the quality problem"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDisputeOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                disabled={busy}
                onClick={() => void submitDispute()}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-xs font-bold"
              >
                Submit dispute
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrderDetailView;
