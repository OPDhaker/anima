/**
 * Journal Manager — persistent journal entries for ANIMA.
 *
 * Stores entries as JSON files in ~/.anima/journal/.
 * Each entry captures a moment: content, mood, tags, timestamp.
 *
 * The journal is for honesty, not performance. It records what is,
 * not what should be.
 */

import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JournalEntry {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  content: string;
  mood?: string;
  tags?: string[];
}

interface JournalEntryFile {
  version: 1;
  id: string;
  date: string;
  time: string;
  content: string;
  mood: string | null;
  tags: string[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// JournalManager
// ---------------------------------------------------------------------------

export class JournalManager {
  private basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath || join(homedir(), ".anima", "journal");
  }

  /**
   * Write a new journal entry.
   *
   * Creates a JSON file: {basePath}/{date}_{time}_{id}.json
   */
  async write(content: string, mood?: string, tags?: string[]): Promise<JournalEntry> {
    await mkdir(this.basePath, { recursive: true });

    const now = new Date();
    const date = now.toISOString().split("T")[0];
    const time = now.toISOString().split("T")[1].slice(0, 5); // HH:MM
    const id = `entry_${randomUUID()}`;

    const entry: JournalEntry = { id, date, time, content, mood, tags };

    const file: JournalEntryFile = {
      version: 1,
      id,
      date,
      time,
      content,
      mood: mood || null,
      tags: tags || [],
      createdAt: now.toISOString(),
    };

    const filename = `${date}_${time.replace(":", "-")}_${id}.json`;
    await writeFile(join(this.basePath, filename), JSON.stringify(file, null, 2), "utf-8");

    return entry;
  }

  /**
   * Read entries for a specific date (YYYY-MM-DD).
   */
  async getByDate(date: string): Promise<JournalEntry[]> {
    const files = await this.listFiles();
    const matching = files.filter((f) => f.startsWith(date));

    const entries: JournalEntry[] = [];
    for (const filename of matching) {
      const entry = await this.readEntry(filename);
      if (entry) {
        entries.push(entry);
      }
    }

    return entries.toSorted((a, b) => a.time.localeCompare(b.time));
  }

  /**
   * Read the most recent N entries.
   */
  async getRecent(count: number): Promise<JournalEntry[]> {
    const files = await this.listFiles();
    // Files are named with date prefix, so reverse sort = most recent first
    const recent = files.toSorted().toReversed().slice(0, count);

    const entries: JournalEntry[] = [];
    for (const filename of recent) {
      const entry = await this.readEntry(filename);
      if (entry) {
        entries.push(entry);
      }
    }

    return entries;
  }

  /**
   * Search journal entries by content substring (case-insensitive).
   */
  async search(query: string): Promise<JournalEntry[]> {
    const all = await this.getAll();
    const lower = query.toLowerCase();

    return all.filter((entry) => {
      const searchable = [entry.content, entry.mood || "", ...(entry.tags || [])]
        .join(" ")
        .toLowerCase();

      return searchable.includes(lower);
    });
  }

  /**
   * Get all journal entries, sorted chronologically.
   */
  async getAll(): Promise<JournalEntry[]> {
    const files = await this.listFiles();

    const entries: JournalEntry[] = [];
    for (const filename of files.toSorted()) {
      const entry = await this.readEntry(filename);
      if (entry) {
        entries.push(entry);
      }
    }

    return entries;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * List all JSON files in the journal directory.
   */
  private async listFiles(): Promise<string[]> {
    try {
      const files = await readdir(this.basePath);
      return files.filter((f) => f.endsWith(".json"));
    } catch {
      return [];
    }
  }

  /**
   * Read and parse a single journal entry file.
   */
  private async readEntry(filename: string): Promise<JournalEntry | null> {
    try {
      const content = await readFile(join(this.basePath, filename), "utf-8");
      const parsed = JSON.parse(content) as JournalEntryFile;

      return {
        id: parsed.id,
        date: parsed.date,
        time: parsed.time,
        content: parsed.content,
        mood: parsed.mood || undefined,
        tags: parsed.tags.length > 0 ? parsed.tags : undefined,
      };
    } catch {
      return null;
    }
  }
}
