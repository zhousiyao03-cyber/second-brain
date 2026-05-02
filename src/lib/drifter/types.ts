export type DrifterEmotion =
  | "gentle"
  | "smile"
  | "thinking"
  | "concerned"
  | "sleepy";

export type DrifterWeather = "clear" | "rain" | "snow" | "fireflies";

export type DrifterTimeOfDay =
  | "dusk"
  | "night"
  | "deep_night"
  | "predawn"
  | "day";

export type DrifterServerLanguage = "en" | "zh" | "mixed";

export type DrifterMessage = {
  id: string;
  role: "user" | "pip";
  content: string;
  emotion: DrifterEmotion | null;
  hooks: string[] | null;
  createdAt: number;
};

export type DrifterSession = {
  id: string;
  dayNumber: number;
  weather: DrifterWeather;
  timeOfDay: DrifterTimeOfDay;
  language: DrifterServerLanguage;
};

export type DrifterChatResponse = {
  userMessageId: string;
  pip: {
    id: string;
    emotion: DrifterEmotion;
    text: string;
    hooks: string[];
  };
};
