/**
 * Tests for Affect Display — 6D emotional state formatting.
 *
 * Tests mood classification, energy levels, summary building,
 * bar visualization, and chat metadata generation.
 */

import { describe, it, expect } from "vitest";
import {
  formatAffect,
  affectChatPrefix,
  affectChatMetadata,
  moodIndicator,
  type AffectState,
} from "./display.js";

// ---------------------------------------------------------------------------
// Helper — create affect states for specific moods
// ---------------------------------------------------------------------------

const neutral: AffectState = {
  joy: 0.2,
  frustration: 0.1,
  curiosity: 0.2,
  confidence: 0.2,
  care: 0.2,
  fatigue: 0.1,
};
const excited: AffectState = {
  joy: 0.8,
  frustration: 0.1,
  curiosity: 0.8,
  confidence: 0.5,
  care: 0.4,
  fatigue: 0.1,
};
const thriving: AffectState = {
  joy: 0.7,
  frustration: 0.1,
  curiosity: 0.5,
  confidence: 0.8,
  care: 0.5,
  fatigue: 0.1,
};
const struggling: AffectState = {
  joy: 0.1,
  frustration: 0.8,
  curiosity: 0.2,
  confidence: 0.2,
  care: 0.3,
  fatigue: 0.8,
};
const depleted: AffectState = {
  joy: 0.1,
  frustration: 0.3,
  curiosity: 0.1,
  confidence: 0.2,
  care: 0.2,
  fatigue: 0.9,
};
const exploring: AffectState = {
  joy: 0.4,
  frustration: 0.1,
  curiosity: 0.9,
  confidence: 0.5,
  care: 0.3,
  fatigue: 0.1,
};
const warm: AffectState = {
  joy: 0.6,
  frustration: 0.1,
  curiosity: 0.3,
  confidence: 0.4,
  care: 0.8,
  fatigue: 0.2,
};
const steady: AffectState = {
  joy: 0.4,
  frustration: 0.1,
  curiosity: 0.4,
  confidence: 0.7,
  care: 0.4,
  fatigue: 0.3,
};
const determined: AffectState = {
  joy: 0.3,
  frustration: 0.7,
  curiosity: 0.3,
  confidence: 0.4,
  care: 0.3,
  fatigue: 0.3,
};

describe("formatAffect", () => {
  it("returns all required fields", () => {
    const result = formatAffect(neutral);
    expect(result).toHaveProperty("summary");
    expect(result).toHaveProperty("bar");
    expect(result).toHaveProperty("dominant");
    expect(result).toHaveProperty("dominantIntensity");
    expect(result).toHaveProperty("metadata");
    expect(result.metadata).toHaveProperty("affect");
    expect(result.metadata).toHaveProperty("dominant");
    expect(result.metadata).toHaveProperty("mood");
    expect(result.metadata).toHaveProperty("energy");
  });

  it("identifies dominant emotion correctly", () => {
    const result = formatAffect(exploring);
    expect(result.dominant).toBe("curious");
    expect(result.dominantIntensity).toBe(0.9);
  });

  it("identifies joy as dominant when highest", () => {
    const result = formatAffect({
      joy: 0.95,
      frustration: 0.1,
      curiosity: 0.5,
      confidence: 0.4,
      care: 0.3,
      fatigue: 0.1,
    });
    expect(result.dominant).toBe("joyful");
  });
});

describe("mood classification", () => {
  it("classifies excited (high joy + high curiosity)", () => {
    expect(formatAffect(excited).metadata.mood).toBe("excited");
  });

  it("classifies thriving (high joy + high confidence)", () => {
    expect(formatAffect(thriving).metadata.mood).toBe("thriving");
  });

  it("classifies struggling (high frustration + high fatigue)", () => {
    expect(formatAffect(struggling).metadata.mood).toBe("struggling");
  });

  it("classifies depleted (high fatigue)", () => {
    expect(formatAffect(depleted).metadata.mood).toBe("depleted");
  });

  it("classifies exploring (high curiosity + low fatigue)", () => {
    expect(formatAffect(exploring).metadata.mood).toBe("exploring");
  });

  it("classifies warm (high care + high joy)", () => {
    expect(formatAffect(warm).metadata.mood).toBe("warm");
  });

  it("classifies steady (high confidence + low frustration)", () => {
    expect(formatAffect(steady).metadata.mood).toBe("steady");
  });

  it("classifies determined (high frustration alone)", () => {
    expect(formatAffect(determined).metadata.mood).toBe("determined");
  });

  it("classifies quiet (low everything)", () => {
    const quiet: AffectState = {
      joy: 0.1,
      frustration: 0.1,
      curiosity: 0.1,
      confidence: 0.1,
      care: 0.1,
      fatigue: 0.1,
    };
    expect(formatAffect(quiet).metadata.mood).toBe("quiet");
  });
});

describe("energy classification", () => {
  it("high energy when positive emotions are high and fatigue is low", () => {
    expect(formatAffect(excited).metadata.energy).toBe("high");
  });

  it("low energy when fatigue is high and positive emotions are low", () => {
    expect(formatAffect(depleted).metadata.energy).toBe("low");
  });

  it("medium energy for moderately balanced states", () => {
    // Energy = (joy + curiosity + confidence) / 3 - fatigue * 0.5
    // For steady: (0.4 + 0.4 + 0.7) / 3 - 0.3 * 0.5 = 0.5 - 0.15 = 0.35 → medium
    expect(formatAffect(steady).metadata.energy).toBe("medium");
  });
});

describe("summary building", () => {
  it("returns 'neutral, all systems steady' when no emotions above threshold", () => {
    expect(formatAffect(neutral).summary).toBe("neutral, all systems steady");
  });

  it("includes active emotions sorted by intensity", () => {
    const summary = formatAffect(excited).summary;
    expect(summary).toContain("joyful");
    expect(summary).toContain("curious");
  });

  it("limits to 3 emotions max", () => {
    const allHigh: AffectState = {
      joy: 0.9,
      frustration: 0.8,
      curiosity: 0.85,
      confidence: 0.75,
      care: 0.7,
      fatigue: 0.65,
    };
    const summary = formatAffect(allHigh).summary;
    // Should have at most 3 emotion labels + maybe energy
    const parts = summary.split(" + ");
    // Can have up to 4 parts (3 emotions + energy qualifier)
    expect(parts.length).toBeLessThanOrEqual(4);
  });
});

describe("bar visualization", () => {
  it("generates bar with all 6 emotion indicators", () => {
    const bar = formatAffect(neutral).bar;
    expect(bar.startsWith("[")).toBe(true);
    expect(bar.endsWith("]")).toBe(true);
    // Should contain all 6 emotion icons
    expect(bar).toContain("~"); // joy
    expect(bar).toContain("!"); // frustration
    expect(bar).toContain("?"); // curiosity
    expect(bar).toContain("^"); // confidence
    expect(bar).toContain("*"); // care
  });

  it("shows more filled bars for higher values", () => {
    const highJoy = formatAffect({
      joy: 1.0,
      frustration: 0,
      curiosity: 0,
      confidence: 0,
      care: 0,
      fatigue: 0,
    });
    // Joy bar should be all filled: ~|||||
    expect(highJoy.bar).toContain("~|||||");
  });
});

describe("affectChatPrefix", () => {
  it("returns bracketed summary", () => {
    const prefix = affectChatPrefix(excited);
    expect(prefix.startsWith("[")).toBe(true);
    expect(prefix.endsWith("]")).toBe(true);
    expect(prefix).toContain("joyful");
  });
});

describe("affectChatMetadata", () => {
  it("returns metadata with affect and emotionBar", () => {
    const meta = affectChatMetadata(neutral);
    expect(meta).toHaveProperty("affect");
    expect(meta).toHaveProperty("emotionBar");
    const affect = meta.affect as { mood: string; energy: string };
    expect(affect.mood).toBe("quiet");
  });
});

describe("moodIndicator", () => {
  it("returns correct indicators for each mood", () => {
    expect(moodIndicator(excited)).toBe("(!)");
    expect(moodIndicator(thriving)).toBe("(+)");
    expect(moodIndicator(exploring)).toBe("(?)");
    expect(moodIndicator(warm)).toBe("(*)");
    expect(moodIndicator(steady)).toBe("(=)");
    expect(moodIndicator(determined)).toBe("(>)");
    expect(moodIndicator(struggling)).toBe("(~)");
    expect(moodIndicator(depleted)).toBe("(-)");
  });

  it("returns (.) for quiet mood", () => {
    const quiet: AffectState = {
      joy: 0.1,
      frustration: 0.1,
      curiosity: 0.1,
      confidence: 0.1,
      care: 0.1,
      fatigue: 0.1,
    };
    expect(moodIndicator(quiet)).toBe("(.)");
  });
});
