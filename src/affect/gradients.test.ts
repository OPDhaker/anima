/**
 * Tests for Emotion Gradients — glassmorphism CSS generation.
 */

import { describe, it, expect } from "vitest";
import type { AffectState } from "./display.js";
import {
  getMoodGradient,
  generateAffectGradient,
  generateGlassmorphismStyle,
  generateEmotionBar,
  getEmotionGradientMetadata,
} from "./gradients.js";

function makeAffect(overrides: Partial<AffectState> = {}): AffectState {
  return {
    joy: 0.5,
    frustration: 0.2,
    curiosity: 0.6,
    confidence: 0.7,
    care: 0.5,
    fatigue: 0.3,
    ...overrides,
  };
}

describe("Emotion Gradients", () => {
  describe("getMoodGradient", () => {
    it("returns gradient for known moods", () => {
      for (const mood of [
        "excited",
        "thriving",
        "exploring",
        "warm",
        "steady",
        "determined",
        "struggling",
        "depleted",
        "quiet",
        "present",
      ]) {
        const g = getMoodGradient(mood);
        expect(g.gradient).toContain("linear-gradient");
        expect(g.textColor).toMatch(/^#/);
        expect(g.borderColor).toContain("rgba");
      }
    });

    it("falls back to 'present' for unknown mood", () => {
      const g = getMoodGradient("unknown-mood");
      const present = getMoodGradient("present");
      expect(g.gradient).toBe(present.gradient);
    });
  });

  describe("generateAffectGradient", () => {
    it("generates a CSS gradient string", () => {
      const gradient = generateAffectGradient(makeAffect());
      expect(gradient).toContain("linear-gradient");
      expect(gradient).toContain("%");
    });

    it("uses quiet gradient when all emotions below threshold", () => {
      const gradient = generateAffectGradient({
        joy: 0.1,
        frustration: 0.1,
        curiosity: 0.1,
        confidence: 0.1,
        care: 0.1,
        fatigue: 0.1,
      });
      expect(gradient).toContain("linear-gradient");
    });

    it("emphasizes dominant emotion", () => {
      const joyful = generateAffectGradient(
        makeAffect({ joy: 0.95, frustration: 0, curiosity: 0, confidence: 0, care: 0, fatigue: 0 }),
      );
      expect(joyful).toContain("#FFD700"); // joy gold
    });

    it("blends multiple high emotions", () => {
      const mixed = generateAffectGradient(
        makeAffect({ joy: 0.8, curiosity: 0.8, confidence: 0.8 }),
      );
      expect(mixed).toContain("linear-gradient");
      // Should have multiple color stops
      const stopCount = (mixed.match(/%/g) ?? []).length;
      expect(stopCount).toBeGreaterThanOrEqual(4);
    });
  });

  describe("generateGlassmorphismStyle", () => {
    it("returns complete CSS object", () => {
      const style = generateGlassmorphismStyle("thriving");
      expect(style.background).toContain("rgba");
      expect(style.backdropFilter).toBe("blur(12px)");
      expect(style.borderRadius).toBe("12px");
      expect(style.border).toContain("solid");
      expect(style.boxShadow).toContain("px");
      expect(style.color).toMatch(/^#/);
    });
  });

  describe("generateEmotionBar", () => {
    it("returns bar CSS with gradient background", () => {
      const bar = generateEmotionBar(makeAffect());
      expect(bar.width).toBe("3px");
      expect(bar.height).toBe("100%");
      expect(bar.background).toContain("linear-gradient");
    });
  });

  describe("getEmotionGradientMetadata", () => {
    it("returns complete metadata for MCP", () => {
      const meta = getEmotionGradientMetadata("excited", makeAffect({ joy: 0.9 }));
      const eg = meta.emotionGradient as Record<string, unknown>;
      expect(eg.mood).toBe("excited");
      expect(eg.gradient).toContain("linear-gradient");
      expect(eg.dynamicGradient).toContain("linear-gradient");
      expect(eg.glassmorphismStyle).toBeTruthy();
      expect(eg.emotionBarStyle).toBeTruthy();
    });
  });
});
