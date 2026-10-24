"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { MessageCircle, Mic, Plus, Send, Square, X } from "lucide-react"

import {
  createAssistantConversation,
  loadAssistantConversations,
  loadAssistantMessages,
  sendAssistantMessage,
  transcribeAssistantAudio,
  type AssistantConversation,
  type AssistantMessage,
} from "@/lib/driver-features"

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "am", label: "Amharic" },
  { value: "om", label: "Afaan Oromo" },
  { value: "auto", label: "Auto detect" },
]

export default function DriverChatbot() {
  const [open, setOpen] = useState(false)
  const [conversations, setConversations] = useState<AssistantConversation[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [language, setLanguage] = useState("en")
  const [loadingThreads, setLoadingThreads] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [working, setWorking] = useState(false)
  const [recording, setRecording] = useState(false)
  const [pendingTranscript, setPendingTranscript] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const loadThreads = useCallback(async () => {
    const response = await loadAssistantConversations()
    const threads = Array.isArray(response) ? response : []
    setConversations(threads)
    setActiveId((current) => {
      if (current && threads.some((thread) => thread.id === current)) return current
      return threads[0]?.id ?? null
    })
  }, [])

  useEffect(() => {
    let current = true
    loadAssistantConversations()
      .then((response) => {
        if (!current) return
        const threads = Array.isArray(response) ? response : []
        setConversations(threads)
        setActiveId(threads[0]?.id ?? null)
      })
      .catch((reason: unknown) => {
        if (current) {
          setError(reason instanceof Error ? reason.message : "Could not load the Chatbot.")
        }
      })
      .finally(() => {
        if (current) setLoadingThreads(false)
      })
    return () => {
      current = false
    }
  }, [])

  useEffect(() => {
    if (activeId === null) {
      setMessages([])
      return
    }
    let current = true
    setLoadingMessages(true)
    loadAssistantMessages(activeId)
      .then((items) => {
        if (current) setMessages(Array.isArray(items) ? items : [])
      })
      .catch((reason: unknown) => {
        if (current) {
          setError(reason instanceof Error ? reason.message : "Could not load this conversation.")
        }
      })
      .finally(() => {
        if (current) setLoadingMessages(false)
      })
    return () => {
      current = false
    }
  }, [activeId])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [open])

  useEffect(() => {
    const openChatbot = () => setOpen(true)
    window.addEventListener("greenpath:open-chatbot", openChatbot)
    return () => window.removeEventListener("greenpath:open-chatbot", openChatbot)
  }, [])

  useEffect(() => {
    if (!open) return
    const node = scrollRef.current
    if (!node) return
    if (typeof node.scrollTo === "function") {
      node.scrollTo({ top: node.scrollHeight, behavior: "smooth" })
    } else {
      node.scrollTop = node.scrollHeight
    }
  }, [messages, working, open])

  useEffect(
    () => () => {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop()
    },
    [],
  )

  async function startThread() {
    if (working) return
    setWorking(true)
    setError("")
    setNotice("")
    try {
      const created = await createAssistantConversation()
      await loadThreads()
      setActiveId(created.id)
      setMessages([])
      window.setTimeout(() => inputRef.current?.focus(), 0)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start a conversation.")
    } finally {
      setWorking(false)
    }
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (working) return
    const content = inputRef.current?.value.trim() ?? ""
    if (!content) return
    setWorking(true)
    setError("")
    setNotice("")
    if (inputRef.current) inputRef.current.value = ""
    try {
      let conversationId = activeId
      if (conversationId === null) {
        const created = await createAssistantConversation()
        conversationId = created.id
        setActiveId(created.id)
      }
      const reply = await sendAssistantMessage(conversationId, content, language)
      setMessages((current) => [...current, reply.user_message, reply.assistant_message])
      await loadThreads()
    } catch (reason) {
      if (inputRef.current) inputRef.current.value = content
      setError(reason instanceof Error ? reason.message : "The Chatbot could not reply.")
    } finally {
      setWorking(false)
    }
  }

  async function toggleRecording() {
    setError("")
    setNotice("")
    if (recording) {
      recorderRef.current?.stop()
      setRecording(false)
      return
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Voice recording is not available in this browser. You can type instead.")
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" })
        chunksRef.current = []
        if (blob.size === 0) {
          setError("The recording was empty. Try again or type your message.")
          return
        }
        setWorking(true)
        try {
          const file = new File([blob], "chatbot-recording.webm", {
            type: blob.type || "audio/webm",
          })
          const result = await transcribeAssistantAudio(file, language)
          setPendingTranscript(result.text)
          setNotice("Review the transcript, then use it in the message box.")
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : "The recording could not be transcribed.")
        } finally {
          setWorking(false)
        }
      }
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
    } catch {
      setError("Microphone access was not granted. You can type instead.")
    }
  }

  function useTranscript() {
    if (inputRef.current && pendingTranscript) {
      inputRef.current.value = pendingTranscript
      inputRef.current.focus()
    }
    setPendingTranscript("")
  }

  return (
    <div className="chatbot-widget">
      {open && (
        <section
          className="chatbot-window"
          role="dialog"
          aria-modal="false"
          aria-label="Chatbot"
        >
          <header className="chatbot-head">
            <div className="chatbot-head-title">
              <span className="chatbot-logo" aria-hidden="true">
                <MessageCircle size={16} />
              </span>
              <div>
                <h3>Chatbot</h3>
                <p className="chatbot-subtitle">Driver support for deliveries and earnings</p>
              </div>
            </div>
            <button
              className="chatbot-icon-button"
              type="button"
              onClick={() => void startThread()}
              aria-label="New conversation"
              title="New conversation"
              disabled={working}
            >
              <Plus size={16} aria-hidden="true" />
            </button>
            <button
              className="chatbot-icon-button"
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close Chatbot"
              title="Close Chatbot"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>

          <div className="chatbot-toolbar">
            <select
              aria-label="Chatbot language"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            >
              {LANGUAGES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Chatbot conversation"
              value={activeId ?? ""}
              onChange={(event) => setActiveId(Number(event.target.value) || null)}
            >
              <option value="">
                {loadingThreads ? "Loading conversations…" : "New conversation"}
              </option>
              {conversations.map((thread) => (
                <option key={thread.id} value={thread.id}>
                  {thread.title || "Conversation"}
                </option>
              ))}
            </select>
          </div>

          {conversations.length > 1 && (
            <ul className="chatbot-threads" aria-label="Recent conversations">
              {conversations.map((thread) => (
                <li key={thread.id}>
                  <button
                    type="button"
                    className={`chatbot-thread${thread.id === activeId ? " chatbot-thread-active" : ""}`}
                    onClick={() => setActiveId(thread.id)}
                    aria-current={thread.id === activeId ? "true" : undefined}
                  >
                    <strong>{thread.title || "New conversation"}</strong>
                    <small>{new Date(thread.updated_at).toLocaleDateString()}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="chatbot-messages" ref={scrollRef} aria-live="polite">
            {loadingMessages && <p className="chatbot-typing">Loading messages…</p>}
            {!loadingMessages && messages.length === 0 && (
              <div className="chatbot-empty">
                <p>
                  Ask about driver approval, availability, delivery offers, shipment status,
                  messages, wallet earnings, bank accounts, withdrawals, profile, or account
                  settings.
                </p>
                <p>
                  Answers use your own authorized records and never invent a balance or
                  assignment. Do not share passwords or bank details.
                </p>
              </div>
            )}
            {messages.map((message) => (
              <p
                key={message.id}
                className={`chatbot-message chatbot-message-${message.role}`}
              >
                <strong>{message.role === "assistant" ? "Chatbot" : "You"}</strong>
                {message.content}
                <small>{new Date(message.created_at).toLocaleTimeString()}</small>
              </p>
            ))}
            {working && <p className="chatbot-typing" role="status">Chatbot is replying…</p>}
          </div>

          {pendingTranscript && (
            <div className="chatbot-transcript">
              <p className="eyebrow">VOICE TRANSCRIPT</p>
              <p className="chatbot-transcript-text">{pendingTranscript}</p>
              <div>
                <button className="button button-secondary button-small" type="button" onClick={useTranscript}>
                  Use this text
                </button>
              </div>
            </div>
          )}

          {(error || notice || recording) && (
            <div className="chatbot-alerts">
              {error && <p className="feedback feedback-error" role="alert">{error}</p>}
              {notice && <p className="feedback feedback-success" role="status">{notice}</p>}
              {recording && <p className="feedback feedback-warning" role="status">Recording… stop to review the transcript.</p>}
            </div>
          )}

          <form className="chatbot-composer" onSubmit={handleSend}>
            <textarea
              ref={inputRef}
              aria-label="Chatbot message"
              name="content"
              rows={1}
              maxLength={2000}
              placeholder="Ask the Chatbot…"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
            />
            <button
              className={`chatbot-voice${recording ? " recording" : ""}`}
              type="button"
              onClick={() => void toggleRecording()}
              aria-pressed={recording}
              aria-label={recording ? "Stop voice recording" : "Record a voice message"}
              title={recording ? "Stop voice recording" : "Record a voice message"}
              disabled={working}
            >
              {recording ? <Square size={15} aria-hidden="true" /> : <Mic size={15} aria-hidden="true" />}
            </button>
            <button
              className="chatbot-send"
              type="submit"
              aria-label="Send message"
              title="Send message"
              disabled={working}
            >
              <Send size={16} aria-hidden="true" />
            </button>
          </form>
          <p className="chatbot-note">
            Voice recognition and playback depend on browser language support. Verify important details.
          </p>
        </section>
      )}

      <button
        className="chatbot-launcher"
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={open ? "Close Chatbot" : "Open Chatbot"}
        title={open ? "Close Chatbot" : "Open Chatbot"}
      >
        {open ? <X size={22} aria-hidden="true" /> : <MessageCircle size={22} aria-hidden="true" />}
      </button>
    </div>
  )
}
