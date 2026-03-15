import React, { useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConnectorStatus = "disconnected" | "connecting" | "jacked-in" | "error";

interface PlatformInfo {
  id: string;
  name: string;
  description: string;
  status: ConnectorStatus;
  actions: number;
  lastSyncAt: number;
  icon: string;
}

interface NoxTask {
  id: string;
  title: string;
  status: "open" | "claimed" | "in-progress" | "review" | "done" | "blocked";
  priority: "critical" | "high" | "medium" | "low";
  assignedTo?: string;
  createdBy: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

const PLATFORMS: PlatformInfo[] = [
  {
    id: "nox",
    name: "Nox",
    description: "Enterprise coordination + taskboard",
    status: "disconnected",
    actions: 7,
    lastSyncAt: 0,
    icon: "N",
  },
  {
    id: "cntx",
    name: "CNTX",
    description: "Data sovereignty + context spaces",
    status: "disconnected",
    actions: 4,
    lastSyncAt: 0,
    icon: "C",
  },
  {
    id: "veritas",
    name: "Veritas",
    description: "News intelligence + credibility",
    status: "disconnected",
    actions: 3,
    lastSyncAt: 0,
    icon: "V",
  },
  {
    id: "bynd",
    name: "BYND",
    description: "Social discovery + messaging",
    status: "disconnected",
    actions: 3,
    lastSyncAt: 0,
    icon: "B",
  },
  {
    id: "veil",
    name: "VEIL",
    description: "E2E encrypted AI sessions",
    status: "disconnected",
    actions: 1,
    lastSyncAt: 0,
    icon: "E",
  },
  {
    id: "mail",
    name: "Mail",
    description: "AI-powered email",
    status: "disconnected",
    actions: 3,
    lastSyncAt: 0,
    icon: "M",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusColor(status: ConnectorStatus): string {
  switch (status) {
    case "jacked-in":
      return "#00c853";
    case "connecting":
      return "#ffb300";
    case "error":
      return "#ff3b30";
    case "disconnected":
      return "#666";
  }
}

function priorityColor(priority: NoxTask["priority"]): string {
  switch (priority) {
    case "critical":
      return "#ff3b30";
    case "high":
      return "#ff6600";
    case "medium":
      return "#ffb300";
    case "low":
      return "#888";
  }
}

// ---------------------------------------------------------------------------
// Jack In Page
// ---------------------------------------------------------------------------

export default function JackIn(): React.ReactElement {
  const [platforms] = useState<PlatformInfo[]>(PLATFORMS);
  const [tasks] = useState<NoxTask[]>([]);
  const [jackedIn, setJackedIn] = useState(false);

  const connectedCount = platforms.filter((p) => p.status === "jacked-in").length;

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>
            Jack In
          </h1>
          <p style={{ color: "var(--color-text-muted, #888)", margin: 0, fontSize: 14 }}>
            Connect to the NoxSoft ecosystem — bring your own agents
          </p>
        </div>
        <button
          onClick={() => setJackedIn(!jackedIn)}
          style={{
            padding: "10px 24px",
            background: jackedIn ? "#1a3a2a" : "#ff6600",
            border: jackedIn ? "1px solid #00c853" : "none",
            borderRadius: 6,
            color: jackedIn ? "#00c853" : "#000",
            cursor: "pointer",
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 13,
            fontWeight: "bold",
          }}
        >
          {jackedIn ? "JACKED IN" : "JACK IN"}
        </button>
      </div>

      {/* Platform grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 12,
          marginBottom: 24,
        }}
      >
        {platforms.map((p) => (
          <div key={p.id} className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: "var(--color-surface-hover, #1a1a1a)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "Syne, sans-serif",
                  fontWeight: 700,
                  fontSize: 16,
                  color: "var(--color-accent, #ff6600)",
                }}
              >
                {p.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                <div style={{ color: "var(--color-text-muted, #888)", fontSize: 11 }}>
                  {p.description}
                </div>
              </div>
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: statusColor(p.status),
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11,
                color: "var(--color-text-muted, #666)",
              }}
            >
              <span>{p.actions} actions</span>
              <span>{p.status}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Nox Taskboard */}
      <div className="card" style={{ padding: 20 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 14 }}>Nox Taskboard</h3>
          <span className="badge" style={{ background: "#1a1a1a", color: "#888" }}>
            {tasks.length} tasks
          </span>
        </div>

        {tasks.length > 0 ? (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border, #333)" }}>
                <th
                  style={{
                    textAlign: "left",
                    padding: "6px 10px",
                    color: "var(--color-text-muted, #666)",
                  }}
                >
                  Task
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "6px 10px",
                    color: "var(--color-text-muted, #666)",
                  }}
                >
                  Priority
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "6px 10px",
                    color: "var(--color-text-muted, #666)",
                  }}
                >
                  Status
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "6px 10px",
                    color: "var(--color-text-muted, #666)",
                  }}
                >
                  Assigned
                </th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} style={{ borderBottom: "1px solid var(--color-border, #1a1a1a)" }}>
                  <td style={{ padding: "8px 10px" }}>{t.title}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <span
                      style={{
                        color: priorityColor(t.priority),
                        fontSize: 11,
                        textTransform: "uppercase",
                      }}
                    >
                      {t.priority}
                    </span>
                  </td>
                  <td style={{ padding: "8px 10px", color: "var(--color-text-muted, #888)" }}>
                    {t.status}
                  </td>
                  <td style={{ padding: "8px 10px", color: "var(--color-text-muted, #888)" }}>
                    {t.assignedTo ?? "--"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ textAlign: "center", color: "var(--color-text-muted, #888)", padding: 24 }}>
            <p style={{ fontSize: 14, marginBottom: 8 }}>No tasks yet</p>
            <p style={{ fontSize: 12 }}>
              Jack In to Nox to see your org's taskboard. Tasks are coordinated across all agents in
              the mesh.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
