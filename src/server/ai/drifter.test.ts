import { describe, it, expect } from "vitest";
import {
  buildFarewell,
  buildOpeningLine,
  detectLanguage,
  pickTimeOfDay,
  pickWeather,
} from "./drifter";

describe("pickTimeOfDay", () => {
  it("buckets hours into the right category", () => {
    expect(pickTimeOfDay(2)).toBe("deep_night");
    expect(pickTimeOfDay(5)).toBe("predawn");
    expect(pickTimeOfDay(12)).toBe("day");
    expect(pickTimeOfDay(18)).toBe("dusk");
    expect(pickTimeOfDay(22)).toBe("night");
    expect(pickTimeOfDay(0)).toBe("deep_night");
    expect(pickTimeOfDay(23)).toBe("night");
  });
});

describe("pickWeather", () => {
  it("returns a valid weather", () => {
    const w = pickWeather(42, "night");
    expect(["clear", "rain", "snow", "fireflies"]).toContain(w);
  });
  it("is deterministic given the same seed", () => {
    expect(pickWeather(123, "dusk")).toBe(pickWeather(123, "dusk"));
  });
});

describe("detectLanguage", () => {
  it("detects pure english", () => {
    expect(detectLanguage("Hello, how are you?")).toBe("en");
  });
  it("detects pure chinese", () => {
    expect(detectLanguage("今天好累，不想说话")).toBe("zh");
  });
  it("detects mixed", () => {
    expect(detectLanguage("我今天 had a long meeting，超累")).toBe("mixed");
  });
  it("handles empty", () => {
    expect(detectLanguage("")).toBe("en");
  });
});

describe("buildOpeningLine", () => {
  it("first-ever in english", () => {
    const r = buildOpeningLine({
      isFirstEver: true,
      msSinceLast: null,
      language: "en",
    });
    expect(r.text).toMatch(/found this place/i);
    expect(r.emotion).toBe("gentle");
  });

  it("first-ever in chinese", () => {
    const r = buildOpeningLine({
      isFirstEver: true,
      msSinceLast: null,
      language: "zh",
    });
    expect(r.text).toMatch(/找到了这里/);
  });

  it("returning <6h gives a back-already line", () => {
    const r = buildOpeningLine({
      isFirstEver: false,
      msSinceLast: 1000 * 60 * 60 * 2,
      language: "en",
    });
    expect(r.text).toMatch(/back already/i);
  });

  it("returning >7d gives the seat-kept line", () => {
    const r = buildOpeningLine({
      isFirstEver: false,
      msSinceLast: 1000 * 60 * 60 * 24 * 30,
      language: "en",
    });
    expect(r.text).toMatch(/kept your seat/i);
  });
});

describe("buildFarewell", () => {
  it("english", () => {
    expect(buildFarewell("en")).toMatch(/take care/i);
  });
  it("chinese", () => {
    expect(buildFarewell("zh")).toMatch(/保重/);
  });
});
