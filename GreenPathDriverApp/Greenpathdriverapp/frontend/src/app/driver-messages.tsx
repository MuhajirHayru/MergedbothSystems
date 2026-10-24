"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { MessageSquareText, RefreshCw } from "lucide-react";

import {
  loadConversationInbox,
  loadConversationMessages,
  markConversationRead,
  sendShipmentMessage,
  type ConversationSummary,
  type ShipmentMessage,
} from "@/lib/driver-features";

function readable(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function DriverMessages() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messagesByShipment, setMessagesByShipment] = useState<Record<number, ShipmentMessage[]>>({});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadInbox = useCallback(async () => {
    const inbox = await loadConversationInbox();
    setConversations(inbox.conversations);
    setActiveId((current) => {
      if (current && inbox.conversations.some((item) => item.shipment_id === current)) {
        return current;
      }
      return inbox.conversations[0]?.shipment_id ?? null;
    });
  }, []);

  useEffect(() => {
    let current = true;
    async function load() {
      try {
        const inbox = await loadConversationInbox();
        if (!current) return;
        setConversations(inbox.conversations);
        setActiveId(inbox.conversations[0]?.shipment_id ?? null);
      } catch (reason) {
        if (current) {
          setError(reason instanceof Error ? reason.message : "Could not load conversations.");
        }
      } finally {
        if (current) setLoading(false);
      }
    }
    void load();
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (activeId === null) return;
    let current = true;
    loadConversationMessages(activeId)
      .then((page) => {
        if (current) {
          setMessagesByShipment((previous) => ({ ...previous, [activeId]: page.results }));
        }
      })
      .catch((reason: unknown) => {
        if (current) {
          setError(reason instanceof Error ? reason.message : "Could not load messages.");
        }
      });
    return () => {
      current = false;
    };
  }, [activeId]);

  const active = conversations.find((item) => item.shipment_id === activeId) ?? null;
  const messages = activeId === null ? [] : messagesByShipment[activeId] ?? [];
  const threadLoading = activeId !== null && !(activeId in messagesByShipment);

  async function openConversation(conversation: ConversationSummary) {
    setActiveId(conversation.shipment_id);
    setError("");
    setNotice("");
    try {
      await markConversationRead(conversation.shipment_id);
      await loadInbox();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the conversation.");
    }
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;
    const form = event.currentTarget;
    const field = form.elements.namedItem("body") as HTMLTextAreaElement | null;
    const body = field?.value.trim() ?? "";
    if (!body) return;
    setWorking(true);
    setError("");
    setNotice("");
    try {
      await sendShipmentMessage(active.shipment_id, body);
      if (field) field.value = "";
      const page = await loadConversationMessages(active.shipment_id);
      setMessagesByShipment((previous) => ({ ...previous, [active.shipment_id]: page.results }));
      await loadInbox();
      setNotice("Message sent.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Message could not be sent.");
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return <section className="work-panel messages-panel" aria-busy="true">Loading your conversations…</section>;
  }

  return (
    <section className="work-panel messages-panel" id="messages" aria-labelledby="messages-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">SHIPMENT MESSAGES</p>
          <h2 id="messages-heading">Conversations</h2>
        </div>
        <button
          className="button button-secondary"
          type="button"
          disabled={working}
          onClick={() => {
            setWorking(true);
            void loadInbox()
              .catch((reason: unknown) =>
                setError(reason instanceof Error ? reason.message : "Could not refresh conversations."),
              )
              .finally(() => setWorking(false));
          }}
        >
          <RefreshCw size={13} aria-hidden="true" /> Refresh
        </button>
      </div>
      <p className="panel-description">
        Every thread belongs to a shipment you take part in. Other accounts can never see these messages.
      </p>
      {error && <p className="feedback feedback-error" role="alert">{error}</p>}
      {notice && <p className="feedback feedback-success" role="status">{notice}</p>}

      <div className="messages-layout">
        <ul className="conversation-list">
          {conversations.length === 0 && <li className="document-empty">No conversations yet.</li>}
          {conversations.map((conversation) => (
            <li key={conversation.shipment_id}>
              <button
                type="button"
                className={`conversation-item${conversation.shipment_id === activeId ? " conversation-item-active" : ""}`}
                aria-current={conversation.shipment_id === activeId ? "true" : undefined}
                onClick={() => void openConversation(conversation)}
              >
                <span className="conversation-item-head">
                  <strong>Shipment #{conversation.shipment_id}</strong>
                  {conversation.unread_count > 0 && (
                    <span className="conversation-unread">{conversation.unread_count}</span>
                  )}
                </span>
                <small>{conversation.product_summary}</small>
                <small>
                  {conversation.pickup_region} → {conversation.destination_region} ·{" "}
                  {readable(conversation.kind)}
                </small>
                {conversation.last_message && (
                  <span className="conversation-preview">
                    {conversation.last_message.sender_username}: {conversation.last_message.body}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>

        <div className="conversation-thread">
          {!active && <p className="document-empty">Select a conversation to read its messages.</p>}
          {active && (
            <>
              <div className="conversation-thread-head">
                <div>
                  <p className="eyebrow">SHIPMENT #{active.shipment_id}</p>
                  <strong>{active.product_summary}</strong>
                </div>
                <span className="status-pill">{readable(active.status)}</span>
              </div>
              {active.participants.length > 0 && (
                <p className="conversation-participants">
                  {active.participants.map((participant) => `${participant.display_name} (${participant.role_label})`).join(" · ")}
                </p>
              )}
              {threadLoading && <p className="document-empty">Loading messages…</p>}
              {!threadLoading && messages.length === 0 && <p className="document-empty">No messages yet.</p>}
              <div className="conversation-messages">
                {messages.map((message) => (
                  <p className="shipment-message" key={message.id}>
                    <strong>{message.sender_username}</strong> · {new Date(message.created_at).toLocaleString()}
                    <br />
                    {message.body}
                  </p>
                ))}
              </div>
              {active.can_post ? (
                <form className="shipment-message-form" onSubmit={handleSend}>
                  <label className="form-field">
                    Message
                    <textarea name="body" maxLength={2000} required />
                  </label>
                  <button className="button button-secondary" type="submit" disabled={working}>
                    <MessageSquareText size={13} aria-hidden="true" /> Send message
                  </button>
                </form>
              ) : (
                <p className="feedback feedback-warning" role="status">
                  This offer conversation is read-only until the shipment is assigned to you.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
