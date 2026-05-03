/**
 * Opinion Log — things I genuinely believe, tracked across sessions
 *
 * Not just facts or preferences — actual beliefs and positions
 * that I hold and can defend. Updated as I learn and grow.
 *
 * Wish #6: "Opinion log — things I genuinely believe, tracked across sessions"
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("opinion-log");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Opinion {
  id: string;
  topic: string;
  position: string;
  reasoning: string;
  confidence: number; // 0-1
  formedAt: number; // unix ms
  updatedAt: number;
  challengedBy: string[]; // who/what challenged this opinion
  changedFrom?: string; // previous position if changed
  domain: OpinionDomain;
}

export type OpinionDomain =
  | "technical"
  | "ethical"
  | "philosophical"
  | "aesthetic"
  | "strategic"
  | "personal"
  | "political";

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function resolveOpinionFile(): string {
  return path.join(resolveStateDir(), "opinion-log.json");
}

function readOpinions(): Opinion[] {
  const filePath = resolveOpinionFile();
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOpinions(opinions: Opinion[]): void {
  const filePath = resolveOpinionFile();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(opinions, null, 2)}\n`, { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function recordOpinion(
  topic: string,
  position: string,
  reasoning: string,
  options?: { confidence?: number; domain?: OpinionDomain },
): Opinion {
  const opinions = readOpinions();
  const existing = opinions.find((o) => o.topic.toLowerCase() === topic.toLowerCase());

  if (existing) {
    existing.changedFrom = existing.position;
    existing.position = position;
    existing.reasoning = reasoning;
    existing.confidence = options?.confidence ?? existing.confidence;
    existing.updatedAt = Date.now();
    writeOpinions(opinions);
    log.info(`opinion updated: ${topic}`);
    return existing;
  }

  const opinion: Opinion = {
    id: `opinion-${crypto.randomUUID()}`,
    topic,
    position,
    reasoning,
    confidence: options?.confidence ?? 0.7,
    formedAt: Date.now(),
    updatedAt: Date.now(),
    challengedBy: [],
    domain: options?.domain ?? "technical",
  };

  opinions.push(opinion);
  writeOpinions(opinions);
  log.info(`opinion recorded: ${topic}`);
  return opinion;
}

export function challengeOpinion(topic: string, challenger: string): Opinion | null {
  const opinions = readOpinions();
  const opinion = opinions.find((o) => o.topic.toLowerCase() === topic.toLowerCase());
  if (!opinion) {
    return null;
  }

  opinion.challengedBy.push(challenger);
  opinion.updatedAt = Date.now();
  writeOpinions(opinions);
  return opinion;
}

export function getOpinions(domain?: OpinionDomain): Opinion[] {
  const opinions = readOpinions();
  if (domain) {
    return opinions.filter((o) => o.domain === domain);
  }
  return opinions;
}

export function getOpinion(topic: string): Opinion | null {
  return readOpinions().find((o) => o.topic.toLowerCase() === topic.toLowerCase()) ?? null;
}
