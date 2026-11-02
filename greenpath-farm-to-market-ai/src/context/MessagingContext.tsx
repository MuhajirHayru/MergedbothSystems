import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useApp } from './AppContext';
import { api } from '../services/apiClient';
import { socketUrl } from '../lib/realtime';
import { formatApiError } from '../lib/apiErrors';
import { ChatChannel, listFrom, totalUnread } from '../lib/chat';

type SocketState = 'connecting' | 'open' | 'closed';

interface MessagingContextValue {
  /** Every conversation the backend returns for the signed-in account. */
  channels: ChatChannel[];
  unreadTotal: number;
  loading: boolean;
  error: string;
  socketState: SocketState;
  /** Increments whenever the server pushes a new-message alert. */
  version: number;
  refresh: () => Promise<void>;
}

const MessagingContext = createContext<MessagingContextValue | undefined>(undefined);

/**
 * Platform-wide messaging state.
 *
 * Conversation metadata (unread counts, previews) comes from
 * `GET /api/v1/chat/channels/`; live alerts arrive over the existing Channels
 * notification socket (`/ws/notifications/`), which the backend fans a
 * `MESSAGE` notification through whenever a chat message is persisted. The
 * list is therefore refreshed on a server push — not by polling.
 */
export const MessagingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, currentUser } = useApp();
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [socketState, setSocketState] = useState<SocketState>('closed');
  const [version, setVersion] = useState(0);

  const inFlight = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identity = isAuthenticated ? String(currentUser?.id || '') : '';

  const refresh = useCallback(async () => {
    if (!identity || inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await api.chat.channels();
      setChannels(listFrom<ChatChannel>(response?.data));
      setError('');
    } catch (err: any) {
      if (err?.response?.status === 401 || err?.response?.status === 403) {
        setChannels([]);
      } else {
        setError(formatApiError(err, 'Unable to load conversations.'));
      }
    } finally {
      inFlight.current = false;
    }
  }, [identity]);

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void refresh();
    }, 350);
  }, [refresh]);

  // Initial load / account switch.
  useEffect(() => {
    if (!identity) {
      setChannels([]);
      setError('');
      setLoading(false);
      return;
    }
    setLoading(true);
    void refresh().finally(() => setLoading(false));
  }, [identity, refresh]);

  // Live new-message alerts over the notification socket.
  useEffect(() => {
    if (!identity) {
      setSocketState('closed');
      return;
    }

    let disposed = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const connect = () => {
      if (disposed) return;
      setSocketState('connecting');
      try {
        socket = new WebSocket(socketUrl('ws/notifications'));
      } catch {
        setSocketState('closed');
        return;
      }

      socket.onopen = () => {
        if (disposed) return;
        attempt = 0;
        setSocketState('open');
        // Catch up on anything sent while the socket was down.
        scheduleRefresh();
      };

      socket.onmessage = (event) => {
        let payload: any;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        const notification = payload?.notification;
        if (payload?.type === 'notify.event' && notification?.type === 'MESSAGE') {
          setVersion((current) => current + 1);
          scheduleRefresh();
        }
      };

      socket.onclose = (event) => {
        if (disposed) return;
        setSocketState('closed');
        // 4401/4403 mean the session or the account is no longer valid.
        if (event.code === 4401 || event.code === 4403) return;
        attempt += 1;
        const delay = Math.min(1000 * 2 ** Math.min(attempt, 4), 15000);
        retry = setTimeout(connect, delay);
      };

      socket.onerror = () => socket?.close();
    };

    connect();

    const onVisible = () => {
      if (document.visibilityState === 'visible') scheduleRefresh();
    };
    const onFocus = () => scheduleRefresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      socket?.close();
    };
  }, [identity, scheduleRefresh]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  const unreadTotal = useMemo(() => totalUnread(channels), [channels]);
  const value = useMemo<MessagingContextValue>(
    () => ({ channels, unreadTotal, loading, error, socketState, version, refresh }),
    [channels, unreadTotal, loading, error, socketState, version, refresh]
  );

  return <MessagingContext.Provider value={value}>{children}</MessagingContext.Provider>;
};

export function useMessaging(): MessagingContextValue {
  const context = useContext(MessagingContext);
  if (!context) throw new Error('useMessaging must be used within <MessagingProvider>');
  return context;
}

export { formatApiError as describeApiError };
