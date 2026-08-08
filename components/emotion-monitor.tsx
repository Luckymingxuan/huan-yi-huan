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

type Sample = { value: number; recordedAt: number };
type MoodLevel = { label: string; hint: string; color: string; softColor: string };

const MAX_SAMPLES = 90;
const DEFAULT_COLLAPSED_SAMPLE_LIMIT = 22;
const COLLAPSED_BAR_STEP = 12;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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
  const [collapsedSampleLimit, setCollapsedSampleLimit] = useState(DEFAULT_COLLAPSED_SAMPLE_LIMIT);

  useEffect(() => {
    if (!expanded || !chartRef.current || !isFollowingLatestRef.current) return;
    const frame = requestAnimationFrame(() => {
      const chart = chartRef.current;
      if (!chart) return;
      chart.scrollTo({
        left: chart.scrollWidth,
        behavior: samples.length > 24 ? "smooth" : "auto",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [expanded, samples.length]);

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
      className="relative h-52 w-full touch-pan-x overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label="情绪值历史图表"
      onScroll={(event) => {
        const chart = event.currentTarget;
        const distanceFromEnd = chart.scrollWidth - chart.clientWidth - chart.scrollLeft;
        isFollowingLatestRef.current = distanceFromEnd < 24;
      }}
    >
      <div className="flex h-full w-max min-w-full items-end gap-1.5 px-1">
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
              key={`${sample.recordedAt}-${index}`}
              type="button"
              className="group relative flex h-full w-2 shrink-0 items-end justify-center focus-visible:outline-none"
              aria-label={`${formatClock(sample.recordedAt)}，情绪值 ${sample.value}`}
              onClick={() => {
                isFollowingLatestRef.current = index === samples.length - 1;
                onSelect(index);
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
  const animationFrameRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastVisualUpdateRef = useRef(0);
  const lastSampleRef = useRef(0);
  const dragStartYRef = useRef<number | null>(null);
  const isPausedRef = useRef(false);
  const reminderAudioRef = useRef<HTMLAudioElement | null>(null);
  const highEmotionRef = useRef(false);
  const lastReminderAtRef = useRef(0);

  const mood = getMoodLevel(emotionValue);
  const selectedSample = useMemo(() => {
    if (samples.length === 0) return null;
    return samples[selectedIndex ?? samples.length - 1] ?? samples[samples.length - 1];
  }, [samples, selectedIndex]);

  const stopListening = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (elapsedTimerRef.current !== null) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
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

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.72;
      audioContext.createMediaStreamSource(stream).connect(analyser);

      const waveform = new Float32Array(analyser.fftSize);
      audioContextRef.current = audioContext;
      lastVisualUpdateRef.current = 0;
      lastSampleRef.current = 0;
      highEmotionRef.current = false;
      lastReminderAtRef.current = 0;
      setSamples([]);
      setSelectedIndex(null);
      setElapsedSeconds(0);
      isPausedRef.current = false;
      setIsPaused(false);
      setIsListening(true);

      elapsedTimerRef.current = setInterval(() => {
        setElapsedSeconds((seconds) => seconds + 1);
      }, 1000);

      const readLevel = (timestamp: number) => {
        if (isPausedRef.current) {
          animationFrameRef.current = requestAnimationFrame(readLevel);
          return;
        }

        analyser.getFloatTimeDomainData(waveform);
        let squareSum = 0;
        for (const point of waveform) squareSum += point * point;

        const rms = Math.sqrt(squareSum / waveform.length);
        const dbfs = rms > 0 ? 20 * Math.log10(rms) : -60;
        const nextValue = clamp(Math.round(((dbfs + 60) / 60) * 100), 0, 100);

        if (nextValue >= 72) {
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
        } else if (nextValue < 64) {
          highEmotionRef.current = false;
        }

        if (timestamp - lastVisualUpdateRef.current >= 120) {
          setEmotionValue(nextValue);
          lastVisualUpdateRef.current = timestamp;
        }
        if (timestamp - lastSampleRef.current >= 500) {
          setSamples((current) => [
            ...current.slice(-(MAX_SAMPLES - 1)),
            { value: nextValue, recordedAt: Date.now() },
          ]);
          lastSampleRef.current = timestamp;
        }

        animationFrameRef.current = requestAnimationFrame(readLevel);
      };

      animationFrameRef.current = requestAnimationFrame(readLevel);
    } catch (cause) {
      const permissionDenied =
        cause instanceof DOMException &&
        (cause.name === "NotAllowedError" || cause.name === "PermissionDeniedError");
      setError(
        permissionDenied
          ? "没有获得麦克风权限。请在浏览器设置中允许后重试。"
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
        setElapsedSeconds((seconds) => seconds + 1);
      }, 1000);
      return;
    }

    await audioContext.suspend();
    reminderAudioRef.current?.pause();
    isPausedRef.current = true;
    setIsPaused(true);
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
