"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Link from "next/link";
import { MicOff, Pause, Play, Settings2 } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { getReminderAudio, REMINDER_AUDIO_STORAGE_KEY } from "@/lib/reminder-audio";
import { cn } from "@/lib/utils";

type Sample = { value: number; recordedAt: number; elapsedSeconds: number };
type MoodLevel = { label: string; hint: string; color: string; softColor: string };
type EmotionMessage = {
  type?: string;
  emotions?: string[];
  mode?: string;
  probs?: number[];
};

const DEFAULT_COLLAPSED_SAMPLE_LIMIT = 22;
const COLLAPSED_BAR_STEP = 12;
const AUTO_FOLLOW_RESUME_DISTANCE = 4;
const TARGET_SAMPLE_RATE = 16_000;
const MAX_WEBSOCKET_BUFFER = 512 * 1024;
const ALARM_TRIGGER_VALUE = 52;
const ALARM_REARM_VALUE = 46;
const FASTAPI_HOST = process.env.NEXT_PUBLIC_FASTAPI_HOST?.trim() || "127.0.0.1";
const FASTAPI_PORT = process.env.NEXT_PUBLIC_FASTAPI_PORT?.trim() || "8000";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getEmotionWebSocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${FASTAPI_HOST}:${FASTAPI_PORT}/ws`;
}

function getNegativeEmotionValue(probs: number[], emotions: string[]) {
  const normalizedEmotions = emotions.map((emotion) => emotion.toLowerCase());
  const angryIndex = normalizedEmotions.indexOf("angry");
  const disgustedIndex = normalizedEmotions.indexOf("disgusted");
  if (angryIndex < 0 || disgustedIndex < 0) return null;

  const angry = clamp(Number(probs[angryIndex]) || 0, 0, 1);
  const disgusted = clamp(Number(probs[disgustedIndex]) || 0, 0, 1);
  const strongerEmotion = Math.max(angry, disgusted);
  const weakerEmotion = Math.min(angry, disgusted);
  return Math.round((strongerEmotion * 0.9 + weakerEmotion * 0.1) * 100);
}

function resampleToPcm16(input: Float32Array, sourceSampleRate: number) {
  const outputLength = Math.max(
    1,
    Math.round(input.length * TARGET_SAMPLE_RATE / sourceSampleRate),
  );
  const output = new Int16Array(outputLength);
  const sampleRateRatio = sourceSampleRate / TARGET_SAMPLE_RATE;

  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * sampleRateRatio;
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = Math.min(leftIndex + 1, input.length - 1);
    const interpolation = sourcePosition - leftIndex;
    const sample = input[leftIndex] * (1 - interpolation) + input[rightIndex] * interpolation;
    output[index] = Math.round(clamp(sample, -1, 1) * 32767);
  }

  return output;
}

function getMoodLevel(value: number): MoodLevel {
  if (value >= 72) {
    return {
      label: "强烈",
      hint: "先停一下，慢慢呼吸",
      color: "#ff5147",
      softColor: "rgba(255, 81, 71, 0.14)",
    };
  }
  if (value >= 45) {
    return {
      label: "升高",
      hint: "注意到了，缓一缓",
      color: "#ff8a3d",
      softColor: "rgba(255, 138, 61, 0.15)",
    };
  }
  return {
    label: "平稳",
    hint: "保持现在的节奏",
    color: "#4d8df7",
    softColor: "rgba(77, 141, 247, 0.14)",
  };
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatClock(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function formatTimeline(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const minuteAndSecond = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${String(hours).padStart(2, "0")}:${minuteAndSecond}` : minuteAndSecond;
}

function EmotionChart({
  samples,
  selectedIndex,
  expanded,
  onSelect,
}: {
  samples: Sample[];
  selectedIndex: number | null;
  expanded: boolean;
  onSelect: (index: number | null) => void;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const isFollowingLatestRef = useRef(true);
  const isSelectionLockedRef = useRef(false);
  const isUserInteractingRef = useRef(false);
  const touchDragRef = useRef(false);
  const wheelIdleTimerRef = useRef<number | null>(null);
  const autoFollowFrameRef = useRef<number | null>(null);
  const horizontalDragRef = useRef<{
    pointerId: number;
    startX: number;
    scrollLeft: number;
    moved: boolean;
    selectedBar: HTMLButtonElement | null;
    selectedIndex: number | null;
  } | null>(null);
  const ignoreClickRef = useRef(false);
  const [collapsedSampleLimit, setCollapsedSampleLimit] = useState(DEFAULT_COLLAPSED_SAMPLE_LIMIT);
  const latestSampleAt = samples.at(-1)?.recordedAt ?? 0;
  const cancelPendingAutoFollow = (chart?: HTMLDivElement) => {
    if (autoFollowFrameRef.current !== null) {
      cancelAnimationFrame(autoFollowFrameRef.current);
      autoFollowFrameRef.current = null;
    }
    if (wheelIdleTimerRef.current !== null) {
      clearTimeout(wheelIdleTimerRef.current);
      wheelIdleTimerRef.current = null;
    }
    if (chart) {
      chart.scrollTo({ left: chart.scrollLeft, behavior: "auto" });
    }
  };
  const resumeFollowingIfAtEnd = (chart: HTMLDivElement, releaseSelection = false) => {
    if (isUserInteractingRef.current) return;
    const distanceFromEnd = chart.scrollWidth - chart.clientWidth - chart.scrollLeft;
    if (
      distanceFromEnd <= AUTO_FOLLOW_RESUME_DISTANCE &&
      (!isSelectionLockedRef.current || releaseSelection)
    ) {
      isSelectionLockedRef.current = false;
      isFollowingLatestRef.current = true;
      if (releaseSelection) onSelect(null);
    }
  };
  const selectSample = (index: number, selectedBar: HTMLButtonElement) => {
    const chart = chartRef.current;
    cancelPendingAutoFollow(chart ?? undefined);
    isSelectionLockedRef.current = true;
    isFollowingLatestRef.current = false;
    onSelect(index);

    if (!chart) return;
    const selectedCenter = selectedBar.offsetLeft + selectedBar.offsetWidth / 2;
    chart.scrollTo({
      left: selectedCenter - chart.clientWidth / 2,
      behavior: "smooth",
    });
  };

  useEffect(() => {
    if (samples.length > 0) return;
    isSelectionLockedRef.current = false;
    isFollowingLatestRef.current = true;
  }, [samples.length]);

  useEffect(() => {
    return () => {
      if (wheelIdleTimerRef.current !== null) {
        clearTimeout(wheelIdleTimerRef.current);
      }
      if (autoFollowFrameRef.current !== null) {
        cancelAnimationFrame(autoFollowFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!expanded || !chartRef.current || !isFollowingLatestRef.current) return;
    const frame = requestAnimationFrame(() => {
      autoFollowFrameRef.current = null;
      const chart = chartRef.current;
      if (
        !chart ||
        !isFollowingLatestRef.current ||
        isSelectionLockedRef.current ||
        isUserInteractingRef.current
      ) {
        return;
      }
      chart.scrollTo({
        left: chart.scrollWidth,
        behavior: samples.length > 24 ? "smooth" : "auto",
      });
    });
    autoFollowFrameRef.current = frame;
    return () => {
      cancelAnimationFrame(frame);
      if (autoFollowFrameRef.current === frame) {
        autoFollowFrameRef.current = null;
      }
    };
  }, [expanded, latestSampleAt, samples.length]);

  useEffect(() => {
    if (expanded || !chartRef.current) return;
    const chart = chartRef.current;
    const updateVisibleSampleLimit = () => {
      const nextLimit = Math.max(1, Math.floor(chart.clientWidth / COLLAPSED_BAR_STEP));
      setCollapsedSampleLimit((current) => current === nextLimit ? current : nextLimit);
    };

    updateVisibleSampleLimit();
    const resizeObserver = new ResizeObserver(updateVisibleSampleLimit);
    resizeObserver.observe(chart);
    return () => resizeObserver.disconnect();
  }, [expanded]);

  if (!expanded) {
    const isOverflowing = samples.length > collapsedSampleLimit;
    const recentSamples = samples.slice(-collapsedSampleLimit);
    const streamKey = recentSamples.at(-1)?.recordedAt ?? "empty";

    return (
      <div ref={chartRef} className="relative h-14 w-full overflow-hidden px-1" aria-label="最近情绪值">
        <div
          key={isOverflowing ? streamKey : "growing"}
          className={cn(
            "flex h-full w-full items-end justify-start gap-1.5",
            isOverflowing && "animate-[emotion-stream_500ms_linear]",
          )}
        >
          {recentSamples.map((sample) => (
            <span
              key={sample.recordedAt}
              className="w-1.5 shrink-0 rounded-full opacity-80"
              style={{
                height: `${Math.max(sample.value, 8)}%`,
                backgroundColor: getMoodLevel(sample.value).color,
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={chartRef}
      className="relative h-56 w-full touch-pan-x cursor-grab select-none overflow-x-auto overflow-y-hidden active:cursor-grabbing [mask-image:linear-gradient(to_right,transparent_0,black_24px,black_calc(100%-24px),transparent_100%)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label="情绪值历史图表"
      onPointerDown={(event) => {
        if (event.pointerType !== "mouse" || event.button !== 0) return;
        cancelPendingAutoFollow(event.currentTarget);
        isUserInteractingRef.current = true;
        isFollowingLatestRef.current = false;
        const eventTarget = event.target;
        const selectedBar = eventTarget instanceof Element
          ? eventTarget.closest<HTMLButtonElement>("button[data-sample-index]")
          : null;
        horizontalDragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          scrollLeft: event.currentTarget.scrollLeft,
          moved: false,
          selectedBar,
          selectedIndex: selectedBar ? Number(selectedBar.dataset.sampleIndex) : null,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = horizontalDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const delta = event.clientX - drag.startX;
        if (Math.abs(delta) > 3) drag.moved = true;
        if (!drag.moved) return;
        event.currentTarget.scrollLeft = drag.scrollLeft - delta;
        isFollowingLatestRef.current = false;
      }}
      onPointerUp={(event) => {
        const drag = horizontalDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        ignoreClickRef.current = true;
        horizontalDragRef.current = null;
        isUserInteractingRef.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (drag.moved) {
          resumeFollowingIfAtEnd(event.currentTarget, true);
        } else if (drag.selectedBar && drag.selectedIndex !== null) {
          selectSample(drag.selectedIndex, drag.selectedBar);
        }
        window.setTimeout(() => {
          ignoreClickRef.current = false;
        }, 0);
      }}
      onPointerCancel={(event) => {
        horizontalDragRef.current = null;
        ignoreClickRef.current = false;
        isUserInteractingRef.current = false;
        resumeFollowingIfAtEnd(event.currentTarget, true);
      }}
      onTouchStart={(event) => {
        cancelPendingAutoFollow(event.currentTarget);
        touchDragRef.current = false;
        isUserInteractingRef.current = true;
        isFollowingLatestRef.current = false;
      }}
      onTouchMove={() => {
        touchDragRef.current = true;
      }}
      onTouchEnd={(event) => {
        isUserInteractingRef.current = false;
        resumeFollowingIfAtEnd(event.currentTarget, touchDragRef.current);
        touchDragRef.current = false;
      }}
      onTouchCancel={(event) => {
        touchDragRef.current = false;
        isUserInteractingRef.current = false;
        resumeFollowingIfAtEnd(event.currentTarget, true);
      }}
      onWheel={(event) => {
        if (Math.abs(event.deltaX) > 0 || event.shiftKey) {
          cancelPendingAutoFollow(event.currentTarget);
          isUserInteractingRef.current = true;
          isFollowingLatestRef.current = false;
          const chart = event.currentTarget;
          if (wheelIdleTimerRef.current !== null) {
            clearTimeout(wheelIdleTimerRef.current);
          }
          wheelIdleTimerRef.current = window.setTimeout(() => {
            isUserInteractingRef.current = false;
            resumeFollowingIfAtEnd(chart, true);
            wheelIdleTimerRef.current = null;
          }, 120);
        }
      }}
      onScroll={(event) => {
        resumeFollowingIfAtEnd(event.currentTarget);
      }}
    >
      <div className="flex h-full w-max min-w-full flex-col pl-1 pr-14">
        <div className="flex min-h-0 flex-1 items-end gap-1.5">
          {samples.length === 0 ? (
            Array.from({ length: 16 }, (_, index) => (
              <span
                key={index}
                className="w-2 shrink-0 rounded-full bg-neutral-200/70"
                style={{ height: `${18 + ((index * 13) % 28)}%` }}
              />
            ))
          ) : samples.map((sample, index) => {
            const mood = getMoodLevel(sample.value);
            const isSelected = index === selectedIndex;

            return (
              <button
                key={sample.recordedAt}
                type="button"
                data-sample-index={index}
                className="group relative flex h-full w-2 shrink-0 animate-[emotion-bar-in_360ms_cubic-bezier(.22,1,.36,1)_both] items-end justify-center focus-visible:outline-none"
                aria-label={`${formatClock(sample.recordedAt)}，情绪值 ${sample.value}`}
                onClick={(event) => {
                  if (ignoreClickRef.current) return;
                  selectSample(index, event.currentTarget);
                }}
              >
                {isSelected && (
                  <span
                    className="absolute z-10 size-2.5 -translate-y-2 rounded-full bg-neutral-950 shadow-[0_0_0_4px_rgba(255,255,255,0.9)]"
                    style={{ bottom: `${Math.max(sample.value, 5)}%` }}
                  />
                )}
                <span
                  className={cn(
                    "w-full rounded-full transition-[height,opacity] duration-300",
                    isSelected ? "opacity-100" : "opacity-75 group-hover:opacity-100",
                  )}
                  style={{
                    height: `${Math.max(sample.value, 5)}%`,
                    backgroundColor: mood.color,
                  }}
                />
              </button>
            );
          })}
        </div>

        <div className="relative mt-3 flex h-8 shrink-0 items-start gap-1.5 text-neutral-300" aria-hidden="true">
          <div className="absolute inset-x-0 top-2 h-px bg-current" />
          {Array.from({ length: samples.length || 16 }, (_, index) => {
            const sample = samples[index];
            const previousSample = samples[index - 1];
            const currentFiveSecondMark = sample
              ? Math.floor(sample.elapsedSeconds / 5) * 5
              : 0;
            const previousFiveSecondMark = previousSample
              ? Math.floor(previousSample.elapsedSeconds / 5) * 5
              : -1;
            const isLabeledTick = index === 0 || Boolean(
              sample && previousSample && currentFiveSecondMark > previousFiveSecondMark,
            );
            const currentWholeSecond = sample ? Math.floor(sample.elapsedSeconds) : index / 2;
            const previousWholeSecond = previousSample
              ? Math.floor(previousSample.elapsedSeconds)
              : -1;
            const isWholeSecondTick = samples.length === 0
              ? index % 2 === 0
              : index === 0 || currentWholeSecond > previousWholeSecond;

            return (
              <span key={sample?.recordedAt ?? index} className="relative grid w-2 shrink-0 place-items-center">
                <span
                  className={cn(
                    "relative w-px bg-current",
                    isLabeledTick ? "h-3" : isWholeSecondTick ? "h-2" : "h-1",
                  )}
                />
                {isLabeledTick && (
                  <span
                    className={cn(
                      "absolute top-4 whitespace-nowrap text-[10px] font-medium tabular-nums text-current",
                      index === 0 ? "left-3" : "left-1/2 -translate-x-1/2",
                    )}
                  >
                    {formatTimeline(index === 0 ? 0 : currentFiveSecondMark)}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function EmotionMonitor() {
  const [emotionValue, setEmotionValue] = useState(0);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedSecondsRef = useRef(0);
  const dragStartYRef = useRef<number | null>(null);
  const isPausedRef = useRef(false);
  const canSendAudioRef = useRef(false);
  const emotionLabelsRef = useRef<string[]>([]);
  const reminderAudioRef = useRef<HTMLAudioElement | null>(null);
  const highEmotionRef = useRef(false);
  const lastReminderAtRef = useRef(0);

  const mood = getMoodLevel(emotionValue);
  const selectedSample = useMemo(() => {
    if (samples.length === 0) return null;
    return samples[selectedIndex ?? samples.length - 1] ?? samples[samples.length - 1];
  }, [samples, selectedIndex]);

  const stopListening = useCallback(() => {
    if (elapsedTimerRef.current !== null) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    canSendAudioRef.current = false;
    emotionLabelsRef.current = [];
    const websocket = websocketRef.current;
    websocketRef.current = null;
    if (websocket) {
      websocket.onopen = null;
      websocket.onmessage = null;
      websocket.onerror = null;
      websocket.onclose = null;
      if (websocket.readyState === WebSocket.OPEN || websocket.readyState === WebSocket.CONNECTING) {
        websocket.close();
      }
    }
    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    mediaSourceRef.current?.disconnect();
    mediaSourceRef.current = null;
    silentGainRef.current?.disconnect();
    silentGainRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    reminderAudioRef.current?.pause();
    if (reminderAudioRef.current) reminderAudioRef.current.currentTime = 0;
    reminderAudioRef.current = null;
    highEmotionRef.current = false;
    isPausedRef.current = false;
    setIsPaused(false);
    setIsListening(false);
  }, []);

  useEffect(() => stopListening, [stopListening]);

  const applyEmotionResult = useCallback((probs: number[]) => {
    if (isPausedRef.current) return;
    const nextValue = getNegativeEmotionValue(probs, emotionLabelsRef.current);
    if (nextValue === null) return;

    if (nextValue >= ALARM_TRIGGER_VALUE) {
      const now = Date.now();
      if (!highEmotionRef.current && now - lastReminderAtRef.current >= 10_000) {
        const reminderAudio = reminderAudioRef.current;
        if (reminderAudio) {
          reminderAudio.currentTime = 0;
          void reminderAudio.play().catch(() => undefined);
        }
        lastReminderAtRef.current = now;
      }
      highEmotionRef.current = true;
    } else if (nextValue < ALARM_REARM_VALUE) {
      highEmotionRef.current = false;
    }

    const recordedAt = Date.now();
    setEmotionValue(nextValue);
    setSamples((current) => [
      ...current,
      { value: nextValue, recordedAt, elapsedSeconds: elapsedSecondsRef.current },
    ]);
  }, []);

  const startListening = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前浏览器不支持麦克风检测，请使用较新版本的浏览器。");
      return;
    }

    setIsStarting(true);
    setError(null);

    try {
      let savedReminderId: string | null = null;
      try {
        savedReminderId = window.localStorage.getItem(REMINDER_AUDIO_STORAGE_KEY);
      } catch {
        // Storage can be unavailable in restrictive browser modes; use the default.
      }
      const reminder = getReminderAudio(savedReminderId);
      const reminderAudio = new Audio(reminder.src);
      reminderAudio.preload = "auto";
      reminderAudio.volume = 0;
      reminderAudioRef.current = reminderAudio;
      void reminderAudio.play().then(() => {
        reminderAudio.pause();
        reminderAudio.currentTime = 0;
        reminderAudio.volume = 1;
      }).catch(() => {
        reminderAudio.volume = 1;
      });

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
        },
      });
      streamRef.current = stream;
      const audioContext = new window.AudioContext();
      await audioContext.resume();
      audioContextRef.current = audioContext;
      highEmotionRef.current = false;
      lastReminderAtRef.current = 0;
      setEmotionValue(0);
      setSamples([]);
      setSelectedIndex(null);
      setElapsedSeconds(0);
      elapsedSecondsRef.current = 0;
      isPausedRef.current = false;
      setIsPaused(false);

      const websocket = await new Promise<WebSocket>((resolve, reject) => {
        const socket = new WebSocket(getEmotionWebSocketUrl());
        websocketRef.current = socket;
        let settled = false;
        const connectionTimeout = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          socket.close();
          reject(new Error("emotion-service-timeout"));
        }, 10_000);

        const failConnection = () => {
          canSendAudioRef.current = false;
          if (!settled) {
            settled = true;
            window.clearTimeout(connectionTimeout);
            reject(new Error("emotion-service-unavailable"));
            return;
          }
          if (websocketRef.current !== socket) return;
          stopListening();
          setError("情绪识别服务连接已断开，请检查服务后重试。");
        };

        socket.binaryType = "arraybuffer";
        socket.onerror = () => {
          if (!settled) failConnection();
        };
        socket.onclose = failConnection;
        socket.onmessage = (event) => {
          if (typeof event.data !== "string") return;

          let message: EmotionMessage;
          try {
            message = JSON.parse(event.data) as EmotionMessage;
          } catch {
            return;
          }

          if (message.type === "ready" && Array.isArray(message.emotions)) {
            emotionLabelsRef.current = message.emotions;
            socket.send(JSON.stringify({ type: "mode", mode: "sliding" }));
            return;
          }

          if (message.type === "ack" && message.mode === "sliding") {
            canSendAudioRef.current = true;
            socket.send(JSON.stringify({
              type: "config",
              window_s: 2,
              hop_s: 0.5,
              smoothing: 0.7,
              threshold: 0,
            }));
            if (!settled) {
              settled = true;
              window.clearTimeout(connectionTimeout);
              resolve(socket);
            }
            return;
          }

          if (message.type === "result" && Array.isArray(message.probs)) {
            applyEmotionResult(message.probs);
          }
        };
      });

      const mediaSource = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      mediaSource.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);
      mediaSourceRef.current = mediaSource;
      processorRef.current = processor;
      silentGainRef.current = silentGain;
      processor.onaudioprocess = (event) => {
        if (
          isPausedRef.current ||
          !canSendAudioRef.current ||
          websocket.readyState !== WebSocket.OPEN ||
          websocket.bufferedAmount > MAX_WEBSOCKET_BUFFER
        ) {
          return;
        }

        const input = event.inputBuffer.getChannelData(0);
        const pcm = resampleToPcm16(input, audioContext.sampleRate);
        websocket.send(pcm.buffer);
      };

      setIsListening(true);

      elapsedTimerRef.current = setInterval(() => {
        elapsedSecondsRef.current += 1;
        setElapsedSeconds(elapsedSecondsRef.current);
      }, 1000);
    } catch (cause) {
      const permissionDenied =
        cause instanceof DOMException &&
        (cause.name === "NotAllowedError" || cause.name === "PermissionDeniedError");
      const serviceUnavailable =
        cause instanceof Error && cause.message.startsWith("emotion-service-");
      setError(
        permissionDenied
          ? "没有获得麦克风权限。请在浏览器设置中允许后重试。"
          : serviceUnavailable
            ? "无法连接情绪识别服务，请确认 FastAPI 服务可用后重试。"
          : "暂时无法使用麦克风，请检查设备后重试。",
      );
      stopListening();
    } finally {
      setIsStarting(false);
    }
  };

  const togglePause = async () => {
    const audioContext = audioContextRef.current;
    if (!audioContext) return;

    if (isPausedRef.current) {
      await audioContext.resume();
      isPausedRef.current = false;
      setIsPaused(false);
      elapsedTimerRef.current = setInterval(() => {
        elapsedSecondsRef.current += 1;
        setElapsedSeconds(elapsedSecondsRef.current);
      }, 1000);
      return;
    }

    isPausedRef.current = true;
    setIsPaused(true);
    if (websocketRef.current?.readyState === WebSocket.OPEN) {
      websocketRef.current.send(JSON.stringify({ type: "reset" }));
    }
    await audioContext.suspend();
    reminderAudioRef.current?.pause();
    if (elapsedTimerRef.current !== null) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  };

  const handleSheetPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragStartYRef.current = event.clientY;
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleSheetPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartYRef.current === null) return;
    const delta = event.clientY - dragStartYRef.current;
    setDragOffset(expanded ? clamp(delta, 0, 240) : clamp(delta, -240, 0));
  };

  const handleSheetPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartYRef.current === null) return;
    const delta = event.clientY - dragStartYRef.current;
    if (Math.abs(delta) < 8) setExpanded((current) => !current);
    else if (delta < -48) setExpanded(true);
    else if (delta > 48) setExpanded(false);
    dragStartYRef.current = null;
    setDragOffset(0);
    setIsDragging(false);
  };

  const sheetTransform = expanded
    ? `translate3d(0, ${dragOffset}px, 0)`
    : `translate3d(0, calc(100% - 112px + ${dragOffset}px), 0)`;

  return (
    <main className="relative mx-auto min-h-[100dvh] w-full max-w-[480px] overflow-hidden bg-[#f7f7f5] text-neutral-950 shadow-[0_0_80px_rgba(0,0,0,0.08)]">
      <header className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-6 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <div>
          <p className="text-[17px] font-semibold tracking-[-0.025em]">缓一缓</p>
          <p className="mt-0.5 text-[11px] font-medium tracking-[0.08em] text-neutral-400">HUAN YI HUAN</p>
        </div>
        <Link
          href="/settings"
          className={buttonVariants({
            variant: "outline",
            size: "sm",
            className: "rounded-full bg-white/75 px-3 text-neutral-500 shadow-sm backdrop-blur-xl",
          })}
        >
          <Settings2 data-icon="inline-start" />
          设置
        </Link>
      </header>

      <section
        className={cn(
          "absolute inset-x-0 z-10 flex flex-col items-center transition-[top,transform] duration-700 ease-[cubic-bezier(.22,1,.36,1)]",
          expanded ? "top-[5.75rem]" : "top-[45%] -translate-y-1/2",
        )}
        aria-live="polite"
      >
        <div
          className={cn(
            "relative grid place-items-center rounded-full transition-[width,height,border-color,box-shadow] duration-700 ease-[cubic-bezier(.22,1,.36,1)]",
            expanded ? "size-20" : "size-[min(67vw,31vh,19rem)] border-2",
          )}
          style={{
            borderColor: expanded ? "transparent" : mood.color,
            boxShadow: expanded ? "none" : `0 0 0 12px ${mood.softColor}, 0 28px 70px ${mood.softColor}`,
          }}
        >
          <div className="text-center">
            <div
              className={cn(
                "font-semibold tabular-nums tracking-[-0.075em] transition-[font-size,color] duration-700 ease-[cubic-bezier(.22,1,.36,1)]",
                expanded ? "text-5xl" : "text-7xl sm:text-8xl",
              )}
              style={{ color: mood.color }}
            >
              {emotionValue}
            </div>
            <p
              className={cn(
                "mt-2 font-medium tracking-wide text-neutral-400 transition-all duration-500",
                expanded ? "h-0 translate-y-2 overflow-hidden text-[0px] opacity-0" : "text-xs opacity-100",
              )}
            >
              情绪值 · {mood.label}
            </p>
          </div>
        </div>

        {isListening && (
          <p className={cn("absolute top-[calc(100%+2rem)] text-sm text-neutral-500 transition-all duration-500", expanded ? "-translate-y-3 opacity-0" : "opacity-100")}>
            {isPaused ? "记录已暂停" : mood.hint}
          </p>
        )}
      </section>

      {!expanded && (
        <div className="absolute inset-x-0 bottom-[calc(112px+1.25rem+env(safe-area-inset-bottom))] z-10 flex flex-col items-center">
          {isListening ? (
            <div className="flex items-center justify-center gap-3">
              <Button
                variant="outline"
                size="icon-lg"
                className="size-12 animate-[control-peel-left_500ms_cubic-bezier(.22,1,.36,1)_both] rounded-full bg-white shadow-[0_10px_26px_rgba(0,0,0,0.09)]"
                aria-label={isPaused ? "继续记录" : "暂停记录"}
                title={isPaused ? "继续记录" : "暂停记录"}
                onClick={togglePause}
              >
                {isPaused ? <Play className="fill-current" /> : <Pause className="fill-current" />}
              </Button>
              <Button
                size="lg"
                className="h-12 w-36 animate-[control-peel-right_500ms_cubic-bezier(.22,1,.36,1)_both] rounded-full px-6 shadow-[0_12px_30px_rgba(0,0,0,0.12)]"
                onClick={stopListening}
              >
                结束记录
              </Button>
            </div>
          ) : error ? (
            <div className="max-w-72 rounded-2xl bg-white/90 p-4 text-center shadow-sm ring-1 ring-black/[0.04] backdrop-blur-xl">
              <MicOff className="mx-auto mb-2 size-4 text-neutral-400" />
              <p className="text-xs leading-5 text-neutral-500">{error}</p>
              <Button variant="ghost" size="sm" className="mt-2" onClick={startListening}>再试一次</Button>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <p className="mb-3 text-sm font-medium tracking-tight text-neutral-500">或许我可以帮帮你</p>
              <Button size="lg" className="h-12 w-40 animate-[control-merge_400ms_cubic-bezier(.22,1,.36,1)_both] rounded-full px-6 shadow-[0_12px_30px_rgba(0,0,0,0.12)]" disabled={isStarting} onClick={startListening}>
                {isStarting ? "正在连接…" : "开始记录"}
              </Button>
            </div>
          )}
        </div>
      )}

      <section
        className={cn(
          "absolute inset-x-0 top-[10.75rem] z-20 flex min-h-[calc(100dvh-10.75rem)] flex-col overflow-y-auto overscroll-contain rounded-t-[2.25rem] bg-white/94 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-18px_60px_rgba(0,0,0,0.08)] backdrop-blur-2xl",
          !isDragging && "transition-transform duration-700 ease-[cubic-bezier(.22,1,.36,1)]",
        )}
        style={{ transform: sheetTransform }}
      >
        <div
          className="touch-none select-none rounded-t-[2.25rem] pt-3 focus-visible:outline-none"
          role="button"
          tabIndex={0}
          aria-label={expanded ? "收起情绪记录" : "展开情绪记录"}
          aria-expanded={expanded}
          onPointerDown={handleSheetPointerDown}
          onPointerMove={handleSheetPointerMove}
          onPointerUp={handleSheetPointerUp}
          onPointerCancel={() => {
            dragStartYRef.current = null;
            setDragOffset(0);
            setIsDragging(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setExpanded((current) => !current);
            }
          }}
        >
          <div className="mx-auto h-1.5 w-11 rounded-full bg-neutral-200" />
          {expanded ? (
            <div className="mt-4 flex items-end justify-between gap-5">
              <p className="text-xl font-semibold tracking-tight">刚才，到现在</p>
              <p className="text-xl font-medium tabular-nums">{formatDuration(elapsedSeconds)}</p>
            </div>
          ) : (
            <div className="relative mt-2 h-16">
              <div
                className={cn(
                  "absolute inset-y-0 left-3 right-26 flex -translate-y-[5px] items-center transition-[opacity,transform] duration-500 ease-out",
                  samples.length > 0 ? "translate-x-0 opacity-100" : "-translate-x-3 opacity-0",
                )}
              >
                <EmotionChart
                  samples={samples}
                  selectedIndex={null}
                  expanded={false}
                  onSelect={setSelectedIndex}
                />
              </div>
              <p
                className={cn(
                  "absolute top-[calc(50%+5px)] w-24 -translate-y-1/2 text-center text-[1.95rem] font-[650] tabular-nums tracking-[-0.03em] transition-[left,transform] duration-700 ease-[cubic-bezier(.22,1,.36,1)]",
                  samples.length > 0 ? "left-[calc(100%-8px)] -translate-x-full" : "left-1/2 -translate-x-1/2",
                )}
              >
                {formatDuration(elapsedSeconds)}
              </p>
            </div>
          )}
        </div>

        {expanded && (
          <div className="mt-8">
            <EmotionChart
              samples={samples}
              selectedIndex={selectedIndex ?? Math.max(samples.length - 1, 0)}
              expanded
              onSelect={setSelectedIndex}
            />
          </div>
        )}

        <div className={cn("grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-500", expanded ? "mt-8 grid-rows-[1fr] translate-y-0 opacity-100" : "grid-rows-[0fr] translate-y-5 opacity-0")}>
          <div className="min-h-0 text-center">
            <p className="text-xs font-medium tracking-[0.08em] text-neutral-400">{selectedIndex === null ? "当前" : "所选时刻"}</p>
            <div className="mt-3 flex items-baseline justify-center gap-2">
              <span className="text-4xl font-semibold tabular-nums tracking-[-0.06em]">{selectedSample?.value ?? 0}</span>
              <span className="text-sm text-neutral-400">情绪值</span>
            </div>
            <p className="mt-2 text-sm tabular-nums text-neutral-400">{selectedSample ? formatClock(selectedSample.recordedAt) : "等待第一条记录"}</p>
            <div className="mx-auto mt-8 h-px w-12 bg-neutral-200" />
            <p className="mt-8 text-lg font-medium tracking-tight">此刻发生了什么？</p>
            <p className="mx-auto mt-2 max-w-64 text-sm leading-6 text-neutral-400">不急着回答。先看见它，然后缓一缓。</p>
          </div>
        </div>
      </section>
    </main>
  );
}
