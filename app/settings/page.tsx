import type { Metadata } from "next";

import { AudioSettings } from "@/components/audio-settings";

export const metadata: Metadata = {
  title: "提醒设置 · 缓一缓",
  description: "选择情绪升高时播放的提醒声音。",
};

export default function SettingsPage() {
  return <AudioSettings />;
}
