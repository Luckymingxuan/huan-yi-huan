export const ALARM_SENSITIVITY_STORAGE_KEY = "huan-yi-huan-alarm-sensitivity";
export const ALARM_SENSITIVITY_CHANGE_EVENT = "huan-yi-huan-alarm-sensitivity-change";
export const DEFAULT_ALARM_SENSITIVITY = 50;
export const MIN_ALARM_SENSITIVITY = 10;
export const MAX_ALARM_SENSITIVITY = 100;

export function normalizeAlarmSensitivity(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return DEFAULT_ALARM_SENSITIVITY;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_ALARM_SENSITIVITY;
  return Math.min(MAX_ALARM_SENSITIVITY, Math.max(MIN_ALARM_SENSITIVITY, Math.round(parsed)));
}

export function getAlarmThresholds(sensitivity: number) {
  const normalized = normalizeAlarmSensitivity(sensitivity);
  const trigger = normalized <= DEFAULT_ALARM_SENSITIVITY
    ? Math.round(75 - (normalized - MIN_ALARM_SENSITIVITY) * 0.75)
    : Math.round(45 - (normalized - DEFAULT_ALARM_SENSITIVITY) * 0.5);

  return { trigger, rearm: Math.max(0, trigger - 6) };
}
