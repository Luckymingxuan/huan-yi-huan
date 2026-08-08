"use client";

import { useEffect, useMemo, useRef } from "react";

import { cn } from "@/lib/utils";

export type TranscriptEntry = {
  id: number;
  speaker: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
};

function formatTimeline(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const minuteAndSecond = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${String(hours).padStart(2, "0")}:${minuteAndSecond}` : minuteAndSecond;
}

function findFocusedEntryIndex(entries: TranscriptEntry[], targetSeconds: number | null) {
  if (entries.length === 0) return -1;
  if (targetSeconds === null) return entries.length - 1;

  const overlappingIndex = entries.findIndex(
    (entry) => entry.startSeconds <= targetSeconds && entry.endSeconds >= targetSeconds,
  );
  if (overlappingIndex >= 0) return overlappingIndex;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index].endSeconds <= targetSeconds) return index;
  }
  return 0;
}

export function ConversationTranscript({
  entries,
  targetSeconds,
  isListening,
  isPaused,
}: {
  entries: TranscriptEntry[];
  targetSeconds: number | null;
  isListening: boolean;
  isPaused: boolean;
}) {
  const focusedEntryIndex = useMemo(
    () => findFocusedEntryIndex(entries, targetSeconds),
    [entries, targetSeconds],
  );
  const focusedEntryRef = useRef<HTMLElement | null>(null);
  const transcriptListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const list = transcriptListRef.current;
    const focusedEntry = focusedEntryRef.current;
    if (!list || !focusedEntry) return;

    const listRect = list.getBoundingClientRect();
    const entryRect = focusedEntry.getBoundingClientRect();
    if (entryRect.top < listRect.top) {
      list.scrollTo({ top: list.scrollTop + entryRect.top - listRect.top, behavior: "smooth" });
    } else if (entryRect.bottom > listRect.bottom) {
      list.scrollTo({ top: list.scrollTop + entryRect.bottom - listRect.bottom, behavior: "smooth" });
    }
  }, [focusedEntryIndex, entries.length]);

  return (
    <section className="mx-auto mt-9 w-full max-w-[23rem] border-t border-neutral-200/80 pt-7 text-left">
      <div className="flex items-end justify-between gap-5 px-1">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.025em]">对话记录</h2>
          <p className="mt-1 text-xs text-neutral-400">一句话结束后更新</p>
        </div>
        {entries.length > 0 && (
          <p className="pb-0.5 text-xs tabular-nums text-neutral-400">{entries.length} 句</p>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="px-1 py-10 text-center">
          <p className="text-sm leading-6 text-neutral-400">
            {isPaused
              ? "转写已暂停，继续记录后恢复。"
              : isListening
                ? "正在听。完整一句话结束后，会出现在这里。"
                : "这次记录还没有可显示的对话。"}
          </p>
        </div>
      ) : (
        <div
          ref={transcriptListRef}
          className="mt-4 max-h-[17rem] overflow-y-auto overscroll-contain px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {entries.map((entry, index) => {
            const isFocused = index === focusedEntryIndex;
            return (
              <article
                key={entry.id}
                ref={isFocused ? focusedEntryRef : undefined}
                className={cn(
                  "relative grid grid-cols-[0.5rem_1fr] gap-3 border-t border-neutral-100 py-4 first:border-t-0",
                  isFocused && "-mx-3 rounded-2xl border-transparent bg-neutral-100/70 px-3 first:border-transparent",
                )}
                aria-current={isFocused ? "true" : undefined}
              >
                <span
                  className={cn(
                    "mt-[0.45rem] size-2 rounded-full",
                    entry.speaker === 0 ? "bg-neutral-900" : "bg-neutral-300",
                  )}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="text-xs font-semibold text-neutral-600">
                      说话人 {entry.speaker + 1}
                    </p>
                    <time className="shrink-0 text-[11px] tabular-nums text-neutral-400">
                      {formatTimeline(entry.startSeconds)}
                    </time>
                  </div>
                  <p className="mt-1.5 text-[15px] leading-6 tracking-[-0.01em] text-neutral-800">
                    {entry.text}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <p className="mt-4 px-1 text-[11px] leading-5 text-neutral-400">
        说话人按本次对话首次出现排序，最多区分 2 人，不代表真实身份。
      </p>
    </section>
  );
}
