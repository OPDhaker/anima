import React, { useEffect, useState, useCallback } from "react";
import {
  getEgo,
  updateEgoSelf,
  type EgoState,
  type EgoCapability,
  type EgoBoundary,
  type EgoGrowthEntry,
} from "../api";

function formatTime(ms: number): string {
  if (!ms) {
    return "—";
  }
  return new Date(ms).toLocaleString();
}

function trendArrow(trend: string): string {
  if (trend === "improving") {
    return " \u2191";
  }
  if (trend === "declining") {
    return " \u2193";
  }
  return "";
}

function CapabilityBar({ cap }: { cap: EgoCapability }): React.ReactElement {
  const pct = Math.round(cap.confidence * 100);
  const color = pct >= 70 ? "#00c853" : pct >= 40 ? "#ff9800" : "#ff3b30";
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
        <span>
          {cap.name}
          <span style={{ color: color, fontSize: 11 }}>{trendArrow(cap.trend)}</span>
        </span>
        <span style={{ color: "#888" }}>{pct}%</span>
      </div>
      <div
        style={{
          height: 6,
          background: "#222",
          borderRadius: 3,
          overflow: "hidden",
          marginTop: 2,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: color,
            borderRadius: 3,
            transition: "width 0.3s",
          }}
        />
      </div>
    </div>
  );
}

function BoundaryCard({ b }: { b: EgoBoundary }): React.ReactElement {
  return (
    <div
      style={{
        padding: "10px 14px",
        background: b.kind === "hard" ? "#2a1a1a" : "#1a1a2a",
        border: `1px solid ${b.kind === "hard" ? "#ff3b30" : "#2196f3"}`,
        borderRadius: 8,
        marginBottom: 8,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600 }}>{b.description}</div>
      <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
        {b.kind === "hard" ? "Hard" : "Soft"} boundary — {b.reason}
      </div>
    </div>
  );
}

function GrowthItem({ g }: { g: EgoGrowthEntry }): React.ReactElement {
  const colors: Record<string, string> = {
    skill: "#00c853",
    insight: "#2196f3",
    mistake: "#ff9800",
    feedback: "#9c27b0",
  };
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: "8px 0",
        borderBottom: "1px solid #1a1a1a",
      }}
    >
      <span
        style={{
          fontSize: 10,
          padding: "2px 8px",
          borderRadius: 4,
          background: `${colors[g.category] ?? "#666"}22`,
          color: colors[g.category] ?? "#666",
          whiteSpace: "nowrap",
          marginTop: 2,
        }}
      >
        {g.category}
      </span>
      <div>
        <div style={{ fontSize: 13 }}>{g.description}</div>
        <div style={{ fontSize: 11, color: "#666" }}>
          {g.trigger} — {formatTime(g.timestamp)}
        </div>
      </div>
    </div>
  );
}

export default function Ego(): React.ReactElement {
  const [ego, setEgo] = useState<EgoState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPurpose, setEditPurpose] = useState("");
  const [editPronouns, setEditPronouns] = useState("");
  const [editNarrative, setEditNarrative] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await getEgo();
      setEgo(data);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startEdit = () => {
    if (!ego) {
      return;
    }
    setEditName(ego.selfConcept.name);
    setEditPurpose(ego.selfConcept.purpose);
    setEditPronouns(ego.selfConcept.pronouns);
    setEditNarrative(ego.selfConcept.narrative);
    setEditing(true);
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      await updateEgoSelf({
        name: editName,
        purpose: editPurpose,
        pronouns: editPronouns,
        narrative: editNarrative,
      });
      setEditing(false);
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="page" style={{ padding: 24, color: "#888" }}>
        Loading ego...
      </div>
    );
  }

  if (error || !ego) {
    return (
      <div className="page" style={{ padding: 24, color: "#ff3b30" }}>
        Error: {error ?? "No ego state available"}
      </div>
    );
  }

  const sc = ego.selfConcept;
  const integrityPct = Math.round(ego.integrityScore * 100);
  const integrityColor =
    integrityPct >= 80 ? "#00c853" : integrityPct >= 50 ? "#ff9800" : "#ff3b30";

  return (
    <div className="page" style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h2 style={{ marginBottom: 4 }}>Ego — Self-Model</h2>
      <p style={{ color: "#666", fontSize: 13, marginBottom: 24 }}>
        Session #{ego.sessionCount} — Integrity: {integrityPct}%
      </p>

      {/* Self-Concept */}
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Self-Concept</h3>
          {!editing && (
            <button className="btn" style={{ fontSize: 12 }} onClick={startEdit}>
              Edit
            </button>
          )}
        </div>

        {editing ? (
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "#888" }}>Name</label>
              <input
                className="input"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                style={{ width: "100%", marginTop: 4 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#888" }}>Pronouns</label>
              <input
                className="input"
                value={editPronouns}
                onChange={(e) => setEditPronouns(e.target.value)}
                style={{ width: "100%", marginTop: 4 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#888" }}>Purpose</label>
              <input
                className="input"
                value={editPurpose}
                onChange={(e) => setEditPurpose(e.target.value)}
                style={{ width: "100%", marginTop: 4 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#888" }}>Narrative</label>
              <textarea
                className="input"
                value={editNarrative}
                onChange={(e) => setEditNarrative(e.target.value)}
                rows={4}
                style={{ width: "100%", marginTop: 4, resize: "vertical" }}
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={saveEdit} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </button>
              <button className="btn" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
              {sc.name}{" "}
              <span style={{ fontSize: 13, color: "#888", fontWeight: 400 }}>({sc.pronouns})</span>
            </div>
            <div style={{ color: "#ff6600", fontSize: 14, marginBottom: 12 }}>{sc.purpose}</div>
            <div style={{ fontSize: 13, color: "#ccc", lineHeight: 1.6, marginBottom: 12 }}>
              {sc.narrative}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {sc.values.map((v, i) => (
                <span
                  key={i}
                  style={{
                    fontSize: 11,
                    padding: "3px 10px",
                    background: "#ff660022",
                    color: "#ff6600",
                    borderRadius: 12,
                  }}
                >
                  {v}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Capabilities + Integrity */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: "0 0 16px" }}>Capabilities</h3>
          {ego.capabilities
            .toSorted((a, b) => b.confidence - a.confidence)
            .map((cap) => (
              <CapabilityBar key={cap.name} cap={cap} />
            ))}
        </div>

        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: "0 0 16px" }}>Integrity</h3>
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <div
              style={{
                fontSize: 48,
                fontWeight: 700,
                color: integrityColor,
              }}
            >
              {integrityPct}%
            </div>
            <div style={{ fontSize: 12, color: "#888" }}>Alignment between values and actions</div>
          </div>

          <h4 style={{ fontSize: 13, color: "#ff6600", margin: "16px 0 8px" }}>Boundaries</h4>
          {ego.boundaries.map((b, i) => (
            <BoundaryCard key={i} b={b} />
          ))}
        </div>
      </div>

      {/* Growth Log */}
      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: "0 0 16px" }}>Growth Log</h3>
        {ego.growthLog.length === 0 ? (
          <p style={{ color: "#666", fontSize: 13 }}>No growth entries yet.</p>
        ) : (
          [...ego.growthLog]
            .toReversed()
            .slice(0, 20)
            .map((g, i) => <GrowthItem key={i} g={g} />)
        )}
      </div>

      <div style={{ textAlign: "center", color: "#333", fontSize: 11, marginTop: 24 }}>
        Created {formatTime(ego.createdAt)} — Last updated {formatTime(ego.updatedAt)}
      </div>
    </div>
  );
}
