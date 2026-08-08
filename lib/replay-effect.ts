export const REPLAY_EFFECT_STORAGE_KEY = "huan-yi-huan-replay-effect";
export const REPLAY_EFFECT_CHANGE_EVENT = "huan-yi-huan-replay-effect-change";

export const REPLAY_EFFECT_OPTIONS = [
  {
    id: "original",
    label: "原声",
    description: "保留真实对话的声音与语速",
  },
  {
    id: "alien",
    label: "外星人",
    description: "升高 9 个半音，尖锐又搞怪",
  },
  {
    id: "buffalo",
    label: "水牛",
    description: "降低 7 个半音，低沉又厚重",
  },
  {
    id: "helium",
    label: "氦气",
    description: "升高 14 个半音，轻飘又夸张",
  },
  {
    id: "giant",
    label: "巨人",
    description: "降低 12 个半音，像巨人说话",
  },
  {
    id: "random",
    label: "随机播放",
    description: "每次从四种变声中随机选择",
  },
] as const;

export type ReplayEffectId = (typeof REPLAY_EFFECT_OPTIONS)[number]["id"];

export const DEFAULT_REPLAY_EFFECT_ID: ReplayEffectId = "original";

export function getReplayEffectId(value: string | null | undefined): ReplayEffectId {
  return REPLAY_EFFECT_OPTIONS.some((option) => option.id === value)
    ? value as ReplayEffectId
    : DEFAULT_REPLAY_EFFECT_ID;
}

const PROCESSED_REPLAY_EFFECTS = ["alien", "buffalo", "helium", "giant"] as const;

export function getReplayPitchSemitones(effect: ReplayEffectId) {
  const resolvedEffect = effect === "random"
    ? PROCESSED_REPLAY_EFFECTS[Math.floor(Math.random() * PROCESSED_REPLAY_EFFECTS.length)]
    : effect;

  if (resolvedEffect === "alien") return 9;
  if (resolvedEffect === "buffalo") return -7;
  if (resolvedEffect === "helium") return 14;
  if (resolvedEffect === "giant") return -12;
  return 0;
}
