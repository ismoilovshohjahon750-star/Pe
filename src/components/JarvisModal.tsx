import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Mic, Send, Square, Volume2, X } from 'lucide-react';
import {
  computeRmsLevel,
  createInitialVadState,
  DEFAULT_VAD_CONFIG,
  prepareTextForSpeech,
  stepVadState,
} from '../utils/voiceSession';

interface JarvisMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  tools?: string[];
  isError?: boolean;
}

type VoicePhase = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking';

interface JarvisModalProps {
  open: boolean;
  onClose: () => void;
  onToolActivity?: (event: { type: 'tool_start' | 'tool_done' | 'done'; tool?: string }) => void;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const resultStr = String(reader.result || '');
      resolve(resultStr.split(',')[1] || '');
    };
    reader.onerror = () => reject(new Error('Audio faylni o‘qishda xatolik yuz berdi.'));
    reader.readAsDataURL(blob);
  });
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function JarvisModal({ open, onClose, onToolActivity }: JarvisModalProps) {
  const [messages, setMessages] = useState<JarvisMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [liveTools, setLiveTools] = useState<string[]>([]);
  const [liveMode, setLiveMode] = useState(false);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle');
  const [speechActive, setSpeechActive] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<JarvisMessage[]>([]);
  const openRef = useRef(open);
  const liveModeRef = useRef(false);
  const sessionTokenRef = useRef(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const vadIntervalRef = useRef<number | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const activeAudioElRef = useRef<HTMLAudioElement | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopReasonRef = useRef<'manual' | 'idle' | 'speech'>('manual');
  const startListeningRef = useRef<(token: number) => Promise<void>>(async () => {});

  messagesRef.current = messages;
  openRef.current = open;

  const cleanupCaptureResources = useCallback(() => {
    if (vadIntervalRef.current !== null) {
      window.clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        // ignore disconnect failure
      }
      sourceNodeRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore stop failure
      }
    }
    mediaRecorderRef.current = null;
    if (activeStreamRef.current) {
      activeStreamRef.current.getTracks().forEach((t) => t.stop());
      activeStreamRef.current = null;
    }
    setSpeechActive(false);
  }, []);

  const cleanupPlaybackResources = useCallback(() => {
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.onended = null;
        activeSourceRef.current.stop();
        activeSourceRef.current.disconnect();
      } catch {
        // ignore stop failure
      }
      activeSourceRef.current = null;
    }
    if (activeAudioElRef.current) {
      try {
        activeAudioElRef.current.onended = null;
        activeAudioElRef.current.onerror = null;
        activeAudioElRef.current.pause();
        activeAudioElRef.current.src = '';
      } catch {
        // ignore pause failure
      }
      activeAudioElRef.current = null;
    }
  }, []);

  const stopLiveMode = useCallback(() => {
    sessionTokenRef.current += 1;
    liveModeRef.current = false;
    stopReasonRef.current = 'manual';
    setLiveMode(false);
    setVoicePhase('idle');
    setSpeechActive(false);
    if (fetchAbortRef.current) {
      fetchAbortRef.current.abort();
      fetchAbortRef.current = null;
    }
    cleanupCaptureResources();
    cleanupPlaybackResources();
  }, [cleanupCaptureResources, cleanupPlaybackResources]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, sending, liveTools, liveMode, voicePhase]);

  useEffect(() => {
    if (!open && liveModeRef.current) {
      stopLiveMode();
    }
  }, [open, stopLiveMode]);

  useEffect(() => {
    return () => {
      stopLiveMode();
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        void audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, [stopLiveMode]);

  const ensureAudioContextUnlocked = useCallback((): AudioContext | null => {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioCtx();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
    try {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch {
      // ignore unlock failure
    }
    return ctx;
  }, []);

  const executeChatRequest = useCallback(
    async (trimmed: string, expectedToken?: number): Promise<string | null> => {
      const priorHistory = messagesRef.current
        .filter((m) => !m.isError)
        .map((m) => ({ role: m.role, text: m.text }));

      const userMsg: JarvisMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        text: trimmed,
      };
      setMessages((prev) => [...prev, userMsg]);
      setSending(true);
      setLiveTools([]);

      const controller = new AbortController();
      if (expectedToken !== undefined) {
        fetchAbortRef.current = controller;
      }

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
          signal: controller.signal,
        });

        let finalReply: string | null = null;
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
              onToolActivity?.({ type: 'tool_start', tool: toolName });
            } else if (eventName === 'tool_done' && payload.tool) {
              onToolActivity?.({ type: 'tool_done', tool: payload.tool });
            } else if (eventName === 'done') {
              finished = true;
              finalReply = payload.reply || 'Bajarildi, Janob.';
              onToolActivity?.({ type: 'done' });
              setMessages((prev) => [
                ...prev,
                {
                  id: `a-${Date.now()}`,
                  role: 'assistant',
                  text: finalReply || '',
                  tools: payload.executedTools,
                },
              ]);
            } else if (eventName === 'error') {
              finished = true;
              onToolActivity?.({ type: 'done' });
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
          return finalReply;
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
          return null;
        }

        const replyText = data.reply || 'Bajarildi, Janob.';
        finalReply = replyText;
        onToolActivity?.({ type: 'done' });
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: replyText,
            tools: data.executedTools,
          },
        ]);
        return replyText;
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          return null;
        }
        onToolActivity?.({ type: 'done' });
        setMessages((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            role: 'assistant',
            text: (err as Error).message || 'Tarmoq xatoligi',
            isError: true,
          },
        ]);
        return null;
      } finally {
        if (fetchAbortRef.current === controller) {
          fetchAbortRef.current = null;
        }
        setSending(false);
        setLiveTools([]);
      }
    },
    [onToolActivity],
  );

  const playWavAudio = useCallback(
    async (audioBase64: string, mimeType: string, token: number): Promise<void> => {
      if (sessionTokenRef.current !== token || !liveModeRef.current || !openRef.current) return;
      cleanupPlaybackResources();

      const ctx = audioCtxRef.current;
      if (ctx && ctx.state !== 'closed') {
        try {
          if (ctx.state === 'suspended') {
            await ctx.resume();
          }
          const decoded = await ctx.decodeAudioData(base64ToArrayBuffer(audioBase64));
          if (sessionTokenRef.current !== token || !liveModeRef.current || !openRef.current) return;
          await new Promise<void>((resolve) => {
            const source = ctx.createBufferSource();
            source.buffer = decoded;
            source.connect(ctx.destination);
            activeSourceRef.current = source;
            let settled = false;
            const safetyMs = Math.max(1500, Math.ceil((decoded.duration || 5) * 1000) + 1200);
            const timer = window.setTimeout(() => {
              if (!settled) {
                settled = true;
                if (activeSourceRef.current === source) {
                  activeSourceRef.current = null;
                }
                resolve();
              }
            }, safetyMs);
            source.onended = () => {
              if (!settled) {
                settled = true;
                window.clearTimeout(timer);
                if (activeSourceRef.current === source) {
                  activeSourceRef.current = null;
                }
                resolve();
              }
            };
            source.start(0);
          });
          return;
        } catch {
          // fallback to HTMLAudioElement below
        }
      }

      if (sessionTokenRef.current !== token || !liveModeRef.current || !openRef.current) return;
      await new Promise<void>((resolve) => {
        const audio = new Audio(`data:${mimeType || 'audio/wav'};base64,${audioBase64}`);
        activeAudioElRef.current = audio;
        const finish = () => {
          if (activeAudioElRef.current === audio) {
            activeAudioElRef.current = null;
          }
          resolve();
        };
        audio.onended = finish;
        audio.onerror = finish;
        void audio.play().catch(finish);
      });
    },
    [cleanupPlaybackResources],
  );

  const speakJarvisReply = useCallback(
    async (replyText: string, token: number) => {
      const cleanedSpeech = prepareTextForSpeech(replyText);
      if (!cleanedSpeech) return;
      if (sessionTokenRef.current !== token || !liveModeRef.current || !openRef.current) return;

      setVoicePhase('speaking');
      const controller = new AbortController();
      fetchAbortRef.current = controller;

      try {
        const res = await fetch('/api/jarvis/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: cleanedSpeech }),
          signal: controller.signal,
        });
        const data = (await res.json()) as {
          audioBase64?: string;
          mimeType?: string;
          error?: string;
        };
        if (sessionTokenRef.current !== token || !liveModeRef.current || !openRef.current) return;
        if (!res.ok || data.error || !data.audioBase64) {
          throw new Error(data.error || 'Ovoz sintezida xatolik yuz berdi.');
        }
        await playWavAudio(data.audioBase64, data.mimeType || 'audio/wav', token);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setMessages((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            role: 'assistant',
            text: (err as Error).message || 'J.A.R.V.I.S. javobini o‘qib bo‘lmadi.',
            isError: true,
          },
        ]);
      } finally {
        if (fetchAbortRef.current === controller) {
          fetchAbortRef.current = null;
        }
      }
    },
    [playWavAudio],
  );

  const startListeningTurn = useCallback(
    async (token: number) => {
      if (!liveModeRef.current || !openRef.current || sessionTokenRef.current !== token) return;
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
        stopLiveMode();
        return;
      }

      cleanupCaptureResources();
      setVoicePhase('listening');
      setSpeechActive(false);

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
        } catch (constraintErr) {
          const errName = (constraintErr as { name?: string })?.name || '';
          if (errName === 'OverconstrainedError' || errName === 'TypeError') {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          } else {
            throw constraintErr;
          }
        }

        if (!liveModeRef.current || !openRef.current || sessionTokenRef.current !== token) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        activeStreamRef.current = stream;
        stopReasonRef.current = 'manual';

        const preferredTypes = [
          'audio/webm;codecs=opus',
          'audio/webm',
          'audio/mp4',
        ];
        const mimeType =
          preferredTypes.find((type) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) ||
          '';
        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);

        chunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        const ctx = ensureAudioContextUnlocked();
        if (ctx) {
          try {
            if (ctx.state === 'suspended') {
              await ctx.resume().catch(() => {});
            }
            const source = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 1024;
            source.connect(analyser);
            sourceNodeRef.current = source;

            const floatSamples = new Float32Array(analyser.fftSize);
            let vadState = createInitialVadState(Date.now());

            vadIntervalRef.current = window.setInterval(() => {
              if (sessionTokenRef.current !== token || !liveModeRef.current) return;
              analyser.getFloatTimeDomainData(floatSamples);
              const rms = computeRmsLevel(floatSamples);
              const step = stepVadState(vadState, rms, Date.now(), DEFAULT_VAD_CONFIG);
              vadState = step.next;
              setSpeechActive(vadState.speechStarted);

              if (step.action === 'restart_idle' || step.action === 'finish_speech') {
                const isTooShort = step.action === 'finish_speech' && vadState.voicedMs < 240;
                stopReasonRef.current =
                  step.action === 'restart_idle' || isTooShort ? 'idle' : 'speech';
                if (vadIntervalRef.current !== null) {
                  window.clearInterval(vadIntervalRef.current);
                  vadIntervalRef.current = null;
                }
                if (recorder.state !== 'inactive') {
                  recorder.stop();
                }
              }
            }, 80);
          } catch {
            // If analyser setup fails on an uncommon browser, manual stop still works
          }
        }

        recorder.onstop = () => {
          if (vadIntervalRef.current !== null) {
            window.clearInterval(vadIntervalRef.current);
            vadIntervalRef.current = null;
          }
          if (sourceNodeRef.current) {
            try {
              sourceNodeRef.current.disconnect();
            } catch {
              // ignore
            }
            sourceNodeRef.current = null;
          }
          stream.getTracks().forEach((t) => t.stop());
          if (activeStreamRef.current === stream) {
            activeStreamRef.current = null;
          }
          if (mediaRecorderRef.current === recorder) {
            mediaRecorderRef.current = null;
          }
          setSpeechActive(false);

          if (!liveModeRef.current || !openRef.current || sessionTokenRef.current !== token) {
            return;
          }

          if (stopReasonRef.current === 'idle') {
            void startListeningRef.current(token);
            return;
          }

          const finalMimeType = recorder.mimeType || mimeType || 'audio/webm';
          const blob = new Blob(chunksRef.current, { type: finalMimeType });
          if (blob.size < 400) {
            void startListeningRef.current(token);
            return;
          }

          void (async () => {
            setVoicePhase('transcribing');
            const controller = new AbortController();
            fetchAbortRef.current = controller;

            try {
              const base64 = await blobToBase64(blob);
              if (!base64 || sessionTokenRef.current !== token || !liveModeRef.current) {
                if (sessionTokenRef.current === token && liveModeRef.current) {
                  void startListeningRef.current(token);
                }
                return;
              }

              const res = await fetch('/api/jarvis/transcribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audioBase64: base64, mimeType: finalMimeType }),
                signal: controller.signal,
              });
              const data = (await res.json()) as { text?: string; error?: string };
              if (fetchAbortRef.current === controller) {
                fetchAbortRef.current = null;
              }

              if (sessionTokenRef.current !== token || !liveModeRef.current || !openRef.current) {
                return;
              }

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
                stopLiveMode();
                return;
              }

              const transcript = String(data.text || '').trim();
              if (!transcript) {
                void startListeningRef.current(token);
                return;
              }

              setVoicePhase('thinking');
              const replyText = await executeChatRequest(transcript, token);
              if (sessionTokenRef.current !== token || !liveModeRef.current || !openRef.current) {
                return;
              }

              if (replyText) {
                await speakJarvisReply(replyText, token);
              } else {
                stopLiveMode();
                return;
              }

              if (sessionTokenRef.current === token && liveModeRef.current && openRef.current) {
                void startListeningRef.current(token);
              }
            } catch (err) {
              if (fetchAbortRef.current === controller) {
                fetchAbortRef.current = null;
              }
              if ((err as Error).name === 'AbortError') return;
              if (sessionTokenRef.current === token && liveModeRef.current) {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `e-${Date.now()}`,
                    role: 'assistant',
                    text: (err as Error).message || 'Ovozli muloqotda xatolik yuz berdi.',
                    isError: true,
                  },
                ]);
                stopLiveMode();
              }
            }
          })();
        };

        mediaRecorderRef.current = recorder;
        recorder.start(200);
      } catch (err) {
        if (sessionTokenRef.current !== token || !liveModeRef.current) return;
        const rawErr = (err as Error)?.message || '';
        const errName = (err as { name?: string })?.name || '';
        const isDenied =
          errName === 'NotAllowedError' ||
          errName === 'PermissionDeniedError' ||
          rawErr.toLowerCase().includes('permission');
        const isNotFound =
          errName === 'NotFoundError' ||
          errName === 'DevicesNotFoundError' ||
          rawErr.toLowerCase().includes('device not found');
        const friendlyError = isDenied
          ? 'Mikrofon ruxsati bloklangan (Permission denied). Sahifani yangilab qayta urinib ko‘ring yoki Chrome manzil satridagi ruxsatlar bo‘limidan Mikrofonni yoqing.'
          : isNotFound
            ? 'Mikrofon qurilmasi topilmadi. Qurilmangizda mikrofon ulanganligini tekshiring.'
            : rawErr || 'Mikrofonga ulanib bo‘lmadi.';
        setMessages((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            role: 'assistant',
            text: friendlyError,
            isError: true,
          },
        ]);
        stopLiveMode();
      }
    },
    [
      cleanupCaptureResources,
      ensureAudioContextUnlocked,
      executeChatRequest,
      speakJarvisReply,
      stopLiveMode,
    ],
  );

  startListeningRef.current = startListeningTurn;

  if (!open) return null;

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;
    if (liveModeRef.current) {
      stopLiveMode();
    }
    setInput('');
    await executeChatRequest(trimmed);
  };

  const toggleLiveVoiceMode = () => {
    if (liveModeRef.current) {
      stopLiveMode();
      return;
    }

    // Unlock mobile AudioContext synchronously inside user tap
    ensureAudioContextUnlocked();
    const nextToken = sessionTokenRef.current + 1;
    sessionTokenRef.current = nextToken;
    liveModeRef.current = true;
    setLiveMode(true);
    void startListeningTurn(nextToken);
  };

  const phaseLabel =
    voicePhase === 'listening'
      ? speechActive
        ? 'Eshitmoqdaman...'
        : 'Jonli muloqot · Tinglayapman'
      : voicePhase === 'transcribing'
        ? 'Jonli muloqot · Aniqlanmoqda...'
        : voicePhase === 'thinking'
          ? 'Jonli muloqot · Bajarilmoqda...'
          : voicePhase === 'speaking'
            ? 'Jonli muloqot · Gapirmoqda...'
            : '';

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
          {/* Top Bar: X Close Button & Live Voice Phase Indicator */}
          <div className="px-3.5 pt-3 pb-1 flex items-center justify-between gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                stopLiveMode();
                onClose();
              }}
              aria-label="Close J.A.R.V.I.S."
              className="p-0.5 text-white/90 hover:text-white transition-opacity hover:opacity-80 cursor-pointer"
            >
              <X className="w-4 h-4" strokeWidth={1.75} />
            </button>

            {liveMode && phaseLabel && (
              <div
                aria-live="polite"
                className="flex items-center gap-1.5 text-[10px] tracking-wider text-cyan-200/90 font-medium"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full bg-cyan-300 ${
                    speechActive || voicePhase === 'speaking' ? 'animate-ping' : 'animate-pulse'
                  }`}
                />
                <span>{phaseLabel}</span>
              </div>
            )}
          </div>

          {/* Chat Messages */}
          <div
            ref={listRef}
            className="flex-1 min-h-0 overflow-y-auto win10-scroll px-3.5 py-1 space-y-2"
          >
            {messages.length === 0 && liveMode && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-tl-md px-3 py-1.5 text-xs leading-relaxed backdrop-blur-xl bg-white/[0.08] border border-cyan-300/25 text-white/90">
                  Janob, jonli muloqot rejimi yoqildi. Buyrug‘ingizni ayting.
                </div>
              </div>
            )}

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
            onClick={toggleLiveVoiceMode}
            aria-pressed={liveMode}
            aria-label={liveMode ? 'Jonli ovozli muloqotni to‘xtatish' : 'Jonli ovozli muloqotni yoqish'}
            className={`absolute -bottom-6 left-1/2 -translate-x-1/2 w-12 h-12 rounded-full backdrop-blur-2xl border flex items-center justify-center transition-all duration-150 cursor-pointer ${
              liveMode
                ? `bg-cyan-400/25 border-cyan-200/75 shadow-[inset_2px_2px_4px_rgba(255,255,255,0.75),0_0_26px_rgba(34,211,238,0.65)] scale-105 ${
                    speechActive || voicePhase === 'speaking' ? 'animate-pulse' : ''
                  }`
                : 'bg-[linear-gradient(135deg,rgba(255,255,255,0.24)_0%,rgba(255,255,255,0.06)_55%,rgba(255,255,255,0.16)_100%)] border-white/45 shadow-[inset_2px_2px_4px_rgba(255,255,255,0.8),inset_-2px_-2px_4px_rgba(255,255,255,0.25),0_10px_24px_rgba(0,0,0,0.6)] hover:scale-105 active:scale-95'
            }`}
          >
            {!liveMode ? (
              <Mic className="w-5 h-5 text-white" strokeWidth={1.75} />
            ) : voicePhase === 'speaking' ? (
              <Volume2 className="w-5 h-5 text-cyan-100" strokeWidth={1.75} />
            ) : (
              <Square className="w-4 h-4 text-cyan-100" strokeWidth={1.75} />
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
