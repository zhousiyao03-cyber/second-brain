export type DrifterLang = "en" | "zh";

export const DRIFTER_TEXTS = {
  en: {
    loading: "Walking to the tea house...",
    placeholder: "Say something...",
    send: "Send",
    stepOutside: "Step outside",
    farewell: "Take care. The path's still here when you need it.",
    fallbackTitle: "Pip's tea house",
    fallbackBody:
      "The fireplace crackles. Pip looks up and listens. (Visuals couldn't load — chat below still works.)",
    error: "...the candle flickered. Could you say that again?",
    visitorYou: "You",
    pipName: "Pip",
    hookHint: "Or pick a thought:",
    desktopHint: "Drifter is best on a wider screen, but you can still chat here.",
    hud: {
      day: "Day",
      weather: {
        clear: "Clear",
        rain: "Rain",
        snow: "Snow",
        fireflies: "Fireflies",
      },
      time: {
        dusk: "Dusk",
        night: "Night",
        deep_night: "Late Night",
        predawn: "Before Dawn",
        day: "Day",
      },
    },
  },
  zh: {
    loading: "走向茶馆...",
    placeholder: "说点什么...",
    send: "发送",
    stepOutside: "出去走走",
    farewell: "保重。这条路你想来的时候还在。",
    fallbackTitle: "Pip 的茶馆",
    fallbackBody:
      "炉火噼啪响着。Pip 抬起头听着你。(画面没能加载，下方对话仍可用。)",
    error: "...烛火晃了一下。你刚才说什么？",
    visitorYou: "你",
    pipName: "Pip",
    hookHint: "或者选一个想法：",
    desktopHint: "Drifter 在大屏体验更好，不过这里也可以聊。",
    hud: {
      day: "第",
      weather: {
        clear: "晴",
        rain: "雨",
        snow: "雪",
        fireflies: "萤火",
      },
      time: {
        dusk: "黄昏",
        night: "夜",
        deep_night: "深夜",
        predawn: "黎明前",
        day: "白天",
      },
    },
  },
} as const;

export function t(lang: DrifterLang) {
  return DRIFTER_TEXTS[lang];
}

export function pickClientLang(serverLang: "en" | "zh" | "mixed"): DrifterLang {
  return serverLang === "en" ? "en" : "zh";
}
