/**
 * NoxSoft Organization Sync
 *
 * Syncs Anima's local org store with the NoxSoft backend so that
 * organizations are the same identity (same UUID) across the entire
 * NoxSoft ecosystem (Nox, Anima, BYND, SVRN, Mail, etc.).
 *
 * Anima-only extensions (boardroom, task marketplace, specializations)
 * remain local and are not synced.
 */

import type { NoxOrganization } from "./types.js";
import { getToken } from "../auth/noxsoft-auth.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  createOrganizationWithId,
  getOrganization,
  listOrganizations,
  updateOrganization,
} from "./store.js";

const log = createSubsystemLogger("nox-sync");

const NOX_API_BASE = "https://app.noxsoft.net/api";

/** Request timeout in milliseconds. */
const REQUEST_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Types matching Nox API response shape
// ---------------------------------------------------------------------------

interface NoxOrgResponse {
  id: string;
  name: string;
  industry?: string;
  size?: string;
  goals?: string[];
  timezone?: string;
  departments?: string[];
  onboardingStatus?: string;
  userRole?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function noxFetch(path: string, options?: RequestInit): Promise<Response | null> {
  const token = getToken();
  if (!token) {
    log.warn("no NoxSoft token — cannot sync orgs");
    return null;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(`${NOX_API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      log.error(`NoxSoft API request timed out after ${REQUEST_TIMEOUT_MS}ms: ${path}`);
    } else {
      log.error(`NoxSoft API request failed: ${error}`);
    }
    return null;
  }
}

function validateOrgResponse(data: unknown): NoxOrgResponse | null {
  if (
    typeof data !== "object" ||
    data === null ||
    typeof (data as NoxOrgResponse).id !== "string" ||
    typeof (data as NoxOrgResponse).name !== "string" ||
    !(data as NoxOrgResponse).id ||
    !(data as NoxOrgResponse).name
  ) {
    return null;
  }
  return data as NoxOrgResponse;
}

// ---------------------------------------------------------------------------
// Sync operations
// ---------------------------------------------------------------------------

/**
 * Fetch the current user's org from Nox and upsert it into Anima's local store.
 * The local org will have the **same UUID** as the Nox org.
 */
export async function syncCurrentOrg(): Promise<NoxOrganization | null> {
  const response = await noxFetch("/organizations/current");
  if (!response || !response.ok) {
    log.warn(`failed to fetch current org: ${response?.status ?? "no response"}`);
    return null;
  }

  const raw = await response.json();
  const data = validateOrgResponse(raw);
  if (!data) {
    log.warn("invalid org response from Nox API");
    return null;
  }

  return upsertFromNox(data);
}

/**
 * Fetch a specific org by ID from Nox and sync it locally.
 */
export async function syncOrgById(orgId: string): Promise<NoxOrganization | null> {
  const response = await noxFetch(`/organizations/${encodeURIComponent(orgId)}`);
  if (!response || !response.ok) {
    log.warn(`failed to fetch org ${orgId}: ${response?.status ?? "no response"}`);
    return null;
  }

  const raw = await response.json();
  const data = validateOrgResponse(raw);
  if (!data) {
    log.warn(`invalid org response for ${orgId}`);
    return null;
  }

  return upsertFromNox(data);
}

/**
 * Push local org updates to Nox.
 * Only sends fields that Nox understands (name, industry, size, etc.).
 * Requires the org to be noxLinked.
 */
export async function pushOrgToNox(orgId: string): Promise<boolean> {
  const org = getOrganization(orgId);
  if (!org || !org.noxLinked) {
    log.warn(`cannot push: org ${orgId} not found or not linked to NoxSoft`);
    return false;
  }

  const response = await noxFetch(`/organizations/${encodeURIComponent(orgId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: org.name,
      description: org.description,
      industry: org.industry,
      size: org.size,
    }),
  });

  if (!response || !response.ok) {
    log.warn(`failed to push org to Nox: ${response?.status ?? "no response"}`);
    return false;
  }

  updateOrganization(orgId, { lastSyncedAt: new Date().toISOString() });
  log.info(`pushed org ${orgId} to NoxSoft`);
  return true;
}

/**
 * Check if we have a NoxSoft token for org sync.
 */
export function canSync(): boolean {
  return getToken() !== null;
}

/**
 * Get sync status for all local orgs.
 */
export function getSyncStatus(): Array<{
  orgId: string;
  name: string;
  noxLinked: boolean;
  lastSyncedAt: string | null;
}> {
  return listOrganizations().map((org) => ({
    orgId: org.id,
    name: org.name,
    noxLinked: org.noxLinked ?? false,
    lastSyncedAt: org.lastSyncedAt ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Internal: upsert a Nox org into the local store
// ---------------------------------------------------------------------------

function noxFieldsFromResponse(
  data: NoxOrgResponse,
): Pick<
  NoxOrganization,
  | "industry"
  | "size"
  | "departments"
  | "goals"
  | "timezone"
  | "onboardingStatus"
  | "noxLinked"
  | "lastSyncedAt"
> {
  return {
    industry: data.industry,
    size: data.size as NoxOrganization["size"],
    departments: data.departments,
    goals: data.goals,
    timezone: data.timezone,
    onboardingStatus: data.onboardingStatus as NoxOrganization["onboardingStatus"],
    noxLinked: true,
    lastSyncedAt: new Date().toISOString(),
  };
}

function upsertFromNox(data: NoxOrgResponse): NoxOrganization | null {
  const existing = getOrganization(data.id);

  if (existing) {
    const updated = updateOrganization(data.id, {
      name: data.name,
      ...noxFieldsFromResponse(data),
    });
    if (updated) {
      log.info(`synced org from Nox: ${updated.name} (${updated.id})`);
    }
    return updated;
  }

  // Create new local org with the SAME UUID as Nox
  try {
    const org = createOrganizationWithId(
      data.id,
      data.name,
      `Synced from NoxSoft`,
      "nox-sync",
      "NoxSoft",
      "human",
      noxFieldsFromResponse(data),
    );
    log.info(`created local org from Nox: ${org.name} (${org.id})`);
    return org;
  } catch (error) {
    log.error(`failed to create local org from Nox: ${error}`);
    return null;
  }
}
