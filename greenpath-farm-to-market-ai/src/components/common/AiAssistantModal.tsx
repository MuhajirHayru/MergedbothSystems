import React, { useState, useRef, useEffect } from 'react';
import { apiClient } from '../../services/apiClient';
import { useApp } from '../../context/AppContext';
import {
  Sparkles,
  X,
  Send,
  Mic,
  Volume2,
  RefreshCw,
  Globe,
  Bot,
  User,
  Shield,
  Minus,
  Maximize2,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';

export const AiAssistantModal: React.FC = () => {
  const { aiModalOpen, setAiModalOpen, language, setLanguage, currentRole } = useApp();

  const [inputPrompt, setInputPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingTimer, setRecordingTimer] = useState<any>(null);
  const conversationRef = useRef<string | null>(null);

  const [messages, setMessages] = useState<
    Array<{ id: string; role: 'user' | 'assistant'; text: string; time: string; isAudio?: boolean }>
  >([
    {
      id: 'init_1',
      role: 'assistant',
      text:
        language === 'am'
          ? 'እንኳን ወደ ግሪንፓዝ የግብርና AI ረዳት በደህና መጡ! በገበያ ዋጋዎች፣ በምርት ማጓጓዣ ዋጋ፣ በጥራት ደረጃ እና በቻፓ ክፍያዎች ዙሪያ ምን ማወቅ ይፈልጋሉ?'
          : language === 'om'
          ? "Baga nagaan gara gargaaraa AI GreenPath dhuftan! Gatii gabaa qonnaa, geejjiba oomishaa fi kaffaltii Chapa irratti maal baruu barbaaddu?"
          : 'Welcome to GreenPath Farm to Market AI Advisor! I provide real-time Ethiopian commodity intelligence, logistics rate guidance across freight corridors, and harvest storage advisory. How can I assist you?',
      time: 'Just now',
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Contextual suggested questions based on active user role
  const getSuggestedQuestions = () => {
    switch (currentRole) {
      case 'farmer':
        return [
          language === 'am'
            ? 'በአዲስ አበባ ገበያ የቲማቲም የዛሬ ዋጋ ስንት ነው?'
            : 'Current wholesale price for Meki tomatoes in Addis Ababa?',
          language === 'am'
            ? 'ቀይ ሽንኩርት በክምችት እንዳይበላሽ ምን ይደረጋል?'
            : 'Post-harvest curing guidelines for red shallot onions?',
          language === 'am'
            ? 'ከመቂ አዲስ አበባ የአይሱዙ ጭነት አማካይ ክፍያ ስንት ነው?'
            : 'Average freight rate for 4.5-ton Isuzu from Meki to Addis?',
        ];
      case 'wholesaler':
        return [
          'Which Ethiopian regions have surplus avocado harvests this week?',
          'What is the standard Chapa Escrow release protocol upon delivery?',
          'Freight cost comparison: Mojo Expressway vs Old Highway?',
        ];
      case 'retailer':
        return [
          'What are the prevailing retail gross margins for table potatoes?',
          'How do I request quality inspection before escrow payout release?',
          'Wholesale onion pricing forecast for the coming week?',
        ];
      case 'driver':
        return [
          'What are the mandatory waybill PIN verification steps for cargo release?',
          'Safe truck speed & ventilation recommendations for perishable freight?',
          'Freight fee settlement protocol with platform escrow?',
        ];
      case 'financial_manager':
        return [
          'Explain the current Chapa multi-rail reconciliation methodology.',
          'Summary of pending bank payout wire requests awaiting disbursement?',
          'Which Ethiopian region has the highest gross escrow settlement volume?',
        ];
      case 'user_admin':
      case 'super_admin':
        return [
          'What are the accreditation rules for commercial driving licenses?',
          'Review the 3-attempt account lockout policy specifications.',
          'How does the administrative hierarchy coordinate across Ethiopian regions?',
        ];
      default:
        return [
          'How does GreenPath protect farmers with guaranteed escrow payments?',
          'How do I register as an accredited agribusiness wholesaler?',
          'What agricultural commodities are traded on the platform?',
        ];
    }
  };

  const handleSend = async (textToSend?: string) => {
    const prompt = textToSend || inputPrompt;
    if (!prompt.trim() || loading) return;

    const userMsg = {
      id: `usr_${Date.now()}`,
      role: 'user' as const,
      text: prompt,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputPrompt('');
    setLoading(true);

    try {
      if (!conversationRef.current) {
        const convoRes = await apiClient.post('/assistant/conversations/', {
          language,
          role: currentRole,
        });
        conversationRef.current = convoRes.data.id;
      }
      const res = await apiClient.post(`/assistant/conversations/${conversationRef.current}/messages/`, {
        content: prompt,
        language,
      });
      const data = res.data;
      const botMsg = {
        id: `bot_${Date.now()}`,
        role: 'assistant' as const,
        text: data.assistant_message?.content || 'Analysis completed.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch (err) {
      console.error(err);
      const botMsg = {
        id: `bot_${Date.now()}`,
        role: 'assistant' as const,
        text: 'AI service unavailable. Please try again later.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, botMsg]);
    } finally {
      setLoading(false);
    }
  };

  const startVoiceRecording = () => {
    setIsRecording(true);
    setRecordingSeconds(0);
    const timer = setInterval(() => {
      setRecordingSeconds((prev) => prev + 1);
    }, 1000);
    setRecordingTimer(timer);
  };

  const stopVoiceRecording = () => {
    if (recordingTimer) clearInterval(recordingTimer);
    setIsRecording(false);
    handleSend('Voice advisory inquiry submitted (Ethiopian Commodity Query)');
    setRecordingSeconds(0);
  };

  const clearChat = () => {
    setMessages([
      {
        id: `init_${Date.now()}`,
        role: 'assistant',
        text: 'Conversation reset. How can I assist your agribusiness today?',
        time: 'Just now',
      },
    ]);
  };

  // Floating trigger button when closed
  if (!aiModalOpen) {
    return (
      <button
        onClick={() => setAiModalOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 bg-[#15803D] hover:bg-[#166534] text-white rounded-full shadow-2xl transition-all hover:scale-105 focus:outline-none focus:ring-4 focus:ring-emerald-700/30 group"
        title="Open GreenPath AI Market Advisor"
        aria-label="Open AI Advisor"
      >
        <Sparkles className="w-5 h-5 text-emerald-200 group-hover:rotate-12 transition-transform" />
        <span className="text-xs font-bold tracking-wide">GreenPath AI Advisor</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 sm:bottom-6 right-4 sm:right-6 z-50 w-[95vw] sm:w-[440px] h-[600px] max-h-[88vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden text-slate-900 dark:text-slate-100 animate-in fade-in slide-in-from-bottom-4 duration-200">
      {/* Header */}
      <div className="px-4 py-3 bg-[#15803D] text-white flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center font-bold">
            <Sparkles className="w-4 h-4 text-emerald-200" />
          </div>
          <div>
            <div className="font-bold text-xs flex items-center gap-1.5">
              <span>GreenPath AI Advisor</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/20 font-mono capitalize">
                {currentRole.replace(/_/g, ' ')} Context
              </span>
            </div>
            <div className="text-[10px] text-emerald-100/90">
              Multilingual (EN · አማርኛ · Afaan Oromoo)
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={clearChat}
            className="p-1 text-white/80 hover:text-white hover:bg-white/10 rounded transition-colors"
            title="Clear Chat"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setAiModalOpen(false)}
            className="p-1 text-white/80 hover:text-white hover:bg-white/10 rounded transition-colors"
            title="Minimize"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Suggested Quick Prompts */}
      <div className="px-3 py-2 bg-slate-50 dark:bg-slate-950/40 border-b border-slate-200 dark:border-slate-800 flex gap-1.5 overflow-x-auto text-[10px] scrollbar-none shrink-0">
        {getSuggestedQuestions().map((q, idx) => (
          <button
            key={idx}
            onClick={() => handleSend(q)}
            className="px-2.5 py-1 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-[#15803D] whitespace-nowrap shrink-0 transition-colors"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-xs scrollbar-thin">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              className={`flex items-start gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
            >
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 ${
                  isUser
                    ? 'bg-[#15803D] text-white'
                    : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                }`}
              >
                {isUser ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
              </div>

              <div
                className={`max-w-[82%] p-3 rounded-2xl space-y-1 shadow-xs ${
                  isUser
                    ? 'bg-[#15803D] text-white rounded-tr-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-tl-xs border border-slate-200 dark:border-slate-700/60'
                }`}
              >
                <p className="whitespace-pre-line leading-relaxed">{msg.text}</p>
                <div
                  className={`text-[9px] text-right font-mono ${
                    isUser ? 'text-emerald-100' : 'text-slate-400'
                  }`}
                >
                  {msg.time}
                </div>
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-slate-400 p-2">
            <Sparkles className="w-4 h-4 text-emerald-600 animate-spin" />
            <span>Consulting Ethiopian market price index...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Box with Voice Recording Simulation */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
        {isRecording ? (
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 animate-pulse">
            <span className="text-xs font-bold font-mono">
              Listening in {language.toUpperCase()}: 0:0{recordingSeconds}
            </span>
            <button
              onClick={stopVoiceRecording}
              className="px-3 py-1 bg-red-600 text-white rounded text-xs font-bold"
            >
              Send Voice
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-1.5"
          >
            <button
              type="button"
              onClick={startVoiceRecording}
              className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              title="Voice Inquiry"
            >
              <Mic className="w-4 h-4" />
            </button>

            <input
              type="text"
              value={inputPrompt}
              onChange={(e) => setInputPrompt(e.target.value)}
              placeholder="Ask commodity price, haulage, or grading in EN / አማርኛ..."
              className="flex-1 p-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#15803D]"
            />

            <button
              type="submit"
              disabled={loading || !inputPrompt.trim()}
              className="p-2 bg-[#15803D] hover:bg-[#166534] disabled:bg-slate-300 text-white rounded-lg transition-colors shadow-xs"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
