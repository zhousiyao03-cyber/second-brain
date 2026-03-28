export const NOTE_COVER_IDS = [
  "amber",
  "sage",
  "sky",
  "plum",
  "graphite",
] as const;

export type NoteCoverId = (typeof NOTE_COVER_IDS)[number];

export const NOTE_ICON_OPTIONS = [
  "✨",
  "📝",
  "💡",
  "📚",
  "🧠",
  "🚀",
  "📌",
  "🌿",
] as const;

export const NOTE_TYPE_LABELS = {
  note: "笔记",
  journal: "日报",
  summary: "总结",
} as const;

export interface NoteCoverOption {
  id: NoteCoverId;
  label: string;
  src: string;
}

export const NOTE_COVER_OPTIONS: NoteCoverOption[] = [
  {
    id: "amber",
    label: "暖厅",
    src: "/covers/amber-window.svg",
  },
  {
    id: "sage",
    label: "庭院",
    src: "/covers/sage-garden.svg",
  },
  {
    id: "sky",
    label: "潮汐",
    src: "/covers/sky-tide.svg",
  },
  {
    id: "plum",
    label: "幕间",
    src: "/covers/plum-stage.svg",
  },
  {
    id: "graphite",
    label: "画室",
    src: "/covers/graphite-paper.svg",
  },
];

export function getNoteCoverOption(cover: string | null | undefined) {
  if (!cover) return null;

  return NOTE_COVER_OPTIONS.find((option) => option.id === cover) ?? null;
}
