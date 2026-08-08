export const REMINDER_AUDIO_STORAGE_KEY = "huan-yi-huan-reminder-audio";
export const DEFAULT_REMINDER_AUDIO_ID = "fire-alarm";
export const RECENT_AUDIO_REPLAY_ID = "recent-audio-replay";
export const DEFAULT_REMINDER_OPTION_ID = RECENT_AUDIO_REPLAY_ID;

export const REMINDER_AUDIO_OPTIONS = [
  {
    id: "fire-alarm",
    label: "消防车",
    sourceName: "Fire alarm audio",
    src: "/audio/fire-alarm.mp3",
  },
  {
    id: "emotion",
    label: "10年情感",
    sourceName: "emotion",
    src: "/audio/emotion.wav",
  },
  {
    id: "bell",
    label: "下课铃",
    sourceName: "bell",
    src: "/audio/bell.mp3",
  },
] as const;

export type ReminderAudioId = (typeof REMINDER_AUDIO_OPTIONS)[number]["id"];
export type ReminderOptionId = ReminderAudioId | typeof RECENT_AUDIO_REPLAY_ID;

export function isReminderAudioId(id: string | null | undefined): id is ReminderAudioId {
  return REMINDER_AUDIO_OPTIONS.some((option) => option.id === id);
}

export function getReminderOptionId(id: string | null | undefined): ReminderOptionId {
  if (id === RECENT_AUDIO_REPLAY_ID || isReminderAudioId(id)) return id;
  return DEFAULT_REMINDER_OPTION_ID;
}

export function getReminderAudio(id: string | null | undefined) {
  return (
    REMINDER_AUDIO_OPTIONS.find((option) => option.id === id) ??
    REMINDER_AUDIO_OPTIONS.find((option) => option.id === DEFAULT_REMINDER_AUDIO_ID)!
  );
}
