/**
 * Shared types and presentation helpers for the GreenPath chat module.
 *
 * These mirror the Django REST payloads (`chat.serializers.ChatChannelSerializer`
 * and `MessageSerializer`) exactly — no field is invented on the client.
 */
export interface ChatParticipant {
  id: string;
  full_name: string;
  role?: string;
  role_display?: string;
  location?: string;
  phone?: string;
  profile_photo?: string | null;
  financially_verified?: boolean;
}

export interface ChatLastMessage {
  content?: string;
  sender_name?: string;
  sender_financially_verified?: boolean;
  kind?: 'TEXT' | 'VOICE';
  moderation_status?: 'APPROVED' | 'PENDING_REVIEW' | 'BLOCKED';
  sent_at?: string;
}

export interface ChatChannel {
  id: string;
  participants: ChatParticipant[];
  related_product?: string | null;
  related_product_title?: string | null;
  last_message_at?: string | null;
  created_at?: string;
  last_message?: ChatLastMessage | null;
  unread_count?: number;
}

export interface ChatMessage {
  id: string;
  channel: string;
  sender: string;
  sender_name: string;
  sender_financially_verified?: boolean;
  content: string;
  kind: 'TEXT' | 'VOICE';
  audio_url?: string | null;
  moderation_status?: 'APPROVED' | 'PENDING_REVIEW' | 'BLOCKED';
  sent_at: string;
  is_read: boolean;
}

export interface StaffRecipient {
  id: string;
  full_name: string;
  role: string;
  role_display: string;
  location?: string;
  scope?: string;
}

export const listFrom = <T,>(payload: any): T[] =>
  Array.isArray(payload?.results)
    ? (payload.results as T[])
    : Array.isArray(payload)
      ? (payload as T[])
      : [];

export function channelPartner(
  channel: ChatChannel | null,
  selfId?: string
): ChatParticipant | null {
  if (!channel) return null;
  return (
    channel.participants.find((p) => String(p.id) !== String(selfId)) ||
    channel.participants[0] ||
    null
  );
}

const MEDIA_BASE = ((import.meta.env.VITE_MEDIA_URL as string | undefined) || '').replace(/\/+$/, '');

export function avatarUrl(participant: ChatParticipant | null): string | null {
  if (!participant?.profile_photo) return null;
  const photo = participant.profile_photo;
  if (/^https?:\/\//i.test(photo)) return photo;
  return MEDIA_BASE ? `${MEDIA_BASE}${photo}` : photo;
}

export function initialsOf(name?: string): string {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

export function roleLabel(participant: ChatParticipant | null): string {
  if (!participant) return '';
  if (participant.role_display) return participant.role_display;
  if (!participant.role) return '';
  return participant.role
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatClock(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatListStamp(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return formatClock(value);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  if (now.getTime() - date.getTime() < 7 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  return date.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

export function formatDayHeading(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { day: '2-digit', month: 'long', year: 'numeric' });
}

export function previewOf(channel: ChatChannel): string {
  const last = channel.last_message;
  if (!last) return 'No messages yet';
  if (last.kind === 'VOICE') return last.content || 'Voice message';
  const body = (last.content || '').trim();
  if (!body) return 'No messages yet';
  return last.sender_name ? `${last.sender_name.split(' ')[0]}: ${body}` : body;
}

export function totalUnread(channels: ChatChannel[]): number {
  return channels.reduce((sum, channel) => sum + (channel.unread_count || 0), 0);
}

/** Merge a newly received message into an existing thread, ignoring duplicates. */
export function mergeMessage(thread: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  if (thread.some((message) => message.id === incoming.id)) return thread;
  return [...thread, incoming].sort(
    (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
  );
}
