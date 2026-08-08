"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Pause, Play } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DEFAULT_REMINDER_OPTION_ID,
  getReminderAudio,
  getReminderOptionId,
  RECENT_AUDIO_REPLAY_ID,
  REMINDER_AUDIO_OPTIONS,
  REMINDER_AUDIO_STORAGE_KEY,
  type ReminderAudioId,
  type ReminderOptionId,
} from "@/lib/reminder-audio";

const REMINDER_AUDIO_CHANGE_EVENT = "huan-yi-huan-reminder-audio-change";

function subscribeToReminderAudio(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(REMINDER_AUDIO_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(REMINDER_AUDIO_CHANGE_EVENT, onStoreChange);
  };
}

function getStoredReminderOption(): ReminderOptionId {
  try {
    return getReminderOptionId(window.localStorage.getItem(REMINDER_AUDIO_STORAGE_KEY));
  } catch {
    return DEFAULT_REMINDER_OPTION_ID;
  }
}

export function AudioSettings() {
  const [playingId, setPlayingId] = useState<ReminderAudioId | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const selectedId = useSyncExternalStore(
    subscribeToReminderAudio,
    getStoredReminderOption,
    () => DEFAULT_REMINDER_OPTION_ID,
  );

  useEffect(() => {
    return () => {
      previewRef.current?.pause();
      previewRef.current = null;
    };
  }, []);

  const chooseReminder = (id: ReminderOptionId) => {
    previewRef.current?.pause();
    previewRef.current = null;
    setPlayingId(null);
    window.localStorage.setItem(REMINDER_AUDIO_STORAGE_KEY, id);
    window.dispatchEvent(new Event(REMINDER_AUDIO_CHANGE_EVENT));
  };

  const togglePreview = async (id: ReminderAudioId) => {
    if (playingId === id) {
      previewRef.current?.pause();
      previewRef.current = null;
      setPlayingId(null);
      return;
    }

    previewRef.current?.pause();
    const audio = new Audio(getReminderAudio(id).src);
    previewRef.current = audio;
    audio.onended = () => {
      previewRef.current = null;
      setPlayingId(null);
    };
    setPlayingId(id);

    try {
      await audio.play();
    } catch {
      previewRef.current = null;
      setPlayingId(null);
    }
  };

  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-[480px] bg-[#f7f7f5] px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] text-neutral-950 shadow-[0_0_80px_rgba(0,0,0,0.08)]">
      <header className="flex items-center justify-between">
        <Link
          href="/"
          aria-label="返回情绪检测"
          className={buttonVariants({
            variant: "outline",
            size: "icon-lg",
            className: "size-10 rounded-full bg-white/80 shadow-sm",
          })}
        >
          <ArrowLeft />
        </Link>
        <p className="text-sm font-medium text-neutral-500">提醒设置</p>
        <div className="size-10" aria-hidden="true" />
      </header>

      <section className="mt-16">
        <p className="text-xs font-medium tracking-[0.12em] text-neutral-400">REMINDER</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em]">选择提醒方式</h1>
        <p className="mt-3 max-w-sm text-sm leading-6 text-neutral-500">
          情绪升高时，只使用你选中的一种方式提醒你先停一下。
        </p>
      </section>

      <section className="mt-10 space-y-3" aria-label="提醒方式列表">
        <article
          className={cn(
            "flex items-center gap-4 rounded-[1.75rem] bg-white p-3 pl-5 shadow-sm ring-1 transition-all",
            selectedId === RECENT_AUDIO_REPLAY_ID ? "ring-neutral-950/15" : "ring-black/[0.04]",
          )}
        >
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-4 py-2 text-left focus-visible:outline-none"
            aria-pressed={selectedId === RECENT_AUDIO_REPLAY_ID}
            onClick={() => chooseReminder(RECENT_AUDIO_REPLAY_ID)}
          >
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full border transition-colors",
                selectedId === RECENT_AUDIO_REPLAY_ID
                  ? "border-neutral-950 bg-neutral-950 text-white"
                  : "border-neutral-200",
              )}
            >
              {selectedId === RECENT_AUDIO_REPLAY_ID && (
                <Check className="size-3.5" strokeWidth={2.5} />
              )}
            </span>
            <span className="min-w-0">
              <span className="block font-medium tracking-tight">回放刚才 8 秒</span>
              <span className="mt-0.5 block text-xs text-neutral-400">只在本机内存中滚动保留</span>
            </span>
          </button>

          <span className="grid h-11 min-w-14 place-items-center rounded-full bg-neutral-100 px-3 text-xs font-medium text-neutral-500">
            默认
          </span>
        </article>

        {REMINDER_AUDIO_OPTIONS.map((option) => {
          const selected = option.id === selectedId;
          const playing = option.id === playingId;

          return (
            <article
              key={option.id}
              className={cn(
                "flex items-center gap-4 rounded-[1.75rem] bg-white p-3 pl-5 shadow-sm ring-1 transition-all",
                selected ? "ring-neutral-950/15" : "ring-black/[0.04]",
              )}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-4 py-2 text-left focus-visible:outline-none"
                aria-pressed={selected}
                onClick={() => chooseReminder(option.id)}
              >
                <span
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full border transition-colors",
                    selected ? "border-neutral-950 bg-neutral-950 text-white" : "border-neutral-200",
                  )}
                >
                  {selected && <Check className="size-3.5" strokeWidth={2.5} />}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium tracking-tight">{option.label}</span>
                  <span className="mt-0.5 block truncate text-xs text-neutral-400">{option.sourceName}</span>
                </span>
              </button>

              <Button
                type="button"
                variant="secondary"
                size="icon-lg"
                className="size-11 rounded-full"
                aria-label={playing ? `暂停试听${option.label}` : `试听${option.label}`}
                onClick={() => togglePreview(option.id)}
              >
                {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
              </Button>
            </article>
          );
        })}
      </section>

      <p className="mt-8 text-center text-xs leading-5 text-neutral-400">
        默认回放刚才 8 秒。四种方式不会同时播放，选择只保存在当前设备。
      </p>
    </main>
  );
}
