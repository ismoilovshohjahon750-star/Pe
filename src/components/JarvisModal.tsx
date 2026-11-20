import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Mic, Send, Square, X } from 'lucide-react';

interface JarvisMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  tools?: string[];
  isError?: boolean;
}

interface JarvisModalProps {
  open: boolean;
  onClose: () => void;
}

export function JarvisModal({ open, onClose }: JarvisModalProps) {
  const [messages, setMessages] = useState<JarvisMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [liveTools, setLiveTools] = useState<string[]>([]);
  const [recording, setRecording] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, sending, liveTools]);

  useEffect(() => {
    if (!open && mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  }, [open]);

  if (!open) return null;

  const sendMessage = async (textOverride?: string) => {
    const trimmed = (textOverride ?? input).trim();
    if (!trimmed || sending) return;

    const priorHistory = messages
      .filter((m) => !m.isError)
      .map((m) => ({ role: m.role, text: m.text }));

    const userMsg: JarvisMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: trimmed,
    };
    setMessages((prev) => [...prev, userMsg]);
    if (!textOverride) setInput('');
    setSending(true);
    setLiveTools([]);

    try {
      const res = await fetch('/api/jarvis/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream, application/json',
        },
        body: JSON.stringify({
          message: trimmed,
          history: priorHistory,
          stream: true,
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream') && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finished = false;

        const handleSseBlock = (block: string) => {
          const lines = block.split('\n');
          let eventName = 'message';
          const dataLines: string[] = [];
          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventName = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trim());
            }
          }
          if (dataLines.length === 0) return;
          const payload = JSON.parse(dataLines.join('\n')) as {
            tool?: string;
            reply?: string;
            executedTools?: string[];
            error?: string;
          };

          if (eventName === 'tool_start' && payload.tool) {
            const toolName = payload.tool;
            setLiveTools((prev) => [...prev, toolName]);
          } else if (eventName === 'done') {
            finished = true;
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: 'assistant',
                text: payload.reply || '',
                tools: payload.executedTools,
              },
            ]);
          } else if (eventName === 'error') {
            finished = true;
            setMessages((prev) => [
              ...prev,
              {
                id: `e-${Date.now()}`,
                role: 'assistant',
                text: payload.error || 'J.A.R.V.I.S. bilan bog‘lanishda xatolik yuz berdi.',
                isError: true,
              },
            ]);
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf('\n\n');
          while (boundary !== -1) {
            const block = buffer.slice(0, boundary).trim();
            buffer = buffer.slice(boundary + 2);
            if (block) {
              try {
                handleSseBlock(block);
              } catch {
                // ignore partial/malformed SSE block
              }
            }
            boundary = buffer.indexOf('\n\n');
          }
        }

        if (!finished && buffer.trim()) {
          try {
            handleSseBlock(buffer.trim());
          } catch {
            // ignore
          }
        }
        return;
      }

      const data = (await res.json()) as {
        reply?: string;
        executedTools?: string[];
        error?: string;
      };
      if (!res.ok || data.error) {
        setMessages((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            role: 'assistant',
            text: data.error || 'J.A.R.V.I.S. bilan bog‘lanishda xatolik yuz berdi.',
            isError: true,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: data.reply || '',
            tools: data.executedTools,
          },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          text: (err as Error).message || 'Tarmoq xatoligi',
          isError: true,
        },
      ]);
    } finally {
      setSending(false);
      setLiveTools([]);
    }
  };

  const toggleVoice = async () => {
    if (recording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          text: 'Mikrofon ushbu brauzerda qo‘llab-quvvatlanmaydi.',
          isError: true,
        },
      ]);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size === 0) return;

        const reader = new FileReader();
        reader.onloadend = async () => {
          const resultStr = String(reader.result || '');
          const base64 = resultStr.split(',')[1] || '';
          if (!base64) return;
          setSending(true);
          try {
            const res = await fetch('/api/jarvis/transcribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ audioBase64: base64, mimeType }),
            });
            const data = (await res.json()) as { text?: string; error?: string };
            setSending(false);
            if (!res.ok || data.error) {
              setMessages((prev) => [
                ...prev,
                {
                  id: `e-${Date.now()}`,
                  role: 'assistant',
                  text: data.error || 'Ovozni matnga o‘girib bo‘lmadi.',
                  isError: true,
                },
              ]);
              return;
            }
            if (data.text) {
              await sendMessage(data.text);
            }
          } catch (err) {
            setSending(false);
            setMessages((prev) => [
              ...prev,
              {
                id: `e-${Date.now()}`,
                role: 'assistant',
                text: (err as Error).message,
                isError: true,
              },
            ]);
          }
        };
        reader.readAsDataURL(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          text: (err as Error).message || 'Mikrofonga ruxsat berilmadi.',
          isError: true,
        },
      ]);
    }
  };

  return (
    <section
      aria-label="J.A.R.V.I.S. yordamchi"
      className="w-full shrink-0 px-3 pt-1.5 pb-8 bg-[#03060C] border-t border-white/10 flex flex-col items-center"
    >
      <div className="flex flex-col items-center w-full max-w-[350px] sm:max-w-[390px]">
        {/* Compact Title */}
        <h2 className="text-sm sm:text-base font-light tracking-[0.26em] text-white/95 mb-2 select-none">
          J.A.R.V.I.S.
        </h2>

        {/* Compact Portrait Liquid Glass Card */}
        <div className="relative w-full h-[250px] sm:h-[265px] rounded-[24px] backdrop-blur-2xl bg-[linear-gradient(125deg,rgba(255,255,255,0.16)_0%,rgba(255,255,255,0.04)_48%,rgba(255,255,255,0.1)_100%)] border border-white/30 shadow-[inset_1px_1px_2px_rgba(255,255,255,0.58),inset_-1px_-1px_2px_rgba(255,255,255,0.2),0_18px_50px_rgba(0,0,0,0.68)] flex flex-col">
          {/* Top-left X Close Button */}
          <div className="px-3.5 pt-3 pb-1 flex items-center justify-start shrink-0">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close J.A.R.V.I.S."
              className="p-0.5 text-white/90 hover:text-white transition-opacity hover:opacity-80 cursor-pointer"
            >
              <X className="w-4 h-4" strokeWidth={1.75} />
            </button>
          </div>

          {/* Chat Messages */}
          <div
            ref={listRef}
            className="flex-1 min-h-0 overflow-y-auto win10-scroll px-3.5 py-1 space-y-2"
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[82%] rounded-2xl px-3 py-1.5 text-xs leading-relaxed backdrop-blur-xl border shadow-[inset_1px_1px_1px_rgba(255,255,255,0.35)] ${
                    msg.isError
                      ? 'bg-rose-500/20 border-rose-300/40 text-rose-100 rounded-tl-md'
                      : msg.role === 'user'
                        ? 'bg-white/[0.15] border-white/30 text-white rounded-tr-md'
                        : 'bg-white/[0.08] border-white/20 text-white/95 rounded-tl-md'
                  }`}
                >
                  <div className="whitespace-pre-wrap break-words">{msg.text}</div>
                  {msg.tools && msg.tools.length > 0 && (
                    <div className="mt-1 text-[10px] text-white/60 font-mono-tabular">
                      {msg.tools.join(' · ')}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex justify-start">
                <div className="max-w-[82%] rounded-2xl rounded-tl-md px-3 py-1.5 text-xs backdrop-blur-xl bg-white/[0.08] border border-white/20 text-white/75 space-y-1">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-3.5 h-3.5 animate-pulse" strokeWidth={1.75} />
                    <span>O‘ylanmoqda...</span>
                  </div>
                  {liveTools.length > 0 && (
                    <div className="text-[10px] text-white/60 font-mono-tabular break-words">
                      {liveTools.join(' · ')}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Input Bar ("Xabar yuborish...") */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendMessage();
            }}
            className="px-3.5 pt-1.5 pb-8 shrink-0"
          >
            <div className="relative flex items-center rounded-full backdrop-blur-xl bg-white/[0.08] border border-white/35 shadow-[inset_1px_1px_1.5px_rgba(255,255,255,0.5),inset_-1px_-1px_1.5px_rgba(255,255,255,0.2),0_4px_18px_rgba(0,0,0,0.38)] px-3.5 py-1.5">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Xabar yuborish..."
                aria-label="Xabar yuborish"
                className="flex-1 bg-transparent text-xs text-white placeholder:text-white/55 focus:outline-none pr-2"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                aria-label="Xabarni yuborish"
                className="p-0.5 text-white/80 hover:text-white disabled:opacity-40 transition-opacity cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" strokeWidth={1.75} />
              </button>
            </div>
          </form>

          {/* Overlapping Circular Liquid Glass Microphone Button */}
          <button
            type="button"
            onClick={() => void toggleVoice()}
            aria-label={recording ? 'Ovoz yozishni to‘xtatish' : 'Ovozli xabar'}
            className={`absolute -bottom-6 left-1/2 -translate-x-1/2 w-12 h-12 rounded-full backdrop-blur-2xl border flex items-center justify-center transition-all duration-150 cursor-pointer ${
              recording
                ? 'bg-rose-500/30 border-rose-200/60 shadow-[inset_2px_2px_4px_rgba(255,255,255,0.75),0_0_24px_rgba(244,63,94,0.65)] scale-105 animate-pulse'
                : 'bg-[linear-gradient(135deg,rgba(255,255,255,0.24)_0%,rgba(255,255,255,0.06)_55%,rgba(255,255,255,0.16)_100%)] border-white/45 shadow-[inset_2px_2px_4px_rgba(255,255,255,0.8),inset_-2px_-2px_4px_rgba(255,255,255,0.25),0_10px_24px_rgba(0,0,0,0.6)] hover:scale-105 active:scale-95'
            }`}
          >
            {recording ? (
              <Square className="w-4 h-4 text-white" strokeWidth={1.75} />
            ) : (
              <Mic className="w-5 h-5 text-white" strokeWidth={1.75} />
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
