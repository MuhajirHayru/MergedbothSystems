import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useMessaging, describeApiError } from '../../context/MessagingContext';
import { api } from '../../services/apiClient';
import {
  ChatChannel,
  ChatMessage,
  StaffRecipient,
  avatarUrl,
  channelPartner,
  formatClock,
  formatDayHeading,
  formatListStamp,
  initialsOf,
  listFrom,
  mergeMessage,
  previewOf,
  roleLabel,
} from '../../lib/chat';
import { useChannelSocket } from './useChannelSocket';
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Info,
  Loader2,
  MessageSquare,
  Mic,
  Plus,
  RefreshCw,
  Search,
  Send,
  Square,
  UserPlus,
  Users,
  X,
} from 'lucide-react';

const STAFF_ROLES = new Set(['user_admin', 'financial_manager', 'super_admin']);
const MAX_VOICE_SECONDS = 120;

interface Partner {
  id: string;
  name: string;
  meta: string;
}

interface Props {
  /** Optional partner passed by another screen (?with = user id). */
  initialPartner?: { id: string; name: string } | null;
}

const groupByDay = (messages: ChatMessage[]) => {
  const groups: { day: string; items: ChatMessage[] }[] = [];
  messages.forEach((message) => {
    const day = formatDayHeading(message.sent_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(message);
    else groups.push({ day, items: [message] });
  });
  return groups;
};

export const MessagingWorkspace: React.FC<Props> = ({ initialPartner = null }) => {
  const { currentRole, currentUser } = useApp();
  const { channels, unreadTotal, loading, error: channelsError, socketState, version, refresh } =
    useMessaging();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [threadError, setThreadError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [search, setSearch] = useState('');
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [mobileThread, setMobileThread] = useState(false);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [partnerQuery, setPartnerQuery] = useState('');
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnersLoading, setPartnersLoading] = useState(false);
  const [partnersError, setPartnersError] = useState('');
  const [startingWith, setStartingWith] = useState<string | null>(null);

  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [voiceBusy, setVoiceBusy] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingSentAt = useRef(0);
  const typingClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeId) || null,
    [channels, activeId]
  );
  const partner = useMemo(
    () => channelPartner(activeChannel, currentUser?.id),
    [activeChannel, currentUser?.id]
  );

  // ---- thread loading -------------------------------------------------------
  const loadThread = useCallback(async (channelId: string) => {
    setLoadingMessages(true);
    setThreadError('');
    try {
      const first = await api.chat.messages(channelId);
      let rows = listFrom<ChatMessage>(first?.data);
      const count = Number(first?.data?.count ?? rows.length);
      // Message history is paginated oldest-first, so jump to the last page
      // when the conversation is longer than one page.
      if (count > rows.length && rows.length > 0) {
        const lastPage = Math.max(1, Math.ceil(count / rows.length));
        const latest = await api.chat.messages(channelId, { page: lastPage });
        rows = listFrom<ChatMessage>(latest?.data);
      }
      setMessages(rows);
      try {
        await api.chat.markRead(channelId);
      } catch {
        /* read receipts are best-effort */
      }
      void refresh();
    } catch (err: any) {
      setMessages([]);
      setThreadError(describeApiError(err, 'Unable to load this conversation.'));
    } finally {
      setLoadingMessages(false);
    }
  }, [refresh]);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    void loadThread(activeId);
    setShowInfo(false);
  }, [activeId, loadThread]);

  // Pick the most recent conversation when nothing is open or it disappears.
  useEffect(() => {
    if (!channels.length) {
      setActiveId(null);
      return;
    }
    setActiveId((current) =>
      current && channels.some((channel) => channel.id === current)
        ? current
        : channels[0].id
    );
  }, [channels]);

  // Refresh unread counters when the server pushes a message for another thread.
  useEffect(() => {
    if (!version) return;
    if (activeId) {
      api.chat
        .markRead(activeId)
        .then(() => refresh())
        .catch(() => undefined);
    }
  }, [version, activeId, refresh]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, loadingMessages, typingUser]);

  // ---- live channel socket --------------------------------------------------
  const clearTypingSoon = useCallback(() => {
    if (typingClearRef.current) clearTimeout(typingClearRef.current);
    typingClearRef.current = setTimeout(() => setTypingUser(null), 4000);
  }, []);

  const { state: channelSocketState, notifyTyping } = useChannelSocket(activeId, {
    onMessage: (incoming) => {
      if (incoming.channel !== activeId) return;
      setMessages((thread) => mergeMessage(thread, incoming));
      if (String(incoming.sender) !== String(currentUser?.id)) {
        setTypingUser(null);
        api.chat
          .markRead(activeId as string)
          .then(() => refresh())
          .catch(() => undefined);
      }
    },
    onTyping: (event) => {
      if (!event.is_typing || event.user === currentUser?.name) return;
      setTypingUser(event.user);
      clearTypingSoon();
    },
    onError: (message) => setSendError(message),
  });

  useEffect(
    () => () => {
      if (typingClearRef.current) clearTimeout(typingClearRef.current);
    },
    []
  );

  // ---- composer -------------------------------------------------------------
  const handleDraft = (value: string) => {
    setDraft(value);
    const now = Date.now();
    if (now - typingSentAt.current > 2000) {
      typingSentAt.current = now;
      notifyTyping(true);
    }
  };

  const sendText = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || !activeId || sending) return;
    setSending(true);
    setSendError('');
    try {
      const response = await api.chat.sendMessage(activeId, { content: body, kind: 'TEXT' });
      const created = (response?.data?.message ?? response?.data) as ChatMessage;
      if (created?.id) setMessages((thread) => mergeMessage(thread, created));
      setDraft('');
      notifyTyping(false);
      void refresh();
    } catch (err: any) {
      setSendError(describeApiError(err, 'Message could not be sent.'));
    } finally {
      setSending(false);
    }
  };

  // ---- voice messages -------------------------------------------------------
  const stopRecording = useCallback(() => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    setRecording(false);
  }, []);

  const startRecording = async () => {
    if (!activeId || recording) return;
    setSendError('');
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setSendError('This browser cannot record audio.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
      const mimeType = preferred.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        chunksRef.current = [];
        if (!blob.size || !activeId) return;
        const extension = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
        const form = new FormData();
        form.append('kind', 'VOICE');
        form.append('audio', new File([blob], `voice-message.${extension}`, { type: blob.type }));
        setVoiceBusy(true);
        try {
          const response = await api.chat.sendMessage(activeId, form);
          const created = (response?.data?.message ?? response?.data) as ChatMessage;
          if (created?.id) setMessages((thread) => mergeMessage(thread, created));
          if (response?.status === 202) {
            setSendError('Voice message recorded and queued for moderation review.');
          }
          void refresh();
        } catch (err: any) {
          setSendError(describeApiError(err, 'Voice message could not be sent.'));
        } finally {
          setVoiceBusy(false);
        }
      };
      recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds((seconds) => {
          if (seconds + 1 >= MAX_VOICE_SECONDS) {
            stopRecording();
            return MAX_VOICE_SECONDS;
          }
          return seconds + 1;
        });
      }, 1000);
    } catch (err: any) {
      setSendError(
        err?.name === 'NotAllowedError'
          ? 'Microphone access was denied by the browser.'
          : 'Microphone could not be opened.'
      );
    }
  };

  useEffect(() => () => stopRecording(), [stopRecording]);

  // ---- new conversation -----------------------------------------------------
  const loadPartners = useCallback(async (query: string) => {
    setPartnersLoading(true);
    setPartnersError('');
    try {
      // The backend decides the permitted set from the caller's role,
      // administrative scope and existing order relationships. The frontend
      // never filters an unrestricted user directory itself.
      const response = await api.chat.recipients(query.trim() || undefined);
      const rows = listFrom<StaffRecipient>(response?.data);
      setPartners(
        rows.map((row) => ({
          id: String(row.id),
          name: row.full_name,
          meta: [row.role_display, row.scope || row.location].filter(Boolean).join(' · '),
        }))
      );
    } catch (err: any) {
      setPartners([]);
      setPartnersError(describeApiError(err, 'Unable to load conversation partners.'));
    } finally {
      setPartnersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;
    const timer = setTimeout(() => void loadPartners(partnerQuery), 300);
    return () => clearTimeout(timer);
  }, [pickerOpen, partnerQuery, loadPartners]);

  const startConversation = async (candidate: Partner) => {
    setStartingWith(candidate.id);
    setPartnersError('');
    try {
      const response = await api.chat.createChannel({ participant_ids: [candidate.id] });
      const channel = response?.data?.channel as ChatChannel | undefined;
      await refresh();
      if (channel?.id) {
        setActiveId(channel.id);
        setMobileThread(true);
      }
      setPickerOpen(false);
      setPartnerQuery('');
    } catch (err: any) {
      setPartnersError(describeApiError(err, 'Conversation could not be started.'));
    } finally {
      setStartingWith(null);
    }
  };

  // A partner supplied by another screen.
  useEffect(() => {
    if (!initialPartner?.id) return;
    const existing = channels.find((channel) =>
      channel.participants.some((participant) => String(participant.id) === initialPartner.id)
    );
    if (existing) {
      setActiveId(existing.id);
      setMobileThread(true);
    } else {
      setPickerOpen(true);
      setPartnerQuery(initialPartner.name);
    }
  }, [initialPartner, channels]);

  // ---- filtering ------------------------------------------------------------
  const filteredChannels = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return channels;
    return channels.filter((channel) => {
      const other = channelPartner(channel, currentUser?.id);
      return [other?.full_name, channel.related_product_title, channel.last_message?.content]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [channels, search, currentUser?.id]);

  const online = channelSocketState === 'open';
  const partnerMeta = [roleLabel(partner), partner?.location].filter(Boolean).join(' · ');

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-5">
      <div className="flex items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-[#15803D] dark:text-emerald-400" />
            Messaging
          </h1>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {unreadTotal > 0 ? `${unreadTotal} unread message${unreadTotal === 1 ? '' : 's'}` : 'You are all caught up'}
            <span className="mx-1.5 text-slate-300 dark:text-slate-600">·</span>
            <span className="inline-flex items-center gap-1">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  online ? 'bg-emerald-500' : socketState === 'connecting' ? 'bg-amber-400' : 'bg-slate-400'
                }`}
              />
              {online ? 'Live' : socketState === 'connecting' ? 'Connecting…' : 'Offline'}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-[#15803D] hover:border-[#15803D]/40 transition-colors"
            title="Refresh conversations"
            aria-label="Refresh conversations"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {activeId && (
            <button
              type="button"
              onClick={() => setShowInfo((value) => !value)}
              className="hidden lg:inline-flex p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-[#15803D] transition-colors"
              title="Conversation information"
              aria-label="Conversation information"
            >
              <Info className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {channelsError && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {channelsError}
        </div>
      )}

      <div className="h-[76vh] min-h-[520px] bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
        {/* ---------------- conversation list ---------------- */}
        <div
          className={`lg:col-span-4 xl:col-span-3 border-r border-slate-200 dark:border-slate-800 flex-col h-full ${
            mobileThread ? 'hidden lg:flex' : 'flex'
          }`}
        >
          <div className="p-3 border-b border-slate-200 dark:border-slate-800 space-y-2 shrink-0">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search conversations"
                  aria-label="Search conversations"
                  className="w-full pl-8 pr-2 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#15803D]"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setPickerOpen((value) => !value);
                  setPartnerQuery('');
                }}
                className="p-2 rounded-lg bg-[#15803D] text-white hover:bg-[#166534] transition-colors"
                title="Start a new conversation"
                aria-label="Start a new conversation"
              >
                {pickerOpen ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              </button>
            </div>

            {pickerOpen && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-2 space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  <UserPlus className="w-3.5 h-3.5" />
                  New conversation
                </div>
                <input
                  value={partnerQuery}
                  onChange={(event) => setPartnerQuery(event.target.value)}
                  placeholder={STAFF_ROLES.has(currentRole) ? 'Search permitted staff and users' : 'Search permitted partners'}
                  aria-label="Search conversation partners"
                  className="w-full px-2 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-400"
                />
                <div className="max-h-44 overflow-y-auto divide-y divide-slate-200/70 dark:divide-slate-700/60">
                  {partnersLoading ? (
                    <div className="flex items-center gap-2 px-1 py-2 text-[11px] text-slate-500">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading partners…
                    </div>
                  ) : partners.length === 0 ? (
                    <p className="px-1 py-2 text-[11px] text-slate-500 dark:text-slate-400">
                      {STAFF_ROLES.has(currentRole)
                        ? 'No permitted staff or users matched this search.'
                        : 'No permitted partners yet — marketplace conversations unlock once you share an order with another party.'}
                    </p>
                  ) : (
                    partners.map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => void startConversation(candidate)}
                        disabled={startingWith === candidate.id}
                        className="w-full flex items-center justify-between gap-2 py-1.5 text-left hover:bg-white dark:hover:bg-slate-900 rounded px-1"
                      >
                        <span className="min-w-0">
                          <span className="block text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate">
                            {candidate.name}
                          </span>
                          <span className="block text-[10px] text-slate-500 truncate">{candidate.meta}</span>
                        </span>
                        {startingWith === candidate.id && (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#15803D]" />
                        )}
                      </button>
                    ))
                  )}
                </div>
                {partnersError && <p className="text-[10px] text-red-600 dark:text-red-400">{partnersError}</p>}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading && channels.length === 0 ? (
              <div className="p-4 space-y-2">
                {[0, 1, 2, 3].map((row) => (
                  <div key={row} className="h-14 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
                ))}
              </div>
            ) : filteredChannels.length === 0 ? (
              <div className="p-6 text-center">
                <Users className="w-6 h-6 text-slate-300 dark:text-slate-600 mx-auto" />
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mt-2">
                  {channels.length === 0 ? 'No conversations yet' : 'No matches'}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  {channels.length === 0
                    ? STAFF_ROLES.has(currentRole)
                      ? 'Start a conversation with a colleague using the + button.'
                      : 'Start a conversation with an order partner using the + button.'
                    : 'Try a different name or keyword.'}
                </p>
              </div>
            ) : (
              filteredChannels.map((channel) => {
                const other = channelPartner(channel, currentUser?.id);
                const unread = channel.unread_count || 0;
                const photo = avatarUrl(other);
                return (
                  <button
                    key={channel.id}
                    type="button"
                    onClick={() => {
                      setActiveId(channel.id);
                      setMobileThread(true);
                    }}
                    className={`w-full text-left px-3 py-2.5 border-b border-slate-100 dark:border-slate-800/70 transition-colors ${
                      activeId === channel.id
                        ? 'bg-emerald-50 dark:bg-emerald-950/30'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      {photo ? (
                        <img src={photo} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                      ) : (
                        <span className="w-9 h-9 rounded-full bg-[#15803D]/10 text-[#15803D] dark:bg-emerald-950 dark:text-emerald-300 text-[11px] font-bold flex items-center justify-center shrink-0">
                          {initialsOf(other?.full_name)}
                        </span>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {other?.full_name || 'Conversation'}
                          </span>
                          <span className="text-[10px] text-slate-400 shrink-0">
                            {formatListStamp(channel.last_message?.sent_at || channel.last_message_at)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <span
                            className={`text-[11px] truncate ${
                              unread > 0
                                ? 'text-slate-800 dark:text-slate-100 font-medium'
                                : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {previewOf(channel)}
                          </span>
                          {unread > 0 && (
                            <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-[#15803D] text-white text-[10px] font-bold flex items-center justify-center">
                              {unread > 99 ? '99+' : unread}
                            </span>
                          )}
                        </div>
                        {channel.related_product_title && (
                          <div className="text-[10px] text-emerald-700 dark:text-emerald-400 mt-0.5 truncate">
                            {channel.related_product_title}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ---------------- thread ---------------- */}
        <div
          className={`lg:col-span-8 xl:col-span-6 flex-col h-full min-w-0 ${
            mobileThread ? 'flex' : 'hidden lg:flex'
          }`}
        >
          {activeChannel ? (
            <>
              <div className="px-3 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setMobileThread(false)}
                  className="lg:hidden p-1.5 -ml-1 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  aria-label="Back to conversations"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                {(() => {
                  const headerPhoto = avatarUrl(partner);
                  return headerPhoto ? (
                    <img src={headerPhoto} alt="" className="w-8 h-8 rounded-full object-cover shrink-0 ring-1 ring-slate-200 dark:ring-slate-700" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-[#15803D]/10 text-[#15803D] dark:bg-emerald-950 dark:text-emerald-300 text-[11px] font-bold flex items-center justify-center shrink-0">
                      {initialsOf(partner?.full_name)}
                    </div>
                  );
                })()}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                    {partner?.full_name || 'Conversation'}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                    {partner?.bio ? `${String(partner.bio).slice(0, 60)} · ` : ''}
                    {partnerMeta || 'GreenPath marketplace'}
                    {partner?.financially_verified && (
                      <span className="ml-1.5 text-emerald-700 dark:text-emerald-400 font-semibold">Verified</span>
                    )}
                  </div>
                </div>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                    online
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {online ? 'Live' : 'Reconnecting'}
                </span>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-1 bg-slate-50/60 dark:bg-slate-950/30">
                {loadingMessages ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading messages…
                  </div>
                ) : threadError ? (
                  <div className="mx-auto max-w-sm text-center py-8">
                    <p className="text-xs text-red-600 dark:text-red-400">{threadError}</p>
                    <button
                      type="button"
                      onClick={() => activeId && void loadThread(activeId)}
                      className="mt-2 text-[11px] font-semibold text-[#15803D] dark:text-emerald-400 hover:underline"
                    >
                      Try again
                    </button>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-10">
                    <MessageSquare className="w-6 h-6 text-slate-300 dark:text-slate-600 mx-auto" />
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                      No messages yet. Say hello to {partner?.full_name || 'your partner'}.
                    </p>
                  </div>
                ) : (
                  groupByDay(messages).map((group) => (
                    <div key={group.day} className="space-y-1">
                      <div className="flex items-center justify-center py-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-900 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-800">
                          {group.day}
                        </span>
                      </div>
                      {group.items.map((message) => {
                        const mine = String(message.sender) === String(currentUser?.id);
                        return (
                          <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                            <div
                              className={`max-w-[82%] sm:max-w-[70%] rounded-2xl px-3 py-2 text-xs shadow-xs ${
                                mine
                                  ? 'bg-[#15803D] text-white rounded-br-sm'
                                  : 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-bl-sm'
                              }`}
                            >
                              {!mine && (
                                <div className="text-[10px] font-bold opacity-80 mb-0.5">{message.sender_name}</div>
                              )}
                              {message.kind === 'VOICE' ? (
                                <VoiceBubble
                                  channelId={message.channel}
                                  message={message}
                                  mine={mine}
                                />
                              ) : (
                                <p className="whitespace-pre-wrap break-words">{message.content}</p>
                              )}
                              <div
                                className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${
                                  mine ? 'text-white/75' : 'text-slate-400 dark:text-slate-500'
                                }`}
                              >
                                {formatClock(message.sent_at)}
                                {mine &&
                                  (message.is_read ? (
                                    <CheckCheck className="w-3 h-3" aria-label="Read" />
                                  ) : (
                                    <Check className="w-3 h-3" aria-label="Sent" />
                                  ))}
                              </div>
                              {message.moderation_status === 'PENDING_REVIEW' && (
                                <div className="text-[10px] italic opacity-80 mt-0.5">Awaiting moderation</div>
                              )}
                              {message.moderation_status === 'BLOCKED' && (
                                <div className="text-[10px] italic opacity-80 mt-0.5">Blocked by moderation</div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
                {typingUser && (
                  <div className="flex justify-start">
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-3 py-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {typingUser} is typing…
                    </div>
                  </div>
                )}
              </div>

              {sendError && (
                <div className="px-3 pt-2">
                  <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 px-2.5 py-1.5 text-[11px] text-amber-800 dark:text-amber-300 flex items-start justify-between gap-2">
                    <span>{sendError}</span>
                    <button type="button" onClick={() => setSendError('')} aria-label="Dismiss">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}

              <form
                onSubmit={sendText}
                className="p-2.5 sm:p-3 border-t border-slate-200 dark:border-slate-800 flex items-end gap-2 shrink-0"
              >
                <textarea
                  value={draft}
                  onChange={(event) => handleDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void sendText();
                    }
                  }}
                  rows={1}
                  placeholder={recording ? 'Recording voice message…' : 'Write a message…'}
                  aria-label="Message"
                  disabled={recording}
                  className="flex-1 resize-none max-h-28 px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#15803D] disabled:opacity-60"
                />
                {recording ? (
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-600 text-white text-xs font-semibold"
                  >
                    <Square className="w-3.5 h-3.5" />
                    {Math.floor(recordSeconds / 60)}:{String(recordSeconds % 60).padStart(2, '0')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void startRecording()}
                    disabled={voiceBusy || sending}
                    className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-[#15803D] disabled:opacity-50"
                    title="Record a voice message"
                    aria-label="Record a voice message"
                  >
                    {voiceBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
                  </button>
                )}
                <button
                  type="submit"
                  disabled={!draft.trim() || sending || recording}
                  className="p-2.5 rounded-xl bg-[#15803D] text-white hover:bg-[#166534] disabled:opacity-50 transition-colors"
                  title="Send message"
                  aria-label="Send message"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
              <MessageSquare className="w-8 h-8 text-slate-300 dark:text-slate-600" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mt-3">
                Select a conversation
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 max-w-xs">
                {currentRole === 'driver'
                  ? 'Direct driver messaging is not authorised by the backend for the Driver role yet.'
                  : 'Choose a conversation on the left, or start a new one with the + button.'}
              </p>
            </div>
          )}
        </div>

        {/* ---------------- conversation information ---------------- */}
        <div
          className={`lg:col-span-12 xl:col-span-3 border-l border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 ${
            showInfo && activeChannel ? 'block' : 'hidden xl:block'
          }`}
        >
          {activeChannel ? (
            <div className="p-4 space-y-4 text-xs h-full overflow-y-auto">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Conversation</div>
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-full bg-[#15803D] text-white text-sm font-bold flex items-center justify-center">
                  {initialsOf(partner?.full_name)}
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-slate-900 dark:text-slate-100 truncate">
                    {partner?.full_name || 'Conversation'}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {roleLabel(partner) || 'Marketplace user'}
                  </div>
                </div>
              </div>
              <dl className="space-y-2">
                {partner?.location && (
                  <div className="flex items-start justify-between gap-2">
                    <dt className="text-slate-500 dark:text-slate-400">Region</dt>
                    <dd className="font-medium text-slate-800 dark:text-slate-200 text-right">{partner.location}</dd>
                  </div>
                )}
                {activeChannel.related_product_title && (
                  <div className="flex items-start justify-between gap-2">
                    <dt className="text-slate-500 dark:text-slate-400">Listing</dt>
                    <dd className="font-medium text-slate-800 dark:text-slate-200 text-right">
                      {activeChannel.related_product_title}
                    </dd>
                  </div>
                )}
                <div className="flex items-start justify-between gap-2">
                  <dt className="text-slate-500 dark:text-slate-400">Messages</dt>
                  <dd className="font-medium text-slate-800 dark:text-slate-200">{messages.length}</dd>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <dt className="text-slate-500 dark:text-slate-400">Unread</dt>
                  <dd className="font-medium text-slate-800 dark:text-slate-200">
                    {activeChannel.unread_count || 0}
                  </dd>
                </div>
              </dl>
              <p className="text-[10px] leading-relaxed text-slate-400 dark:text-slate-500 border-t border-slate-200 dark:border-slate-800 pt-3">
                Private contact details and exact addresses stay hidden until GreenPath releases them under an
                order agreement.
              </p>
            </div>
          ) : (
            <div className="p-4 text-[11px] text-slate-500 dark:text-slate-400">No conversation selected.</div>
          )}
        </div>
      </div>
    </div>
  );
};

/** Voice message player that streams the private audio endpoint with the JWT. */
const VoiceBubble: React.FC<{ channelId: string; message: ChatMessage; mine: boolean }> = ({
  channelId,
  message,
  mine,
}) => {
  const [source, setSource] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = async () => {
    if (source || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const response = await api.chat.voiceMessageAudio(channelId, message.id);
      const blob = response.data as Blob;
      setSource(URL.createObjectURL(blob));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source);
    },
    [source]
  );

  if (message.moderation_status === 'BLOCKED') {
    return <span className="text-[11px] italic">Voice message blocked</span>;
  }
  if (message.moderation_status === 'PENDING_REVIEW' && !mine) {
    return <span className="text-[11px] italic">Voice message awaiting moderation</span>;
  }
  if (source) {
    return <audio controls src={source} className="max-w-[220px] h-9" />;
  }
  return (
    <button
      type="button"
      onClick={() => void load()}
      className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${
        mine ? 'text-white' : 'text-[#15803D] dark:text-emerald-400'
      }`}
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
      {failed ? 'Retry voice message' : 'Play voice message'}
    </button>
  );
};

export default MessagingWorkspace;
