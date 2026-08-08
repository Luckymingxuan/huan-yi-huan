export const REMINDER_AUDIO_STORAGE_KEY = "huan-yi-huan-reminder-audio";
export const DEFAULT_REMINDER_AUDIO_ID = "fire-alarm";

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

export function getReminderAudio(id: string | null | undefined) {
  return (
    REMINDER_AUDIO_OPTIONS.find((option) => option.id === id) ??
    REMINDER_AUDIO_OPTIONS.find((option) => option.id === DEFAULT_REMINDER_AUDIO_ID)!
  );
}
