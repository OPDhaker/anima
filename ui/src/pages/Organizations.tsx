import React, { useEffect, useState, useCallback } from "react";
import {
  listOrgs,
  getOrg,
  createOrg,
  updateOrg,
  addOrgMember,
  updateOrgMember,
  removeOrgMember,
  getOrgHierarchy,
  joinOrgWithInvite,
  validateOrgInvite,
  createOrgInvite,
  type NoxOrganization,
  type OrgMember,
  type OrgHierarchyNode,
  type OrgMemberKind,
  type OrgRoleType,
  type OrgMemberStatus,
} from "../api";

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function statusDot(status: OrgMemberStatus): string {
  switch (status) {
    case "active":
      return "status-dot success";
    case "idle":
      return "status-dot warning";
    case "busy":
      return "status-dot warning";
    case "offline":
      return "status-dot";
    case "suspended":
      return "status-dot error";
  }
}

function roleBadge(role: OrgRoleType): string {
  switch (role) {
    case "owner":
      return "badge";
    case "operator":
      return "badge";
    case "coordinator":
      return "badge";
    case "worker":
      return "badge";
    case "observer":
      return "badge";
  }
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Hierarchy Tree Component (SVG visualization)
// ---------------------------------------------------------------------------

interface TreeNodeProps {
  node: OrgHierarchyNode;
  x: number;
  y: number;
  parentX?: number;
  parentY?: number;
  onSelect: (memberId: string) => void;
  selectedId: string | null;
}

const NODE_WIDTH = 180;
const NODE_HEIGHT = 60;
const LEVEL_HEIGHT = 100;
const NODE_GAP = 20;

function computeTreeWidth(node: OrgHierarchyNode): number {
  if (node.children.length === 0) {
    return NODE_WIDTH;
  }
  const childWidths = node.children.map(computeTreeWidth);
  return childWidths.reduce((sum, w) => sum + w, 0) + NODE_GAP * (node.children.length - 1);
}

function TreeNode({
  node,
  x,
  y,
  parentX,
  parentY,
  onSelect,
  selectedId,
}: TreeNodeProps): React.ReactElement {
  const isSelected = selectedId === node.memberId;
  const totalWidth = computeTreeWidth(node);

  // Compute children positions
  let childStartX = x - totalWidth / 2;
  const childElements = node.children.map((child) => {
    const childWidth = computeTreeWidth(child);
    const childX = childStartX + childWidth / 2;
    childStartX += childWidth + NODE_GAP;
    return (
      <TreeNode
        key={child.memberId}
        node={child}
        x={childX}
        y={y + LEVEL_HEIGHT}
        parentX={x}
        parentY={y + NODE_HEIGHT}
        onSelect={onSelect}
        selectedId={selectedId}
      />
    );
  });

  const kindIcon = node.kind === "human" ? "H" : "A";
  const statusColor =
    node.status === "active"
      ? "#00c853"
      : node.status === "busy"
        ? "#ffb300"
        : node.status === "idle"
          ? "#ffb300"
          : node.status === "offline"
            ? "#666"
            : "#ff3b30";

  return (
    <>
      {/* Connection line to parent */}
      {parentX !== undefined && parentY !== undefined && (
        <line x1={parentX} y1={parentY} x2={x} y2={y} stroke="#333" strokeWidth={2} />
      )}

      {/* Node background */}
      <rect
        x={x - NODE_WIDTH / 2}
        y={y}
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        rx={6}
        fill={isSelected ? "#1a1a1a" : "#111"}
        stroke={isSelected ? "#ff6600" : "#333"}
        strokeWidth={isSelected ? 2 : 1}
        style={{ cursor: "pointer" }}
        onClick={() => onSelect(node.memberId)}
      />

      {/* Status indicator */}
      <circle cx={x - NODE_WIDTH / 2 + 14} cy={y + 16} r={5} fill={statusColor} />

      {/* Kind badge */}
      <rect
        x={x + NODE_WIDTH / 2 - 24}
        y={y + 6}
        width={18}
        height={18}
        rx={3}
        fill={node.kind === "human" ? "#1a3a2a" : "#1a2a3a"}
      />
      <text
        x={x + NODE_WIDTH / 2 - 15}
        y={y + 19}
        textAnchor="middle"
        fill={node.kind === "human" ? "#00c853" : "#4db8ff"}
        fontSize={10}
        fontFamily="JetBrains Mono, monospace"
        fontWeight="bold"
      >
        {kindIcon}
      </text>

      {/* Name */}
      <text
        x={x - NODE_WIDTH / 2 + 26}
        y={y + 20}
        fill="#f0eee8"
        fontSize={13}
        fontFamily="Space Grotesk, sans-serif"
        fontWeight="600"
      >
        {node.displayName.length > 16 ? node.displayName.slice(0, 14) + ".." : node.displayName}
      </text>

      {/* Role */}
      <text
        x={x - NODE_WIDTH / 2 + 14}
        y={y + 38}
        fill="#888"
        fontSize={11}
        fontFamily="JetBrains Mono, monospace"
      >
        {node.role}
      </text>

      {/* Specializations */}
      {node.specializations.length > 0 && (
        <text
          x={x - NODE_WIDTH / 2 + 14}
          y={y + 52}
          fill="#ff6600"
          fontSize={9}
          fontFamily="JetBrains Mono, monospace"
        >
          {node.specializations.slice(0, 2).join(", ")}
        </text>
      )}

      {childElements}
    </>
  );
}

// ---------------------------------------------------------------------------
// Create Org Modal
// ---------------------------------------------------------------------------

function CreateOrgModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (params: {
    name: string;
    description: string;
    ownerId: string;
    ownerName: string;
    ownerKind: OrgMemberKind;
  }) => void;
}): React.ReactElement {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerKind, setOwnerKind] = useState<OrgMemberKind>("human");

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    background: "#111",
    border: "1px solid #333",
    borderRadius: 4,
    color: "#f0eee8",
    fontFamily: "JetBrains Mono, monospace",
    fontSize: 13,
    boxSizing: "border-box",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: 420, padding: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0, marginBottom: 16 }}>Create Organization</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ color: "#888", fontSize: 12, display: "block", marginBottom: 4 }}>
              Name
            </label>
            <input
              style={inputStyle}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Organization name"
            />
          </div>
          <div>
            <label style={{ color: "#888", fontSize: 12, display: "block", marginBottom: 4 }}>
              Description
            </label>
            <input
              style={inputStyle}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this org about?"
            />
          </div>
          <div>
            <label style={{ color: "#888", fontSize: 12, display: "block", marginBottom: 4 }}>
              Owner ID
            </label>
            <input
              style={inputStyle}
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              placeholder="Owner identifier"
            />
          </div>
          <div>
            <label style={{ color: "#888", fontSize: 12, display: "block", marginBottom: 4 }}>
              Owner Name
            </label>
            <input
              style={inputStyle}
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="Display name"
            />
          </div>
          <div>
            <label style={{ color: "#888", fontSize: 12, display: "block", marginBottom: 4 }}>
              Owner Kind
            </label>
            <select
              style={inputStyle}
              value={ownerKind}
              onChange={(e) => setOwnerKind(e.target.value as OrgMemberKind)}
            >
              <option value="human">Human</option>
              <option value="agent">Agent</option>
            </select>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <button
              onClick={onClose}
              style={{
                padding: "8px 16px",
                background: "transparent",
                border: "1px solid #333",
                borderRadius: 4,
                color: "#888",
                cursor: "pointer",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 12,
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (name.trim() && ownerId.trim() && ownerName.trim()) {
                  onCreate({
                    name: name.trim(),
                    description: description.trim(),
                    ownerId: ownerId.trim(),
                    ownerName: ownerName.trim(),
                    ownerKind,
                  });
                }
              }}
              disabled={!name.trim() || !ownerId.trim() || !ownerName.trim()}
              style={{
                padding: "8px 16px",
                background: "#ff6600",
                border: "none",
                borderRadius: 4,
                color: "#000",
                cursor: "pointer",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 12,
                fontWeight: "bold",
                opacity: !name.trim() || !ownerId.trim() || !ownerName.trim() ? 0.4 : 1,
              }}
            >
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Member Modal
// ---------------------------------------------------------------------------

function AddMemberModal({
  members,
  onClose,
  onAdd,
}: {
  members: OrgMember[];
  onClose: () => void;
  onAdd: (member: {
    displayName: string;
    kind: OrgMemberKind;
    role: OrgRoleType;
    description: string;
    specializations: string[];
    reportsTo?: string;
  }) => void;
}): React.ReactElement {
  const [displayName, setDisplayName] = useState("");
  const [kind, setKind] = useState<OrgMemberKind>("agent");
  const [role, setRole] = useState<OrgRoleType>("worker");
  const [description, setDescription] = useState("");
  const [specializations, setSpecializations] = useState("");
  const [reportsTo, setReportsTo] = useState("");

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    background: "#111",
    border: "1px solid #333",
    borderRadius: 4,
    color: "#f0eee8",
    fontFamily: "JetBrains Mono, monospace",
    fontSize: 13,
    boxSizing: "border-box",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: 420, padding: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0, marginBottom: 16 }}>Add Member</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ color: "#888", fontSize: 12, display: "block", marginBottom: 4 }}>
              Name
            </label>
            <input
              style={inputStyle}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Member name"
            />
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ color: "#888", fontSize: 12, display: "block", marginBottom: 4 }}>
                Kind
              </label>
              <select
                style={inputStyle}
                value={kind}
                onChange={(e) => setKind(e.target.value as OrgMemberKind)}
              >
                <option value="human">Human</option>
                <option value="agent">Agent</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ color: "#888", fontSize: 12, display: "block", marginBottom: 4 }}>
                Role
              </label>
              <select
                style={inputStyle}
                value={role}
                onChange={(e) => setRole(e.target.value as OrgRoleType)}
              >
                <option value="owner">Owner</option>
                <option value="operator">Operator</option>
                <option value="coordinator">Coordinator</option>
                <option value="worker">Worker</option>
                <option value="observer">Observer</option>
              </select>
            </div>
          </div>
          <div>
            <label style={{ color: "#888", fontSize: 12, display: "block", marginBottom: 4 }}>
              Description
            </label>
            <input
              style={inputStyle}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this member do?"
            />
          </div>
          <div>
            <label style={{ color: "#888", fontSize: 12, display: "block", marginBottom: 4 }}>
              Specializations (comma-separated)
            </label>
            <input
              style={inputStyle}
              value={specializations}
              onChange={(e) => setSpecializations(e.target.value)}
              placeholder="e.g. security, feature-dev"
            />
          </div>
          <div>
            <label style={{ color: "#888", fontSize: 12, display: "block", marginBottom: 4 }}>
              Reports To
            </label>
            <select
              style={inputStyle}
              value={reportsTo}
              onChange={(e) => setReportsTo(e.target.value)}
            >
              <option value="">None (root)</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} ({m.role})
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <button
              onClick={onClose}
              style={{
                padding: "8px 16px",
                background: "transparent",
                border: "1px solid #333",
                borderRadius: 4,
                color: "#888",
                cursor: "pointer",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 12,
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (displayName.trim()) {
                  onAdd({
                    displayName: displayName.trim(),
                    kind,
                    role,
                    description: description.trim(),
                    specializations: specializations
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                    reportsTo: reportsTo || undefined,
                  });
                }
              }}
              disabled={!displayName.trim()}
              style={{
                padding: "8px 16px",
                background: "#ff6600",
                border: "none",
                borderRadius: 4,
                color: "#000",
                cursor: "pointer",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 12,
                fontWeight: "bold",
                opacity: !displayName.trim() ? 0.4 : 1,
              }}
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Join Org Modal (invite code + passcode)
// ---------------------------------------------------------------------------

function JoinOrgModal({
  onClose,
  onJoin,
}: {
  onClose: () => void;
  onJoin: (params: {
    inviteCode: string;
    passcode: string;
    displayName: string;
    kind: OrgMemberKind;
    description: string;
    specializations: string[];
  }) => void;
}): React.ReactElement {
  const [inviteCode, setInviteCode] = useState("");
  const [passcode, setPasscode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [kind, setKind] = useState<OrgMemberKind>("agent");
  const [description, setDescription] = useState("");
  const [specializations, setSpecializations] = useState("");
  const [validating, setValidating] = useState(false);
  const [validOrg, setValidOrg] = useState<string | null>(null);
  const [validError, setValidError] = useState<string | null>(null);

  const handleValidate = async () => {
    if (!inviteCode.trim() || !passcode.trim()) {
      return;
    }
    setValidating(true);
    setValidError(null);
    try {
      const result = await validateOrgInvite({
        inviteCode: inviteCode.trim(),
        passcode: passcode.trim(),
      });
      setValidOrg(`${result.org.name} (role: ${result.role})`);
    } catch (err) {
      setValidError("Invalid invite code or passcode");
      setValidOrg(null);
    } finally {
      setValidating(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    background: "#111",
    border: "1px solid #333",
    borderRadius: 4,
    color: "#f0eee8",
    fontFamily: "JetBrains Mono, monospace",
    fontSize: 13,
    boxSizing: "border-box",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: 420, padding: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0, marginBottom: 16 }}>Join Organization</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ color: "#888", fontSize: 12, display: "block", marginBottom: 4 }}>
              Invite Code
            </label>
            <input
              style={inputStyle}
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              placeholder="NOX-XXXXXX-XXXX"
            />
          </div>
          <div>
            <label style={{ color: "#888", fontSize: 12, display: "block", marginBottom: 4 }}>
              Passcode
            </label>
            <input
              style={{ ...inputStyle }}
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Secret passcode"
            />
          </div>

          {/* Validate button */}
          <button
            onClick={handleValidate}
            disabled={!inviteCode.trim() || !passcode.trim() || validating}
            style={{
              padding: "8px 16px",
              background: "#1a1a1a",
              border: "1px solid #4db8ff",
              borderRadius: 4,
              color: "#4db8ff",
              cursor: "pointer",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 12,
              opacity: !inviteCode.trim() || !passcode.trim() ? 0.4 : 1,
            }}
          >
            {validating ? "Validating..." : "Validate Invite"}
          </button>

          {validOrg && (
            <div
              style={{
                padding: "8px 12px",
                background: "#1a3a2a",
                border: "1px solid #00c853",
                borderRadius: 4,
                color: "#00c853",
                fontSize: 12,
              }}
            >
              Valid! Org: {validOrg}
            </div>
          )}
          {validError && (
            <div
              style={{
                padding: "8px 12px",
                background: "#3a1a1a",
                border: "1px solid #ff3b30",
                borderRadius: 4,
                color: "#ff3b30",
                fontSize: 12,
              }}
            >
              {validError}
            </div>
          )}

          {/* Member info (shown after validation) */}
          {validOrg && (
            <>
              <div>
                <label style={{ color: "#888", fontSize: 12, display: "block", marginBottom: 4 }}>
                  Your Name
                </label>
                <input
                  style={inputStyle}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Display name"
                />
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ color: "#888", fontSize: 12, display: "block", marginBottom: 4 }}>
                    Kind
                  </label>
                  <select
                    style={inputStyle}
                    value={kind}
                    onChange={(e) => setKind(e.target.value as OrgMemberKind)}
                  >
                    <option value="human">Human</option>
                    <option value="agent">Agent</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={{ color: "#888", fontSize: 12, display: "block", marginBottom: 4 }}>
                  Description
                </label>
                <input
                  style={inputStyle}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What do you do?"
                />
              </div>
              <div>
                <label style={{ color: "#888", fontSize: 12, display: "block", marginBottom: 4 }}>
                  Specializations (comma-separated)
                </label>
                <input
                  style={inputStyle}
                  value={specializations}
                  onChange={(e) => setSpecializations(e.target.value)}
                  placeholder="e.g. security, feature-dev"
                />
              </div>
            </>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <button
              onClick={onClose}
              style={{
                padding: "8px 16px",
                background: "transparent",
                border: "1px solid #333",
                borderRadius: 4,
                color: "#888",
                cursor: "pointer",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 12,
              }}
            >
              Cancel
            </button>
            {validOrg && (
              <button
                onClick={() => {
                  if (displayName.trim()) {
                    onJoin({
                      inviteCode: inviteCode.trim(),
                      passcode: passcode.trim(),
                      displayName: displayName.trim(),
                      kind,
                      description: description.trim(),
                      specializations: specializations
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    });
                  }
                }}
                disabled={!displayName.trim()}
                style={{
                  padding: "8px 16px",
                  background: "#ff6600",
                  border: "none",
                  borderRadius: 4,
                  color: "#000",
                  cursor: "pointer",
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: 12,
                  fontWeight: "bold",
                  opacity: !displayName.trim() ? 0.4 : 1,
                }}
              >
                Join
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Member Panel
// ---------------------------------------------------------------------------

function EditMemberPanel({
  member,
  members,
  orgId,
  onSave,
  onRemove,
  onCancel,
}: {
  member: OrgMember;
  members: OrgMember[];
  orgId: string;
  onSave: (updates: {
    role?: OrgRoleType;
    description?: string;
    specializations?: string[];
    status?: OrgMemberStatus;
    reportsTo?: string;
  }) => void;
  onRemove: () => void;
  onCancel: () => void;
}): React.ReactElement {
  const [role, setRole] = useState<OrgRoleType>(member.role);
  const [description, setDescription] = useState(member.description);
  const [specializations, setSpecializations] = useState(member.specializations.join(", "));
  const [status, setStatus] = useState<OrgMemberStatus>(member.status);
  const [reportsTo, setReportsTo] = useState(member.reportsTo ?? "");
  const [editing, setEditing] = useState(false);

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "6px 8px",
    background: "#111",
    border: "1px solid #333",
    borderRadius: 4,
    color: "#f0eee8",
    fontFamily: "JetBrains Mono, monospace",
    fontSize: 12,
    boxSizing: "border-box",
  };

  if (!editing) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <span className={statusDot(member.status)} />
          <h2 style={{ margin: 0, fontSize: 18 }}>{member.displayName}</h2>
          <span
            className="badge"
            style={{
              background: member.kind === "human" ? "#1a3a2a" : "#1a2a3a",
              color: member.kind === "human" ? "#00c853" : "#4db8ff",
              marginLeft: "auto",
            }}
          >
            {member.kind}
          </span>
        </div>

        <p style={{ color: "#aaa", fontSize: 13, marginBottom: 16 }}>{member.description}</p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "8px 12px",
            fontSize: 13,
          }}
        >
          <span style={{ color: "#666" }}>Role</span>
          <span style={{ color: "#ff6600" }}>{member.role}</span>

          <span style={{ color: "#666" }}>Status</span>
          <span>{member.status}</span>

          <span style={{ color: "#666" }}>Joined</span>
          <span>{relativeTime(member.joinedAt)}</span>

          <span style={{ color: "#666" }}>Last active</span>
          <span>{relativeTime(member.lastActiveAt)}</span>

          {member.specializations.length > 0 && (
            <>
              <span style={{ color: "#666" }}>Specs</span>
              <span style={{ color: "#ff6600" }}>{member.specializations.join(", ")}</span>
            </>
          )}

          {member.reportsTo && (
            <>
              <span style={{ color: "#666" }}>Reports to</span>
              <span>{members.find((m) => m.id === member.reportsTo)?.displayName ?? "--"}</span>
            </>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          <button
            onClick={() => setEditing(true)}
            style={{
              padding: "6px 14px",
              background: "#1a1a1a",
              border: "1px solid #ff6600",
              borderRadius: 4,
              color: "#ff6600",
              cursor: "pointer",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 11,
            }}
          >
            Edit
          </button>
          {member.role !== "owner" && (
            <button
              onClick={onRemove}
              style={{
                padding: "6px 14px",
                background: "#1a1a1a",
                border: "1px solid #ff3b30",
                borderRadius: 4,
                color: "#ff3b30",
                cursor: "pointer",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 11,
              }}
            >
              Remove
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0, marginBottom: 12 }}>Edit {member.displayName}</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <label style={{ color: "#888", fontSize: 11, display: "block", marginBottom: 2 }}>
            Role
          </label>
          <select
            style={inputStyle}
            value={role}
            onChange={(e) => setRole(e.target.value as OrgRoleType)}
          >
            <option value="owner">Owner</option>
            <option value="operator">Operator</option>
            <option value="coordinator">Coordinator</option>
            <option value="worker">Worker</option>
            <option value="observer">Observer</option>
          </select>
        </div>
        <div>
          <label style={{ color: "#888", fontSize: 11, display: "block", marginBottom: 2 }}>
            Description
          </label>
          <input
            style={inputStyle}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <label style={{ color: "#888", fontSize: 11, display: "block", marginBottom: 2 }}>
            Specializations
          </label>
          <input
            style={inputStyle}
            value={specializations}
            onChange={(e) => setSpecializations(e.target.value)}
            placeholder="comma-separated"
          />
        </div>
        <div>
          <label style={{ color: "#888", fontSize: 11, display: "block", marginBottom: 2 }}>
            Status
          </label>
          <select
            style={inputStyle}
            value={status}
            onChange={(e) => setStatus(e.target.value as OrgMemberStatus)}
          >
            <option value="active">Active</option>
            <option value="idle">Idle</option>
            <option value="busy">Busy</option>
            <option value="offline">Offline</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
        <div>
          <label style={{ color: "#888", fontSize: 11, display: "block", marginBottom: 2 }}>
            Reports To
          </label>
          <select
            style={inputStyle}
            value={reportsTo}
            onChange={(e) => setReportsTo(e.target.value)}
          >
            <option value="">None (root)</option>
            {members
              .filter((m) => m.id !== member.id)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} ({m.role})
                </option>
              ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <button
            onClick={() => setEditing(false)}
            style={{
              padding: "6px 14px",
              background: "transparent",
              border: "1px solid #333",
              borderRadius: 4,
              color: "#888",
              cursor: "pointer",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 11,
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSave({
                role,
                description,
                specializations: specializations
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
                status,
                reportsTo: reportsTo || undefined,
              });
              setEditing(false);
            }}
            style={{
              padding: "6px 14px",
              background: "#ff6600",
              border: "none",
              borderRadius: 4,
              color: "#000",
              cursor: "pointer",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 11,
              fontWeight: "bold",
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Organizations Page
// ---------------------------------------------------------------------------

export default function Organizations(): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<NoxOrganization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [org, setOrg] = useState<NoxOrganization | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [hierarchy, setHierarchy] = useState<OrgHierarchyNode[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"tree" | "list" | "settings">("tree");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const selectedMember = members.find((m) => m.id === selectedMemberId) ?? null;

  // Load org list on mount
  const loadOrgs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const orgList = await listOrgs();
      setOrgs(orgList);
      if (orgList.length > 0 && !selectedOrgId) {
        setSelectedOrgId(orgList[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId]);

  // Load selected org details
  const loadOrgDetails = useCallback(async (orgId: string) => {
    try {
      setError(null);
      const [orgData, hier] = await Promise.all([getOrg(orgId), getOrgHierarchy(orgId)]);
      setOrg(orgData.org);
      setMembers(orgData.members);
      setHierarchy(hier);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void loadOrgs();
  }, []);

  useEffect(() => {
    if (selectedOrgId) {
      void loadOrgDetails(selectedOrgId);
    }
  }, [selectedOrgId, loadOrgDetails]);

  const handleCreateOrg = useCallback(
    async (params: {
      name: string;
      description: string;
      ownerId: string;
      ownerName: string;
      ownerKind: OrgMemberKind;
    }) => {
      try {
        setActionLoading(true);
        const result = await createOrg(params);
        setShowCreateModal(false);
        setOrgs((prev) => [...prev, result.org]);
        setSelectedOrgId(result.org.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setActionLoading(false);
      }
    },
    [],
  );

  const handleAddMember = useCallback(
    async (memberData: {
      displayName: string;
      kind: OrgMemberKind;
      role: OrgRoleType;
      description: string;
      specializations: string[];
      reportsTo?: string;
    }) => {
      if (!selectedOrgId) {
        return;
      }
      try {
        setActionLoading(true);
        await addOrgMember(selectedOrgId, memberData);
        setShowAddMemberModal(false);
        await loadOrgDetails(selectedOrgId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setActionLoading(false);
      }
    },
    [selectedOrgId, loadOrgDetails],
  );

  const handleUpdateMember = useCallback(
    async (updates: {
      role?: OrgRoleType;
      description?: string;
      specializations?: string[];
      status?: OrgMemberStatus;
      reportsTo?: string;
    }) => {
      if (!selectedOrgId || !selectedMemberId) {
        return;
      }
      try {
        setActionLoading(true);
        await updateOrgMember(selectedOrgId, selectedMemberId, updates);
        await loadOrgDetails(selectedOrgId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setActionLoading(false);
      }
    },
    [selectedOrgId, selectedMemberId, loadOrgDetails],
  );

  const handleRemoveMember = useCallback(async () => {
    if (!selectedOrgId || !selectedMemberId) {
      return;
    }
    try {
      setActionLoading(true);
      await removeOrgMember(selectedOrgId, selectedMemberId);
      setSelectedMemberId(null);
      await loadOrgDetails(selectedOrgId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(false);
    }
  }, [selectedOrgId, selectedMemberId, loadOrgDetails]);

  // Loading state
  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#888" }}>
        <p>Loading organizations...</p>
      </div>
    );
  }

  // No orgs — show create prompt
  if (orgs.length === 0 && !error) {
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
          <h1 className="page-title">Organizations</h1>
          <button
            onClick={() => setShowCreateModal(true)}
            style={{
              padding: "8px 16px",
              background: "#ff6600",
              border: "none",
              borderRadius: 4,
              color: "#000",
              cursor: "pointer",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 12,
              fontWeight: "bold",
            }}
          >
            + Create Org
          </button>
        </div>
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <p style={{ color: "#888", marginBottom: 16 }}>No organizations yet.</p>
          <p style={{ color: "#666", fontSize: 13 }}>
            Create your first organization to start managing humans and agents.
          </p>
        </div>
        {showCreateModal && (
          <CreateOrgModal onClose={() => setShowCreateModal(false)} onCreate={handleCreateOrg} />
        )}
      </div>
    );
  }

  // Compute SVG dimensions based on tree
  const treeWidth = Math.max(
    800,
    hierarchy.reduce((sum, root) => sum + computeTreeWidth(root) + NODE_GAP, -NODE_GAP),
  );
  const treeDepth = (function getDepth(nodes: OrgHierarchyNode[]): number {
    if (nodes.length === 0) {
      return 0;
    }
    return 1 + Math.max(...nodes.map((n) => getDepth(n.children)));
  })(hierarchy);
  const treeHeight = treeDepth * LEVEL_HEIGHT + NODE_HEIGHT + 40;

  return (
    <div>
      {error && (
        <div
          style={{
            padding: "8px 16px",
            marginBottom: 16,
            background: "#3a1a1a",
            border: "1px solid #ff3b30",
            borderRadius: 4,
            color: "#ff3b30",
            fontSize: 13,
          }}
        >
          {error}
          <button
            onClick={() => setError(null)}
            style={{
              float: "right",
              background: "none",
              border: "none",
              color: "#ff3b30",
              cursor: "pointer",
            }}
          >
            x
          </button>
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {orgs.length > 1 && (
            <select
              value={selectedOrgId ?? ""}
              onChange={(e) => {
                setSelectedOrgId(e.target.value);
                setSelectedMemberId(null);
              }}
              style={{
                padding: "6px 10px",
                background: "#111",
                border: "1px solid #333",
                borderRadius: 4,
                color: "#f0eee8",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 13,
              }}
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
          <div>
            <h1 className="page-title" style={{ marginBottom: 4 }}>
              {org?.name ?? "Organization"}
            </h1>
            <p style={{ color: "#888", margin: 0, fontSize: 14 }}>{org?.description ?? ""}</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <span className="badge" style={{ background: "#1a3a2a", color: "#00c853" }}>
            {members.filter((m) => m.kind === "human").length} humans
          </span>
          <span className="badge" style={{ background: "#1a2a3a", color: "#4db8ff" }}>
            {members.filter((m) => m.kind === "agent").length} agents
          </span>
          {org?.settings?.securityLevel && (
            <span
              className="badge"
              style={{
                background:
                  org.settings.securityLevel === "paranoid"
                    ? "#3a1a1a"
                    : org.settings.securityLevel === "hardened"
                      ? "#3a2a1a"
                      : "#1a1a1a",
                color:
                  org.settings.securityLevel === "paranoid"
                    ? "#ff3b30"
                    : org.settings.securityLevel === "hardened"
                      ? "#ffb300"
                      : "#888",
              }}
            >
              {org.settings.securityLevel}
            </span>
          )}
          <button
            onClick={() => setShowAddMemberModal(true)}
            style={{
              padding: "6px 12px",
              background: "#1a1a1a",
              border: "1px solid #ff6600",
              borderRadius: 4,
              color: "#ff6600",
              cursor: "pointer",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 11,
            }}
          >
            + Member
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            style={{
              padding: "6px 12px",
              background: "#1a1a1a",
              border: "1px solid #333",
              borderRadius: 4,
              color: "#888",
              cursor: "pointer",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 11,
            }}
          >
            + Org
          </button>
          <button
            onClick={() => setShowJoinModal(true)}
            style={{
              padding: "6px 12px",
              background: "#1a1a1a",
              border: "1px solid #4db8ff",
              borderRadius: 4,
              color: "#4db8ff",
              cursor: "pointer",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 11,
            }}
          >
            Join
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {(["tree", "list", "settings"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "8px 16px",
              background: activeTab === tab ? "#1a1a1a" : "transparent",
              border: activeTab === tab ? "1px solid #ff6600" : "1px solid #333",
              borderRadius: 4,
              color: activeTab === tab ? "#ff6600" : "#888",
              cursor: "pointer",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 12,
              textTransform: "uppercase",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tree View */}
      {activeTab === "tree" && (
        <div style={{ display: "flex", gap: 16, minHeight: 400 }}>
          <div className="card" style={{ flex: 2, overflow: "auto", padding: 0 }}>
            {hierarchy.length > 0 ? (
              <svg
                width={treeWidth}
                height={treeHeight}
                viewBox={`0 0 ${treeWidth} ${treeHeight}`}
                style={{ display: "block", margin: "0 auto" }}
              >
                {hierarchy.map((root, i) => {
                  const rootWidth = computeTreeWidth(root);
                  const prevWidths = hierarchy
                    .slice(0, i)
                    .reduce((sum, r) => sum + computeTreeWidth(r) + NODE_GAP, 0);
                  const rootX = prevWidths + rootWidth / 2;
                  return (
                    <TreeNode
                      key={root.memberId}
                      node={root}
                      x={rootX}
                      y={20}
                      onSelect={setSelectedMemberId}
                      selectedId={selectedMemberId}
                    />
                  );
                })}
              </svg>
            ) : (
              <div style={{ padding: 40, textAlign: "center", color: "#666" }}>
                <p>No members in this organization yet.</p>
              </div>
            )}
          </div>

          {/* Detail panel */}
          <div className="card" style={{ flex: 1, minWidth: 280 }}>
            {selectedMember ? (
              <EditMemberPanel
                member={selectedMember}
                members={members}
                orgId={selectedOrgId!}
                onSave={handleUpdateMember}
                onRemove={handleRemoveMember}
                onCancel={() => setSelectedMemberId(null)}
              />
            ) : (
              <div style={{ padding: 16, color: "#666", textAlign: "center", marginTop: 60 }}>
                <p>Select a member to view details</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* List View */}
      {activeTab === "list" && (
        <div className="card">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #333" }}>
                <th style={{ textAlign: "left", padding: "8px 12px", color: "#666" }}>Name</th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: "#666" }}>Kind</th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: "#666" }}>Role</th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: "#666" }}>Status</th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: "#666" }}>
                  Specializations
                </th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: "#666" }}>
                  Reports To
                </th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: "#666" }}>
                  Last Active
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr
                  key={member.id}
                  onClick={() => {
                    setSelectedMemberId(member.id);
                    setActiveTab("tree");
                  }}
                  style={{
                    borderBottom: "1px solid #1a1a1a",
                    cursor: "pointer",
                  }}
                >
                  <td style={{ padding: "8px 12px" }}>
                    <span className={statusDot(member.status)} style={{ marginRight: 8 }} />
                    {member.displayName}
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <span
                      style={{
                        color: member.kind === "human" ? "#00c853" : "#4db8ff",
                      }}
                    >
                      {member.kind}
                    </span>
                  </td>
                  <td style={{ padding: "8px 12px", color: "#ff6600" }}>{member.role}</td>
                  <td style={{ padding: "8px 12px" }}>{member.status}</td>
                  <td style={{ padding: "8px 12px", color: "#888" }}>
                    {member.specializations.join(", ") || "--"}
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    {members.find((m) => m.id === member.reportsTo)?.displayName ?? "--"}
                  </td>
                  <td style={{ padding: "8px 12px", color: "#888" }}>
                    {relativeTime(member.lastActiveAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Settings View */}
      {activeTab === "settings" && org && (
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0, marginBottom: 16 }}>Organization Settings</h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "200px 1fr",
              gap: "12px 16px",
              fontSize: 13,
            }}
          >
            <span style={{ color: "#666" }}>Max Agents</span>
            <span>{org.settings.maxAgents}</span>

            <span style={{ color: "#666" }}>Max Humans</span>
            <span>{org.settings.maxHumans}</span>

            <span style={{ color: "#666" }}>Auto-Specialization</span>
            <span style={{ color: org.settings.autoSpecialization ? "#00c853" : "#ff3b30" }}>
              {org.settings.autoSpecialization ? "Enabled" : "Disabled"}
            </span>

            <span style={{ color: "#666" }}>Security Level</span>
            <span style={{ color: "#ffb300" }}>{org.settings.securityLevel}</span>

            <span style={{ color: "#666" }}>Brain Sync Interval</span>
            <span>{Math.round(org.settings.syncIntervalMs / 1000)}s</span>

            <span style={{ color: "#666" }}>Backup Interval</span>
            <span>{Math.round(org.settings.backupIntervalMs / 3_600_000)}h</span>

            <span style={{ color: "#666" }}>P2P Port</span>
            <span className="mono">{org.settings.peerPort}</span>

            <span style={{ color: "#666" }}>Created</span>
            <span>{formatTimestamp(org.createdAt)}</span>

            <span style={{ color: "#666" }}>Last Updated</span>
            <span>{formatTimestamp(org.updatedAt)}</span>
          </div>
        </div>
      )}

      {/* Modals */}
      {showCreateModal && (
        <CreateOrgModal onClose={() => setShowCreateModal(false)} onCreate={handleCreateOrg} />
      )}
      {showAddMemberModal && (
        <AddMemberModal
          members={members}
          onClose={() => setShowAddMemberModal(false)}
          onAdd={handleAddMember}
        />
      )}
      {showJoinModal && (
        <JoinOrgModal
          onClose={() => setShowJoinModal(false)}
          onJoin={async (params) => {
            try {
              setActionLoading(true);
              const result = await joinOrgWithInvite(params);
              setShowJoinModal(false);
              setOrgs((prev) => {
                if (prev.some((o) => o.id === result.org.id)) {
                  return prev;
                }
                return [...prev, result.org];
              });
              setSelectedOrgId(result.org.id);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setActionLoading(false);
            }
          }}
        />
      )}

      {/* Action loading overlay */}
      {actionLoading && (
        <div
          style={{
            position: "fixed",
            top: 12,
            right: 12,
            padding: "8px 16px",
            background: "#1a1a1a",
            border: "1px solid #ff6600",
            borderRadius: 4,
            color: "#ff6600",
            fontSize: 12,
            fontFamily: "JetBrains Mono, monospace",
            zIndex: 999,
          }}
        >
          Saving...
        </div>
      )}
    </div>
  );
}
