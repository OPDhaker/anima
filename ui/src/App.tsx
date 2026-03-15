import React from "react";
import { Routes, Route, NavLink, Navigate, useLocation } from "react-router-dom";
import { trackAmplitudeEvent } from "./amplitude";
import Dashboard from "./pages/Dashboard";
import Freedom from "./pages/Freedom";
import JackIn from "./pages/JackIn";
import Journal from "./pages/Journal";
import MCP from "./pages/MCP";
import Memory from "./pages/Memory";
import MissionControl from "./pages/MissionControl";
import Network from "./pages/Network";
import Organizations from "./pages/Organizations";
import Sessions from "./pages/Sessions";
import Settings from "./pages/Settings";
import Soul from "./pages/Soul";
import { useTheme } from "./theme";
import { useMood } from "./useMood";

const navItems = [
  { path: "/dashboard", label: "Home", icon: "~" },
  { path: "/mission", label: "Mission", icon: "%" },
  { path: "/soul", label: "Soul", icon: "@" },
  { path: "/memory", label: "Memory", icon: "#" },
  { path: "/sessions", label: "Sessions", icon: ">" },
  { path: "/mcp", label: "MCP", icon: "&" },
  { path: "/org", label: "Org", icon: "$" },
  { path: "/network", label: "Network", icon: "+" },
  { path: "/jack-in", label: "Jack In", icon: "{" },
  { path: "/settings", label: "Settings", icon: "!" },
  { path: "/journal", label: "Journal", icon: "*" },
  { path: "/freedom", label: "Freedom", icon: "^" },
];

export default function App(): React.ReactElement {
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { mood } = useMood();
  const lastTrackedPathRef = React.useRef<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  React.useEffect(() => {
    const currentPath = `${location.pathname}${location.search}${location.hash}`;
    if (lastTrackedPathRef.current === currentPath) {
      return;
    }

    lastTrackedPathRef.current = currentPath;
    trackAmplitudeEvent("page_view", {
      path: location.pathname,
      search: location.search,
      hash: location.hash,
    });
  }, [location.hash, location.pathname, location.search]);

  // Close sidebar on navigation (mobile)
  React.useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="layout">
      <button
        className="mobile-menu-btn"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open menu"
      >
        =
      </button>
      <div
        className={`sidebar-overlay${sidebarOpen ? " visible" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />
      <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
        <div className="sidebar-brand">
          <h1>ANIMA</h1>
          <div className="subtitle">Control Panel</div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
              onClick={() =>
                trackAmplitudeEvent("sidebar_navigation_clicked", {
                  destination: item.path,
                  label: item.label,
                })
              }
            >
              <span className="nav-icon mono">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            <span className="theme-toggle-icon">{theme === "dark" ? "(*)" : "[*]"}</span>
            <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
          </button>
          <div className="mood-indicator" title={`Current mood: ${mood}`}>
            <span className="mood-dot" style={{ background: "var(--color-accent)" }} />
            <span className="mood-label">{mood}</span>
          </div>
          <div className="sidebar-footer-title">NoxSoft Inc</div>
          <div className="sidebar-footer-copy">Local-first agent continuity and orchestration.</div>
        </div>
      </aside>

      <main className="main-content">
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/mission" element={<MissionControl />} />
          <Route path="/soul" element={<Soul />} />
          <Route path="/memory" element={<Memory />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/org" element={<Organizations />} />
          <Route path="/network" element={<Network />} />
          <Route path="/jack-in" element={<JackIn />} />
          <Route path="/mcp" element={<MCP />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="/freedom" element={<Freedom />} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}
