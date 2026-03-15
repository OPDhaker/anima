import React, { useEffect, useState, useCallback } from "react";
import { getSteer, setSteer, clearSteer, getSteerHistory, type SteerEntry } from "../api";

export default function Steer(): React.ReactElement {
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<SteerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [current, hist] = await Promise.all([getSteer(), getSteerHistory()]);
      setActive(current);
      setHistory(hist);
      if (current) {
        setDraft(current);
      }
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSet = async () => {
    if (!draft.trim()) {
      return;
    }
    setSaving(true);
    try {
      await setSteer(draft.trim());
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await clearSteer();
      setDraft("");
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="page-content">
        <h2 className="page-title">&gt; Steer</h2>
        <p className="text-muted">Loading...</p>
      </div>
    );
  }

  return (
    <div className="page-content">
      <h2 className="page-title">&gt; Steer</h2>
      <p className="text-muted" style={{ marginBottom: "1.5rem" }}>
        Persistent direction that shapes every response. Like a system prompt you can edit in
        real-time.
      </p>

      {error && (
        <div className="card" style={{ borderColor: "var(--color-error)", marginBottom: "1rem" }}>
          <div className="card-body">
            <span style={{ color: "var(--color-error)" }}>{error}</span>
          </div>
        </div>
      )}

      {/* Active steer display */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div className="card-header">
          <h3 style={{ margin: 0 }}>Active Direction</h3>
          <span
            className={`badge ${active ? "badge-success" : "badge-muted"}`}
            style={{ marginLeft: "0.75rem" }}
          >
            {active ? "ACTIVE" : "NONE"}
          </span>
        </div>
        <div className="card-body">
          {active ? (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                fontFamily: "var(--font-mono)",
                fontSize: "0.9rem",
                lineHeight: "1.6",
                margin: 0,
                padding: "0.75rem",
                background: "var(--bg-secondary)",
                borderRadius: "4px",
              }}
            >
              {active}
            </pre>
          ) : (
            <p className="text-muted" style={{ margin: 0, fontStyle: "italic" }}>
              No steer active. Set one below to guide agent behavior.
            </p>
          )}
        </div>
      </div>

      {/* Set/edit steer */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div className="card-header">
          <h3 style={{ margin: 0 }}>Set Direction</h3>
        </div>
        <div className="card-body">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. Focus on security. Review all PRs for vulnerabilities. Prefer TypeScript over JavaScript."
            rows={4}
            style={{
              width: "100%",
              fontFamily: "var(--font-mono)",
              fontSize: "0.85rem",
              padding: "0.75rem",
              background: "var(--bg-primary)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-color)",
              borderRadius: "4px",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem" }}>
            <button
              className="btn btn-primary"
              onClick={handleSet}
              disabled={saving || !draft.trim()}
            >
              {saving ? "Saving..." : active ? "Update Steer" : "Set Steer"}
            </button>
            {active && (
              <button className="btn btn-secondary" onClick={handleClear} disabled={saving}>
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h3 style={{ margin: 0 }}>History</h3>
            <span className="text-muted" style={{ marginLeft: "0.75rem" }}>
              {history.length} entries
            </span>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <table className="data-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Direction</th>
                  <th>Set By</th>
                  <th>Set At</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {[...history].toReversed().map((entry, i) => (
                  <tr key={i}>
                    <td
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.8rem",
                        maxWidth: "400px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {entry.text}
                    </td>
                    <td>{entry.setBy}</td>
                    <td className="text-muted">{new Date(entry.setAt).toLocaleString()}</td>
                    <td>
                      {entry.clearedAt ? (
                        <span className="badge badge-muted">Cleared</span>
                      ) : entry.text === active ? (
                        <span className="badge badge-success">Active</span>
                      ) : (
                        <span className="badge badge-muted">Superseded</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
