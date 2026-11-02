import { useCallback, useEffect, useRef, useState } from 'react';
import { socketUrl } from '../../lib/realtime';
import type { ChatMessage } from '../../lib/chat';

type SocketState = 'connecting' | 'open' | 'closed';

interface ChannelSocketHandlers {
  onMessage?: (message: ChatMessage) => void;
  onTyping?: (payload: { user: string; is_typing: boolean }) => void;
  onRead?: () => void;
  onError?: (message: string) => void;
}

/**
 * Subscription to the backend channel socket
 * (`/ws/chat/{channelID}/?token=...`), which the Django Channels
 * `ChatConsumer` authorises per channel participant.
 *
 * Sending is done through the REST endpoint so validation, moderation and
 * notifications stay on the canonical code path; this socket carries the
 * real-time fan-out (incoming messages, typing and read events).
 */
export function useChannelSocket(
  channelId: string | null,
  handlers: ChannelSocketHandlers
) {
  const [state, setState] = useState<SocketState>('closed');
  const socketRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!channelId) {
      setState('closed');
      return;
    }

    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const connect = () => {
      if (disposed) return;
      setState('connecting');
      let socket: WebSocket;
      try {
        socket = new WebSocket(socketUrl(`ws/chat/${channelId}`));
      } catch {
        setState('closed');
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposed) return;
        attempt = 0;
        setState('open');
      };

      socket.onmessage = (event) => {
        let payload: any;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        switch (payload?.type) {
          case 'chat.message':
            if (payload.message) handlersRef.current.onMessage?.(payload.message as ChatMessage);
            break;
          case 'chat.typing':
            handlersRef.current.onTyping?.({
              user: String(payload.user || ''),
              is_typing: Boolean(payload.is_typing),
            });
            break;
          case 'chat.read':
            handlersRef.current.onRead?.();
            break;
          case 'chat.error':
            handlersRef.current.onError?.(String(payload.error || 'Message rejected.'));
            break;
          default:
            break;
        }
      };

      socket.onclose = (event) => {
        if (disposed) return;
        setState('closed');
        if (event.code === 4401 || event.code === 4403 || event.code === 4404) return;
        attempt += 1;
        const delay = Math.min(1000 * 2 ** Math.min(attempt, 4), 15000);
        retry = setTimeout(connect, delay);
      };

      socket.onerror = () => socket.close();
    };

    connect();

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [channelId]);

  const emit = useCallback((payload: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(payload));
    return true;
  }, []);

  const notifyTyping = useCallback(
    (isTyping: boolean) => emit({ action: 'typing', is_typing: isTyping }),
    [emit]
  );

  const notifyRead = useCallback(() => emit({ action: 'read' }), [emit]);

  return { state, notifyTyping, notifyRead };
}
