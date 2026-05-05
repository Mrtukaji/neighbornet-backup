import { useEffect, useMemo, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || (window.location.origin.includes('localhost') ? "http://localhost:3000" : window.location.origin);
const SKILL_CATEGORIES = [
  "Gardening", "Plumbing", "Electrical", "Carpentry", "Cleaning", "Cooking",
  "Childcare", "Elderly Care", "Tech Support", "Transport / Errand",
  "Medical / First Aid", "General Labor",
];

export default function AdminApp() {
  const [token] = useState(sessionStorage.getItem("neighbornet_token") || "");
  const [user, setUser] = useState(() => { const s = sessionStorage.getItem("neighbornet_user"); return s ? JSON.parse(s) : null; });
  const [tasks, setTasks] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("pending_approval");

  // Reject modal
  const [rejectingTask, setRejectingTask] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  // Users tab
  const [allUsers, setAllUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [flagModal, setFlagModal] = useState(null);
  const [flagReason, setFlagReason] = useState("");

  // Flags tab
  const [flaggedTasks, setFlaggedTasks] = useState([]);
  const [flagsLoading, setFlagsLoading] = useState(false);

  // Audit log tab
  const [auditEntries, setAuditEntries] = useState([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditLoading, setAuditLoading] = useState(false);

  // Config tab
  const [config, setConfig] = useState(null);
  const [configDraft, setConfigDraft] = useState(null);
  const [configSaving, setConfigSaving] = useState(false);
  const [configMsg, setConfigMsg] = useState("");

  // Backup tab
  const [backupLoading, setBackupLoading] = useState(false);
  const fileInputRef = useRef(null);
  const [restoreFile, setRestoreFile] = useState(null);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState("");

  // Bulk actions
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [editingAdminTask, setEditingAdminTask] = useState(null);

  // Disputes
  const [disputes, setDisputes] = useState([]);
  const [disputesLoading, setDisputesLoading] = useState(false);
  const [resolveModal, setResolveModal] = useState(null);
  const [resolveAction, setResolveAction] = useState("keep");
  const [resolveResolution, setResolveResolution] = useState("");

  // Analytics
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const isAdmin = user?.role === "admin";

  const pendingApproval = useMemo(() => tasks.filter((t) => t.status === "pending" && !t.archived), [tasks]);
  const openTasks = useMemo(() => tasks.filter((t) => t.status === "open" && !t.archived), [tasks]);
  const inProgressTasks = useMemo(() => tasks.filter((t) => t.status === "in_progress" && !t.archived), [tasks]);
  const completedTasks = useMemo(() => tasks.filter((t) => t.status === "completed" && !t.archived), [tasks]);
  const archivedTasks = useMemo(() => tasks.filter((t) => t.archived && !t.rejectedBy), [tasks]);
  const rejectedTasks = useMemo(() => tasks.filter((t) => t.rejectedBy), [tasks]);

  // API helpers
  const authHeaders = { Authorization: `Bearer ${token}` };
  const jsonHeaders = { "Content-Type": "application/json", ...authHeaders };

  async function fetchAdminProfile() {
    if (!token) { window.location.href = "/auth"; return; }
    try {
      const res = await fetch(`${API_URL}/auth/me`, { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      if (data.role !== "dispatcher" && data.role !== "admin") { window.location.href = "/"; return; }
      setUser(data);
      sessionStorage.setItem("neighbornet_user", JSON.stringify(data));
    } catch { sessionStorage.removeItem("neighbornet_token"); sessionStorage.removeItem("neighbornet_user"); window.location.href = "/auth"; }
  }

  async function fetchAdminTasks() {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/admin/tasks`, { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setTasks(data);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function fetchLeaderboard() {
    try {
      const res = await fetch(`${API_URL}/leaderboard`);
      if (res.ok) setLeaderboard(await res.json());
    } catch { }
  }

  async function fetchUsers() {
    setUsersLoading(true);
    try {
      const res = await fetch(`${API_URL}/admin/users`, { headers: authHeaders });
      if (res.ok) setAllUsers(await res.json());
    } catch { }
    finally { setUsersLoading(false); }
  }

  async function fetchFlags() {
    setFlagsLoading(true);
    try {
      const res = await fetch(`${API_URL}/admin/flags`, { headers: authHeaders });
      if (res.ok) setFlaggedTasks(await res.json());
    } catch { }
    finally { setFlagsLoading(false); }
  }

  async function fetchAudit(page = 1) {
    setAuditLoading(true);
    try {
      const res = await fetch(`${API_URL}/admin/audit?page=${page}&limit=30`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setAuditEntries(data.entries);
        setAuditTotal(data.total);
        setAuditPage(data.page);
      }
    } catch { }
    finally { setAuditLoading(false); }
  }

  async function fetchConfig() {
    try {
      const res = await fetch(`${API_URL}/admin/config`, { headers: authHeaders });
      if (res.ok) {
        const c = await res.json();
        setConfig(c);
        setConfigDraft({ pointMultiplier: c.point_multiplier, bonusCategory: c.bonus_category || "", bonusMultiplier: c.bonus_multiplier, maxPointsPerTask: c.max_points_per_task });
      }
    } catch { }
  }

  async function saveConfig() {
    if (!isAdmin) return;
    setConfigSaving(true); setConfigMsg("");
    try {
      const res = await fetch(`${API_URL}/admin/config`, {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({
          pointMultiplier: Number(configDraft.pointMultiplier),
          bonusCategory: configDraft.bonusCategory || null,
          bonusMultiplier: Number(configDraft.bonusMultiplier),
          maxPointsPerTask: Number(configDraft.maxPointsPerTask),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setConfig(data);
      setConfigMsg("Config saved successfully!");
    } catch (err) { setConfigMsg("Error: " + err.message); }
    finally { setConfigSaving(false); }
  }

  async function approveTask(id) {
    setError("");
    try {
      const res = await fetch(`${API_URL}/admin/tasks/${id}/approve`, { method: "PUT", headers: authHeaders });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setTasks((p) => p.map((t) => t._id === data._id ? data : t));
    } catch (err) { setError(err.message); }
  }

  async function rejectTask() {
    if (!rejectingTask) return;
    setError("");
    try {
      const res = await fetch(`${API_URL}/admin/tasks/${rejectingTask._id}/reject`, {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ reason: rejectReason || "Did not meet community guidelines." }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setTasks((p) => p.map((t) => t._id === data._id ? data : t));
      setRejectingTask(null); setRejectReason("");
    } catch (err) { setError(err.message); }
  }

  async function archiveTask(id) {
    setError("");
    try {
      const res = await fetch(`${API_URL}/admin/tasks/${id}/archive`, { method: "PUT", headers: authHeaders });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setTasks((p) => p.map((t) => t._id === data._id ? data : t));
      fetchLeaderboard();
    } catch (err) { setError(err.message); }
  }

  async function resolveFlag(taskId, flagIndex) {
    try {
      const res = await fetch(`${API_URL}/admin/flags/${taskId}/${flagIndex}/resolve`, { method: "PUT", headers: authHeaders });
      if (res.ok) fetchFlags();
    } catch { }
  }

  async function flagUser(userId, isFlagged) {
    try {
      await fetch(`${API_URL}/admin/users/${userId}/flag`, {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ isFlagged, flagReason }),
      });
      setFlagModal(null); setFlagReason("");
      fetchUsers();
    } catch { }
  }

  async function changeUserRole(userId, role) {
    if (!isAdmin) return;
    try {
      const res = await fetch(`${API_URL}/admin/users/${userId}/role`, {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ role }),
      });
      if (res.ok) fetchUsers();
    } catch { }
  }

  async function downloadBackup() {
    setBackupLoading(true);
    try {
      const res = await fetch(`${API_URL}/admin/backup`, { headers: authHeaders });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `neighbornet-backup-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { }
    finally { setBackupLoading(false); }
  }

  const handleRestoreUpload = (e) => {
    const file = e.target.files[0];
    if (file) setRestoreFile(file);
  };

  async function restoreDatabase() {
    if (!restoreFile) return;
    setRestoreLoading(true);
    setRestoreMsg("");
    try {
      const fileContent = await restoreFile.text();
      const backupData = JSON.parse(fileContent);
      const res = await fetch(`${API_URL}/admin/restore`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(backupData),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setRestoreMsg("Database restored successfully!");
      setRestoreFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      fetchAdminTasks();
      fetchUsers();
    } catch (err) {
      setRestoreMsg("Restore failed: " + err.message);
    } finally {
      setRestoreLoading(false);
    }
  }

  async function bulkApprove() {
    if (!window.confirm(`Approve ${selectedTaskIds.length} tasks?`)) return;
    try {
      const res = await fetch(`${API_URL}/admin/tasks/bulk-approve`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ taskIds: selectedTaskIds }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      await fetchAdminTasks();
      setSelectedTaskIds([]);
    } catch (err) { setError(err.message); }
  }

  async function bulkReject() {
    const reason = prompt("Rejection reason for all selected tasks:", "Bulk rejection");
    if (!window.confirm(`Reject ${selectedTaskIds.length} tasks?`)) return;
    try {
      const res = await fetch(`${API_URL}/admin/tasks/bulk-reject`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ taskIds: selectedTaskIds, reason }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      await fetchAdminTasks();
      setSelectedTaskIds([]);
    } catch (err) { setError(err.message); }
  }

  function toggleTaskSelection(id) {
    setSelectedTaskIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  }

  async function updateAdminTask() {
    if (!editingAdminTask) return;
    setError("");
    try {
      const res = await fetch(`${API_URL}/admin/tasks/${editingAdminTask._id}/edit`, {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify(editingAdminTask),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      await fetchAdminTasks();
      setEditingAdminTask(null);
    } catch (err) { setError(err.message); }
  }

  // Disputes
  async function fetchDisputes() {
    setDisputesLoading(true);
    try {
      const res = await fetch(`${API_URL}/disputes`, { headers: authHeaders });
      if (res.ok) setDisputes(await res.json());
    } catch { }
    finally { setDisputesLoading(false); }
  }

  async function resolveDispute() {
    if (!resolveModal) return;
    try {
      const res = await fetch(`${API_URL}/disputes/${resolveModal.dispute._id}/resolve`, {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ resolution: resolveResolution || "Resolved by moderator", action: resolveAction }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      await fetchDisputes();
      setResolveModal(null);
      setResolveAction("keep");
      setResolveResolution("");
    } catch (err) { setError(err.message); }
  }

  // Analytics
  async function fetchAnalytics() {
    setAnalyticsLoading(true);
    try {
      const res = await fetch(`${API_URL}/admin/analytics`, { headers: authHeaders });
      if (res.ok) setAnalytics(await res.json());
    } catch { }
    finally { setAnalyticsLoading(false); }
  }

  function logout() { sessionStorage.removeItem("neighbornet_token"); sessionStorage.removeItem("neighbornet_user"); window.location.href = "/auth"; }

  useEffect(() => { fetchAdminProfile(); }, []);
  useEffect(() => {
    if (user?.role === "dispatcher" || user?.role === "admin") {
      fetchAdminTasks();
      fetchLeaderboard();
    }
  }, [user]);

  useEffect(() => {
    if (activeTab === "users") fetchUsers();
    if (activeTab === "flags") fetchFlags();
    if (activeTab === "audit") fetchAudit(1);
    if (activeTab === "config") fetchConfig();
    if (activeTab === "disputes") fetchDisputes();
    if (activeTab === "analytics") fetchAnalytics();
  }, [activeTab]);

  const tabs = [
    { id: "pending_approval", label: "Pending Approval", count: pendingApproval.length, color: "#7c3aed" },
    { id: "pending_archive", label: "Pending Archive", count: completedTasks.length, color: "#ea580c" },
    { id: "open", label: "Open", count: openTasks.length, color: "#3b82f6" },
    { id: "active", label: "In Progress", count: inProgressTasks.length, color: "#8b5cf6" },
    { id: "archive", label: "Archive Log", count: archivedTasks.length, color: "#22c55e" },
    { id: "rejected", label: "Rejected", count: rejectedTasks.length, color: "#94a3b8" },
    { id: "flags", label: "Flags", count: flaggedTasks.filter(t => t.flagReports?.some(f => !f.resolved)).length, color: "#ef4444" },
    { id: "users", label: "Users", count: null, color: "#0891b2" },
    { id: "audit", label: "Audit Log", count: null, color: "#64748b" },
    { id: "disputes", label: "Disputes", count: disputes.filter(d => d.status === "pending").length, color: "#d97706" },
    { id: "analytics", label: "Analytics", count: null, color: "#16a34a" },
    ...(isAdmin ? [
      { id: "config", label: "Config", count: null, color: "#d97706" },
      { id: "backup", label: "Backup", count: null, color: "#16a34a" },
    ] : []),
  ];

  const taskTabData = {
    pending_approval: pendingApproval,
    pending_archive: completedTasks,
    open: openTasks,
    active: inProgressTasks,
    archive: archivedTasks,
    rejected: rejectedTasks,
  };

  return (
    <div style={pageStyle}>
      <div style={gridBgStyle} />
      <div style={{ position: "relative", zIndex: 1 }}>
        <header style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={brandStyle}>NEIGHBOR<span style={{ color: "#ea580c" }}>NET</span></div>
            <div style={divStyle} />
            <div style={{ fontFamily: "monospace", fontSize: 10, color: "#64748b", letterSpacing: 2 }}>
              {isAdmin ? "ADMIN PANEL" : "DISPATCHER PANEL"}
            </div>
            <div style={divStyle} />
            <div style={{ fontFamily: "monospace", fontSize: 10, color: "#22c55e", letterSpacing: 1, display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
              {user?.name}
              {isAdmin && <span style={{ background: "#fef9c3", border: "1px solid #fde047", borderRadius: 4, padding: "1px 7px", fontSize: 9, color: "#92400e", fontWeight: 700, marginLeft: 6 }}>ADMIN</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <a href="/" style={navBtnStyle}>← Main Map</a>
            <button onClick={() => { fetchAdminTasks(); fetchLeaderboard(); }} style={navBtnStyle}>↻ Refresh</button>
            <button onClick={logout} style={dangerBtnStyle}>Logout</button>
          </div>
        </header>

        <div style={contentStyle}>
          <div>
            <div style={statsBarStyle}>
              {[
                { label: "Awaiting Approval", val: pendingApproval.length, color: "#7c3aed", bg: "#faf5ff", border: "#ddd6fe" },
                { label: "Open", val: openTasks.length, color: "#3b82f6", bg: "#eff6ff", border: "#bfdbfe" },
                { label: "In Progress", val: inProgressTasks.length, color: "#8b5cf6", bg: "#f5f3ff", border: "#ddd6fe" },
                { label: "Needs Archive", val: completedTasks.length, color: "#ea580c", bg: "#fff7ed", border: "#fed7aa" },
                { label: "Flagged Tasks", val: flaggedTasks.filter(t => t.flagReports?.some(f => !f.resolved)).length, color: "#ef4444", bg: "#fef2f2", border: "#fecaca" },
                { label: "Total", val: tasks.length, color: "#64748b", bg: "#f8fafc", border: "#e2e8f0" },
              ].map(({ label, val, color, bg, border }) => (
                <div key={label} style={{ flex: 1, background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
                  <div style={{ fontFamily: "monospace", fontSize: 8, color, letterSpacing: 1, marginBottom: 4, opacity: 0.8 }}>{label.toUpperCase()}</div>
                  <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color }}>{val}</div>
                </div>
              ))}
            </div>

            <div style={tabBarStyle}>
              {tabs.map((tab) => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={tabBtnStyle(activeTab === tab.id, tab.color)}>
                  {tab.label}
                  {tab.count !== null && tab.count > 0 && (
                    <span style={{ background: activeTab === tab.id ? tab.color : "#f1f5f9", color: activeTab === tab.id ? "#fff" : "#94a3b8", borderRadius: 4, padding: "1px 7px", fontFamily: "monospace", fontSize: 10, marginLeft: 6, fontWeight: 600 }}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div style={taskAreaStyle}>
              {/* ── TASK TABS ── */}
              {taskTabData[activeTab] !== undefined && (
                <>
                  {activeTab === "pending_approval" && <div style={hintBoxStyle("#faf5ff", "#ddd6fe", "#7c3aed")}>// Review each task before it goes live on the map. Approve to publish, Reject to remove with a reason sent to the citizen.</div>}
                  {activeTab === "pending_archive" && <div style={hintBoxStyle("#fff7ed", "#fed7aa", "#ea580c")}>// These tasks are marked completed by the helper. Archive them to award points to the helper.</div>}

                  {selectedTaskIds.length > 0 && (
                    <div style={{ marginBottom: 12, display: "flex", gap: 8 }}>
                      <button onClick={bulkApprove} style={approveBtnStyle}>Bulk Approve ({selectedTaskIds.length})</button>
                      <button onClick={bulkReject} style={rejectBtnStyle}>Bulk Reject</button>
                      <button onClick={() => setSelectedTaskIds([])} style={secBtnStyle}>Clear</button>
                    </div>
                  )}

                  {loading && <div style={muteStyle}>Loading...</div>}
                  {!loading && taskTabData[activeTab].length === 0 && <div style={muteStyle}>No records in this category.</div>}

                  <div style={{ display: "grid", gap: 10 }}>
                    {!loading && taskTabData[activeTab].map((task) => (
                      <TaskCard
                        key={task._id}
                        task={task}
                        activeTab={activeTab}
                        isAdmin={isAdmin}
                        selectedTaskIds={selectedTaskIds}
                        toggleTaskSelection={toggleTaskSelection}
                        onApprove={() => approveTask(task._id)}
                        onReject={() => { setRejectingTask(task); setRejectReason(""); }}
                        onArchive={() => archiveTask(task._id)}
                        onAdminEdit={() => setEditingAdminTask(task)}
                      />
                    ))}
                  </div>
                </>
              )}

              {/* ── FLAGS TAB ── */}
              {activeTab === "flags" && (
                <>
                  <div style={hintBoxStyle("#fef2f2", "#fecaca", "#ef4444")}>// Flagged tasks need review. Resolve each individual flag report after investigating. Resolving a flag does NOT remove the task.</div>
                  {flagsLoading && <div style={muteStyle}>Loading...</div>}
                  {!flagsLoading && flaggedTasks.length === 0 && <div style={muteStyle}>No flagged tasks.</div>}
                  <div style={{ display: "grid", gap: 12 }}>
                    {flaggedTasks.map((task) => (
                      <div key={task._id} style={{ background: "#fafafa", border: "1px solid #e2e8f0", borderLeft: "3px solid #ef4444", borderRadius: "0 8px 8px 0", padding: 14 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: "#1e293b", marginBottom: 6 }}>{task.title}</div>
                        <div style={{ fontFamily: "monospace", fontSize: 10, color: "#94a3b8", marginBottom: 10 }}>{task.category} · {task.location}</div>
                        <div style={{ display: "grid", gap: 8 }}>
                          {task.flagReports?.filter(f => !f.resolved).map((flag, idx) => (
                            <div key={idx} style={{ background: "#fff", border: "1px solid #fecaca", borderRadius: 6, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                              <div>
                                <div style={{ fontFamily: "monospace", fontSize: 9, color: "#ef4444", marginBottom: 3 }}>FLAGGED BY {flag.flaggedBy?.toUpperCase()}</div>
                                <div style={{ fontSize: 13, color: "#475569" }}>{flag.reason}</div>
                                <div style={{ fontFamily: "monospace", fontSize: 9, color: "#94a3b8", marginTop: 3 }}>{new Date(flag.flaggedAt).toLocaleString()}</div>
                              </div>
                              <button onClick={() => resolveFlag(task._id, idx)} style={{ padding: "7px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, color: "#15803d", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                                ✓ Resolve
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* ── USERS TAB ── */}
              {activeTab === "users" && (
                <>
                  <div style={hintBoxStyle("#eff6ff", "#bfdbfe", "#1d4ed8")}>// All registered users. Flag users for suspicious behavior. Admins can change roles.</div>
                  {usersLoading && <div style={muteStyle}>Loading...</div>}
                  {!usersLoading && allUsers.length === 0 && <div style={muteStyle}>No users found.</div>}
                  <div style={{ display: "grid", gap: 8 }}>
                    {allUsers.map((u) => (
                      <div key={u._id} style={{ background: "#fafafa", border: "1px solid #e2e8f0", borderLeft: `3px solid ${u.isFlagged ? "#ef4444" : u.role === "admin" ? "#d97706" : u.role === "dispatcher" ? "#7c3aed" : "#e2e8f0"}`, borderRadius: "0 8px 8px 0", padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                            <div style={{ fontWeight: 700, color: "#1e293b" }}>{u.name}</div>
                            <RoleBadge role={u.role} />
                            {u.isFlagged && <span style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 4, padding: "1px 7px", fontSize: 9, color: "#991b1b", fontWeight: 700 }}>FLAGGED</span>}
                          </div>
                          <div style={{ fontFamily: "monospace", fontSize: 10, color: "#94a3b8" }}>{u.email}</div>
                          <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 11, color: "#64748b" }}>
                            <span>⭐ {u.points} pts</span>
                            <span>📊 Score: {u.engagementScore || 0}</span>
                            <span>✓ {u.totalTasksHelped || 0} helped</span>
                            {u.averageRating > 0 && <span>★ {u.averageRating} ({u.totalRatingCount})</span>}
                          </div>
                          {u.isFlagged && u.flagReason && (
                            <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 10, color: "#ef4444" }}>Flag: {u.flagReason}</div>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          {isAdmin && u._id !== user?._id && (
                            <select
                              value={u.role}
                              onChange={(e) => changeUserRole(u._id, e.target.value)}
                              style={{ padding: "6px 10px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, color: "#475569", fontFamily: "monospace", fontSize: 11, cursor: "pointer" }}
                            >
                              <option value="community">Community</option>
                              <option value="dispatcher">Dispatcher</option>
                              <option value="admin">Admin</option>
                            </select>
                          )}
                          <button
                            onClick={() => { if (u.isFlagged) { flagUser(u._id, false); } else { setFlagModal(u); setFlagReason(""); } }}
                            style={{ padding: "7px 12px", background: u.isFlagged ? "#f0fdf4" : "#fef2f2", border: `1px solid ${u.isFlagged ? "#bbf7d0" : "#fecaca"}`, borderRadius: 6, color: u.isFlagged ? "#15803d" : "#991b1b", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                          >
                            {u.isFlagged ? "✓ Unflag" : "⚑ Flag"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* ── AUDIT LOG TAB ── */}
              {activeTab === "audit" && (
                <>
                  <div style={hintBoxStyle("#f8fafc", "#e2e8f0", "#64748b")}>// Immutable log of all admin actions. Actions cannot be deleted.</div>
                  {auditLoading && <div style={muteStyle}>Loading...</div>}
                  {!auditLoading && auditEntries.length === 0 && <div style={muteStyle}>No audit entries yet.</div>}
                  <div style={{ display: "grid", gap: 6 }}>
                    {auditEntries.map((entry) => (
                      <div key={entry._id} style={{ background: "#fafafa", border: "1px solid #f1f5f9", borderLeft: "3px solid #cbd5e1", borderRadius: "0 6px 6px 0", padding: "9px 12px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, color: "#1e293b", background: "#f1f5f9", borderRadius: 4, padding: "2px 7px" }}>{entry.action}</span>
                            <span style={{ fontSize: 12, color: "#475569" }}>{entry.targetLabel || entry.targetId || "—"}</span>
                          </div>
                          <div style={{ fontFamily: "monospace", fontSize: 10, color: "#64748b", marginTop: 4 }}>by <strong>{entry.actorName}</strong> ({entry.actorRole})</div>
                          {entry.details && Object.keys(entry.details).length > 0 && (
                            <div style={{ fontFamily: "monospace", fontSize: 9, color: "#94a3b8", marginTop: 3 }}>{JSON.stringify(entry.details)}</div>
                          )}
                        </div>
                        <div style={{ fontFamily: "monospace", fontSize: 9, color: "#94a3b8", whiteSpace: "nowrap", paddingTop: 2 }}>{new Date(entry.createdAt).toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
                  {auditTotal > 30 && (
                    <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "center" }}>
                      <button disabled={auditPage <= 1} onClick={() => fetchAudit(auditPage - 1)} style={{ ...navBtnStyle, opacity: auditPage <= 1 ? 0.4 : 1 }}>← Prev</button>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: "#94a3b8", padding: "7px 10px" }}>Page {auditPage}</span>
                      <button disabled={auditPage * 30 >= auditTotal} onClick={() => fetchAudit(auditPage + 1)} style={{ ...navBtnStyle, opacity: auditPage * 30 >= auditTotal ? 0.4 : 1 }}>Next →</button>
                    </div>
                  )}
                </>
              )}

              {/* ── CONFIG TAB (admin only) ── */}
              {activeTab === "config" && (
                <>
                  <div style={hintBoxStyle("#fffbeb", "#fde68a", "#d97706")}>// Reward configuration. Changes apply to new task approvals going forward. Admin only.</div>
                  {!config && <div style={muteStyle}>Loading config...</div>}
                  {config && configDraft && (
                    <div style={{ display: "grid", gap: 18, maxWidth: 480 }}>
                      <ConfigField
                        label="Global Point Multiplier"
                        hint="Applied to all approved tasks (e.g. 1.5 = 50% bonus)"
                        type="number"
                        step="0.1"
                        min="0.1"
                        max="10"
                        value={configDraft.pointMultiplier}
                        onChange={(v) => setConfigDraft(d => ({ ...d, pointMultiplier: v }))}
                        disabled={!isAdmin}
                      />
                      <div>
                        <FieldLabel>Bonus Category</FieldLabel>
                        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>Tasks in this category get an additional multiplier</div>
                        <select
                          value={configDraft.bonusCategory || ""}
                          onChange={(e) => setConfigDraft(d => ({ ...d, bonusCategory: e.target.value }))}
                          disabled={!isAdmin}
                          style={{ width: "100%", padding: "10px 12px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, color: "#1e293b", fontSize: 13, boxSizing: "border-box" }}
                        >
                          <option value="">— None —</option>
                          {SKILL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <ConfigField
                        label="Bonus Category Multiplier"
                        hint="Applied on top of the global multiplier for the bonus category"
                        type="number"
                        step="0.1"
                        min="1"
                        max="10"
                        value={configDraft.bonusMultiplier}
                        onChange={(v) => setConfigDraft(d => ({ ...d, bonusMultiplier: v }))}
                        disabled={!isAdmin}
                      />
                      <ConfigField
                        label="Max Points Per Task"
                        hint="Hard cap — no task can award more than this"
                        type="number"
                        step="10"
                        min="1"
                        value={configDraft.maxPointsPerTask}
                        onChange={(v) => setConfigDraft(d => ({ ...d, maxPointsPerTask: v }))}
                        disabled={!isAdmin}
                      />
                      {isAdmin && (
                        <div>
                          <button onClick={saveConfig} disabled={configSaving} style={{ padding: "11px 20px", background: "#d97706", border: "none", borderRadius: 6, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer", opacity: configSaving ? 0.6 : 1 }}>
                            {configSaving ? "Saving..." : "Save Config →"}
                          </button>
                          {configMsg && <div style={{ marginTop: 10, fontSize: 13, color: configMsg.startsWith("Error") ? "#991b1b" : "#15803d" }}>{configMsg}</div>}
                        </div>
                      )}
                      {!isAdmin && <div style={muteStyle}>Only admins can save config changes.</div>}
                    </div>
                  )}
                </>
              )}

              {/* ── BACKUP TAB (admin only) ── */}
              {activeTab === "backup" && (
                <>
                  <div style={hintBoxStyle("#f0fdf4", "#bbf7d0", "#16a34a")}>// Download a full JSON export of all database collections. This will be logged in the Audit Log.</div>
                  <div style={{ display: "grid", gap: 16, maxWidth: 480 }}>
                    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 20 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#1e293b", marginBottom: 6 }}>Export Backup</div>
                      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 14, lineHeight: 1.6 }}>
                        Downloads a <code>.json</code> file containing all tasks, users (without passwords), notifications, audit logs, and the current reward config.
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16, fontFamily: "monospace", fontSize: 11 }}>
                        {["tasks", "users", "notifications", "auditLogs", "config"].map(label => (
                          <div key={label} style={{ background: "#f8fafc", border: "1px solid #f1f5f9", borderRadius: 6, padding: "7px 10px", color: "#475569" }}>📦 {label}</div>
                        ))}
                      </div>
                      <button
                        onClick={downloadBackup}
                        disabled={backupLoading}
                        style={{ padding: "12px 20px", background: "#16a34a", border: "none", borderRadius: 6, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer", width: "100%", opacity: backupLoading ? 0.6 : 1 }}
                      >
                        {backupLoading ? "Preparing export..." : "⬇ Download Backup (.json)"}
                      </button>
                    </div>

                    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 20 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#1e293b", marginBottom: 6 }}>Import / Restore</div>
                      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 14, lineHeight: 1.6 }}>
                        Upload a previously downloaded backup file to restore the database. <strong>This will overwrite existing data.</strong>
                      </div>
                      <input
                        type="file"
                        accept=".json"
                        ref={fileInputRef}
                        style={{ marginBottom: 12 }}
                        onChange={handleRestoreUpload}
                      />
                      <button
                        onClick={restoreDatabase}
                        disabled={restoreLoading || !restoreFile}
                        style={{ padding: "12px 20px", background: "#d97706", border: "none", borderRadius: 6, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer", width: "100%", opacity: restoreLoading || !restoreFile ? 0.6 : 1 }}
                      >
                        {restoreLoading ? "Restoring..." : "⬆ Restore Database"}
                      </button>
                      {restoreMsg && <div style={{ marginTop: 10, fontSize: 13, color: restoreMsg.includes("success") ? "#15803d" : "#991b1b" }}>{restoreMsg}</div>}
                    </div>

                    <div style={{ fontFamily: "monospace", fontSize: 10, color: "#94a3b8", lineHeight: 1.8 }}>
                      // Last export timestamp will appear in the Audit Log<br />
                      // Passwords are never included in exports<br />
                      // Store exports in a secure location
                    </div>
                  </div>
                </>
              )}

              {/* ── DISPUTES TAB ── */}
              {activeTab === "disputes" && (
                <>
                  <div style={hintBoxStyle("#fffbeb", "#fde68a", "#d97706")}>// User disputes about task completions or ratings. Resolve with action.</div>
                  {disputesLoading && <div style={muteStyle}>Loading disputes...</div>}
                  {!disputesLoading && disputes.length === 0 && <div style={muteStyle}>No disputes raised.</div>}
                  <div style={{ display: "grid", gap: 12 }}>
                    {disputes.map((d) => (
                      <div key={d._id} style={{ background: "#fafafa", border: "1px solid #e2e8f0", borderLeft: `3px solid ${d.status === "pending" ? "#d97706" : "#22c55e"}`, borderRadius: "0 8px 8px 0", padding: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 700, color: "#1e293b" }}>Dispute #{d._id.slice(-6)}</div>
                            <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>Raised by <strong>{d.raised_by_name}</strong> on {new Date(d.created_at).toLocaleString()}</div>
                            <div style={{ marginTop: 6, background: "#fff", border: "1px solid #f1f5f9", borderRadius: 6, padding: 8 }}>
                              <div><strong>Reason:</strong> {d.reason}</div>
                              <div style={{ marginTop: 4 }}><strong>Description:</strong> {d.description}</div>
                              <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 10, color: "#94a3b8" }}>Target: {d.target_type} (task {d.target_id})</div>
                            </div>
                            {d.status !== "pending" && (
                              <div style={{ marginTop: 8, fontFamily: "monospace", fontSize: 11, color: "#15803d" }}>
                                ✓ Resolved: {d.resolution}
                              </div>
                            )}
                          </div>
                          {d.status === "pending" && (
                            <button onClick={() => { setResolveModal({ dispute: d }); setResolveAction("keep"); setResolveResolution(""); }} style={approveBtnStyle}>Resolve</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* ── ANALYTICS TAB ── */}
              {activeTab === "analytics" && (
                <>
                  <div style={hintBoxStyle("#f0fdf4", "#bbf7d0", "#16a34a")}>// Community engagement metrics and task completion trends.</div>
                  {analyticsLoading && <div style={muteStyle}>Loading analytics...</div>}
                  {analytics && (
                    <div style={{ display: "grid", gap: 16 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
                        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, textAlign: "center" }}>
                          <div style={{ fontSize: 11, color: "#64748b" }}>Active Users (7d)</div>
                          <div style={{ fontSize: 28, fontWeight: 700, color: "#ea580c" }}>{analytics.activeUsers}</div>
                        </div>
                        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, textAlign: "center" }}>
                          <div style={{ fontSize: 11, color: "#64748b" }}>Total Users</div>
                          <div style={{ fontSize: 28, fontWeight: 700, color: "#ea580c" }}>{analytics.totalUsers}</div>
                        </div>
                        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, textAlign: "center" }}>
                          <div style={{ fontSize: 11, color: "#64748b" }}>Completion Rate</div>
                          <div style={{ fontSize: 28, fontWeight: 700, color: "#ea580c" }}>{analytics.completionRate}%</div>
                        </div>
                        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, textAlign: "center" }}>
                          <div style={{ fontSize: 11, color: "#64748b" }}>Pending Disputes</div>
                          <div style={{ fontSize: 28, fontWeight: 700, color: analytics.pendingDisputes > 0 ? "#ef4444" : "#22c55e" }}>{analytics.pendingDisputes}</div>
                        </div>
                      </div>
                      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 16 }}>
                        <div style={{ fontFamily: "monospace", fontSize: 11, color: "#ea580c", marginBottom: 12 }}>📊 Tasks Created vs Completed (last 30 days)</div>
                        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8 }}>
                          {analytics.tasksLast30.map((day) => {
                            const completed = analytics.completedLast30.find(c => c._id === day._id)?.count || 0;
                            const maxCount = Math.max(...analytics.tasksLast30.map(d => d.count), ...analytics.completedLast30.map(c => c.count));
                            const heightFactor = 100 / (maxCount || 1);
                            return (
                              <div key={day._id} style={{ minWidth: 50, textAlign: "center" }}>
                                <div style={{ fontSize: 9, color: "#94a3b8", marginBottom: 4 }}>{day._id.slice(5)}</div>
                                <div style={{ display: "flex", gap: 3, justifyContent: "center", alignItems: "flex-end", height: 100 }}>
                                  <div style={{ width: 12, background: "#3b82f6", height: day.count * heightFactor, borderRadius: "3px 3px 0 0" }} title={`Created: ${day.count}`}></div>
                                  <div style={{ width: 12, background: "#22c55e", height: completed * heightFactor, borderRadius: "3px 3px 0 0" }} title={`Completed: ${completed}`}></div>
                                </div>
                                <div style={{ fontSize: 8, marginTop: 4, color: "#64748b" }}>{day.count}/{completed}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ── SIDEBAR ── */}
          <aside style={{ display: "grid", gap: 14, alignContent: "start" }}>
            <div style={panelStyle}>
              <SectionLabel>Top Helpers</SectionLabel>
              {leaderboard.length === 0 && <div style={muteStyle}>No rankings yet.</div>}
              {leaderboard.map((entry, i) => (
                <div key={entry._id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #f1f5f9" }}>
                  <div style={{ fontSize: i < 3 ? 16 : 12, minWidth: 24, textAlign: "center" }}>
                    {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: "#1e293b", fontSize: 13 }}>{entry.name}</div>
                    {entry.totalRatingCount > 0 && <StarRating score={Math.round(entry.averageRating)} size={11} />}
                    {entry.engagementScore > 0 && <div style={{ fontFamily: "monospace", fontSize: 9, color: "#94a3b8", marginTop: 2 }}>Score: {entry.engagementScore}</div>}
                  </div>
                  <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 5, padding: "2px 8px", fontFamily: "monospace", fontSize: 12, color: "#ea580c", fontWeight: 700 }}>
                    {entry.points}
                  </div>
                </div>
              ))}
            </div>

            <div style={panelStyle}>
              <SectionLabel>Dispatcher Info</SectionLabel>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#1e293b" }}>{user?.name}</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{user?.email}</div>
              <RoleBadge role={user?.role} style={{ marginTop: 8 }} />
            </div>

            {error && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderLeft: "3px solid #ef4444", borderRadius: "0 6px 6px 0", padding: "10px 12px", fontSize: 13, color: "#991b1b" }}>
                {error}
              </div>
            )}
          </aside>
        </div>
      </div>

      {/* ── REJECT MODAL ── */}
      {rejectingTask && (
        <div style={modalOverlay}>
          <div style={modalContent}>
            <div style={{ fontFamily: "monospace", fontSize: 9, color: "#94a3b8", marginBottom: 8 }}>// REJECT TASK</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#1e293b", marginBottom: 4 }}>{rejectingTask.title}</div>
            <div style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>The citizen will be notified with the reason below.</div>
            <label style={{ fontFamily: "monospace", fontSize: 10, color: "#64748b", letterSpacing: 1, display: "block", marginBottom: 6 }}>REJECTION REASON</label>
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Did not meet community guidelines..." rows={3} style={inputStyle} />
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button onClick={rejectTask} style={{ flex: 2, padding: "11px 16px", background: "#ef4444", border: "none", borderRadius: 6, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Reject Task</button>
              <button onClick={() => setRejectingTask(null)} style={{ flex: 1, padding: "11px 16px", background: "#fafafa", border: "1px solid #e2e8f0", borderRadius: 6, color: "#64748b", fontSize: 13, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADMIN EDIT TASK MODAL ── */}
      {editingAdminTask && (
        <div style={modalOverlay}>
          <div style={{ ...modalContent, width: 500 }}>
            <div style={{ fontFamily: "monospace", fontSize: 9, color: "#94a3b8", marginBottom: 8 }}>// ADMIN EDIT TASK</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#1e293b", marginBottom: 8 }}>Edit Task</div>
            <div style={{ display: "grid", gap: 12 }}>
              <div><FieldLabel>Title</FieldLabel><input value={editingAdminTask.title} onChange={(e) => setEditingAdminTask({ ...editingAdminTask, title: e.target.value })} style={inputStyle} /></div>
              <div><FieldLabel>Description</FieldLabel><textarea value={editingAdminTask.description || ""} onChange={(e) => setEditingAdminTask({ ...editingAdminTask, description: e.target.value })} rows={3} style={inputStyle} /></div>
              <div><FieldLabel>Category</FieldLabel><select value={editingAdminTask.category} onChange={(e) => setEditingAdminTask({ ...editingAdminTask, category: e.target.value })} style={inputStyle}>{SKILL_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div>
              <div><FieldLabel>Points</FieldLabel><input type="number" value={editingAdminTask.points} onChange={(e) => setEditingAdminTask({ ...editingAdminTask, points: Number(e.target.value) })} style={inputStyle} /></div>
              <div><FieldLabel>Difficulty</FieldLabel><select value={editingAdminTask.difficulty} onChange={(e) => setEditingAdminTask({ ...editingAdminTask, difficulty: e.target.value })} style={inputStyle}>{["Easy", "Medium", "Hard", "Critical"].map(d => <option key={d}>{d}</option>)}</select></div>
              <div><FieldLabel>Urgency</FieldLabel><select value={editingAdminTask.urgency} onChange={(e) => setEditingAdminTask({ ...editingAdminTask, urgency: e.target.value })} style={inputStyle}>{["Low", "Normal", "Urgent", "Critical"].map(u => <option key={u}>{u}</option>)}</select></div>
              <div><FieldLabel>Location</FieldLabel><input value={editingAdminTask.location} onChange={(e) => setEditingAdminTask({ ...editingAdminTask, location: e.target.value })} style={inputStyle} /></div>
              <div><FieldLabel>Deadline</FieldLabel><input type="date" value={editingAdminTask.deadline?.split("T")[0] || ""} onChange={(e) => setEditingAdminTask({ ...editingAdminTask, deadline: e.target.value })} style={inputStyle} /></div>
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button onClick={updateAdminTask} style={approveBtnStyle}>Save Changes</button>
                <button onClick={() => setEditingAdminTask(null)} style={secBtnStyle}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── FLAG USER MODAL ── */}
      {flagModal && (
        <div style={modalOverlay}>
          <div style={modalContent}>
            <div style={{ fontFamily: "monospace", fontSize: 9, color: "#94a3b8", marginBottom: 8 }}>// FLAG USER</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#1e293b", marginBottom: 4 }}>{flagModal.name}</div>
            <div style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>The user will be marked as flagged in the system.</div>
            <label style={{ fontFamily: "monospace", fontSize: 10, color: "#64748b", letterSpacing: 1, display: "block", marginBottom: 6 }}>REASON FOR FLAG</label>
            <textarea value={flagReason} onChange={(e) => setFlagReason(e.target.value)} placeholder="Suspicious behavior..." rows={3} style={inputStyle} />
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button onClick={() => flagUser(flagModal._id, true)} style={{ flex: 2, padding: "11px 16px", background: "#ef4444", border: "none", borderRadius: 6, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Flag User</button>
              <button onClick={() => setFlagModal(null)} style={{ flex: 1, padding: "11px 16px", background: "#fafafa", border: "1px solid #e2e8f0", borderRadius: 6, color: "#64748b", fontSize: 13, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── RESOLVE DISPUTE MODAL ── */}
      {resolveModal && (
        <div style={modalOverlay}>
          <div style={modalContent}>
            <div style={{ fontFamily: "monospace", fontSize: 9, color: "#94a3b8", marginBottom: 8 }}>// RESOLVE DISPUTE</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Dispute by {resolveModal.dispute.raised_by_name}</div>
            <div style={{ marginBottom: 12, background: "#fef2f2", padding: 8, borderRadius: 6, fontSize: 13 }}>{resolveModal.dispute.description}</div>
            <FieldLabel>Resolution Action</FieldLabel>
            <select value={resolveAction} onChange={(e) => setResolveAction(e.target.value)} style={inputStyle}>
              <option value="keep">Keep task/rating as is</option>
              <option value="remove_task">Delete the task</option>
              <option value="remove_rating">Remove the rating</option>
            </select>
            <FieldLabel>Resolution Message (visible to user)</FieldLabel>
            <textarea value={resolveResolution} onChange={(e) => setResolveResolution(e.target.value)} rows={2} style={inputStyle} placeholder="Explain the decision..." />
            <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
              <button onClick={resolveDispute} style={approveBtnStyle}>Resolve</button>
              <button onClick={() => setResolveModal(null)} style={secBtnStyle}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────
function TaskCard({ task, activeTab, isAdmin, selectedTaskIds, toggleTaskSelection, onApprove, onReject, onArchive, onAdminEdit }) {
  return (
    <div style={taskCardStyle(task.status)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
          <input type="checkbox" checked={selectedTaskIds.includes(task._id)} onChange={() => toggleTaskSelection(task._id)} style={{ width: 18, height: 18, cursor: "pointer" }} />
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: "#1e293b" }}>{task.title}</div>
              <StatusPill status={task.status} />
              {task.urgency && task.urgency !== "Normal" && <UrgencyBadge urgency={task.urgency} />}
              {task.deadline && <DeadlineTag deadline={task.deadline} />}
            </div>
            {task.description && <div style={{ fontSize: 13, color: "#64748b", marginBottom: 8, lineHeight: 1.5 }}>{task.description}</div>}
            <div style={fieldGridStyle}>
              <Field label="Category" value={task.category} />
              <Field label="Location" value={task.location} />
              <Field label="Difficulty" value={task.difficulty} />
              <Field label="Posted by" value={task.createdBy || "—"} />
              <Field label="Helper" value={task.acceptedBy || "—"} />
              {task.approvedBy && <Field label="Approved by" value={`${task.approvedBy} · ${new Date(task.approvedAt).toLocaleDateString()}`} />}
              {task.rejectedBy && <Field label="Rejected by" value={task.rejectedBy} />}
              {task.rejectionReason && <Field label="Reason" value={task.rejectionReason} />}
              {task.archivedBy && <Field label="Archived by" value={task.archivedBy} />}
            </div>
            {task.rating?.score && (
              <div style={{ marginTop: 8, background: "#fefce8", border: "1px solid #fde047", borderRadius: 6, padding: "7px 10px" }}>
                <div style={{ fontFamily: "monospace", fontSize: 9, color: "#a16207", marginBottom: 3 }}>CITIZEN RATING</div>
                <StarRating score={task.rating.score} size={14} />
                {task.rating.comment && <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>"{task.rating.comment}"</div>}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, flexShrink: 0 }}>
          <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: "10px 14px", textAlign: "center", minWidth: 76 }}>
            <div style={{ fontFamily: "monospace", fontSize: 9, color: "#92400e", marginBottom: 2 }}>REWARD</div>
            <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: "#ea580c" }}>{task.points}</div>
            <div style={{ fontFamily: "monospace", fontSize: 9, color: "#c2410c" }}>pts</div>
          </div>
          {activeTab === "pending_approval" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button onClick={onApprove} style={approveBtnStyle}>✓ Approve</button>
              <button onClick={onReject} style={rejectBtnStyle}>✕ Reject</button>
              {isAdmin && <button onClick={onAdminEdit} style={secBtnStyle}>✎ Edit</button>}
            </div>
          )}
          {activeTab === "pending_archive" && (
            <>
              <button onClick={onArchive} style={archiveBtnStyle}>✓ Archive & Award</button>
              {isAdmin && <button onClick={onAdminEdit} style={secBtnStyle}>✎ Edit</button>}
            </>
          )}
          {isAdmin && (activeTab === "open" || activeTab === "active") && (
            <button onClick={onAdminEdit} style={secBtnStyle}>✎ Edit</button>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontFamily: "monospace", fontSize: 9, color: "#94a3b8", letterSpacing: 2, marginBottom: 10 }}>// {String(children).toUpperCase()}</div>;
}

function FieldLabel({ children }) {
  return <div style={{ fontFamily: "monospace", fontSize: 10, color: "#64748b", letterSpacing: 1, marginBottom: 5, marginTop: 4 }}>{children}</div>;
}

function Field({ label, value }) {
  return (
    <div>
      <div style={{ fontFamily: "monospace", fontSize: 9, color: "#cbd5e1", letterSpacing: 1, marginBottom: 2 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 13, color: "#475569" }}>{value}</div>
    </div>
  );
}

function ConfigField({ label, hint, value, onChange, disabled, type, step, min, max }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {hint && <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>{hint}</div>}
      <input
        type={type || "text"} step={step} min={min} max={max}
        value={value} disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", padding: "10px 12px", background: disabled ? "#f1f5f9" : "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, color: "#1e293b", fontSize: 13, boxSizing: "border-box" }}
      />
    </div>
  );
}

function RoleBadge({ role }) {
  const cfg = {
    community: { bg: "#eff6ff", border: "#bfdbfe", color: "#1d4ed8", label: "Community" },
    dispatcher: { bg: "#faf5ff", border: "#ddd6fe", color: "#7c3aed", label: "Dispatcher" },
    admin: { bg: "#fffbeb", border: "#fde68a", color: "#d97706", label: "Admin" },
  };
  const c = cfg[role] || cfg.community;
  return <span style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 4, padding: "2px 8px", fontSize: 10, fontFamily: "monospace", fontWeight: 600, color: c.color }}>{c.label}</span>;
}

function StatusPill({ status }) {
  const cfg = {
    pending: { bg: "#faf5ff", color: "#7c3aed", border: "#ddd6fe", label: "Pending" },
    open: { bg: "#fff7ed", color: "#c2410c", border: "#fed7aa", label: "Open" },
    in_progress: { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe", label: "Active" },
    completed: { bg: "#f0fdf4", color: "#15803d", border: "#bbf7d0", label: "Done" },
  };
  const c = cfg[status] || cfg.open;
  return <span style={{ background: c.bg, color: c.color, border: `1px solid ${c.border}`, borderRadius: 4, padding: "2px 8px", fontSize: 10, fontFamily: "monospace", fontWeight: 600 }}>{c.label}</span>;
}

function UrgencyBadge({ urgency }) {
  if (!urgency || urgency === "Normal") return null;
  const cfg = {
    Low: { bg: "#f0fdf4", color: "#15803d", border: "#bbf7d0" },
    Urgent: { bg: "#fefce8", color: "#a16207", border: "#fde047" },
    Critical: { bg: "#fef2f2", color: "#991b1b", border: "#fecaca" },
  };
  const c = cfg[urgency]; if (!c) return null;
  return <span style={{ background: c.bg, color: c.color, border: `1px solid ${c.border}`, borderRadius: 4, padding: "2px 7px", fontSize: 9, fontFamily: "monospace", fontWeight: 600 }}>{urgency.toUpperCase()}</span>;
}

function DeadlineTag({ deadline }) {
  if (!deadline) return null;
  const d = new Date(deadline);
  const diffDays = Math.ceil((d - new Date()) / (1000 * 60 * 60 * 24));
  const color = diffDays < 0 ? "#991b1b" : diffDays <= 1 ? "#a16207" : "#15803d";
  const bg = diffDays < 0 ? "#fef2f2" : diffDays <= 1 ? "#fefce8" : "#f0fdf4";
  const border = diffDays < 0 ? "#fecaca" : diffDays <= 1 ? "#fde047" : "#bbf7d0";
  const label = diffDays < 0 ? "Overdue" : diffDays === 0 ? "Due today" : `Due ${d.toLocaleDateString()}`;
  return <span style={{ background: bg, color, border: `1px solid ${border}`, borderRadius: 4, padding: "2px 7px", fontSize: 9, fontFamily: "monospace", fontWeight: 600 }}>📅 {label}</span>;
}

function StarRating({ score, size = 14 }) {
  return (
    <div style={{ display: "flex", gap: 2 }}>
      {[1, 2, 3, 4, 5].map((s) => (
        <span key={s} style={{ fontSize: size, color: s <= score ? "#f59e0b" : "#e2e8f0", lineHeight: 1 }}>★</span>
      ))}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const pageStyle = { minHeight: "100vh", background: "#f1f5f9", fontFamily: "'DM Sans','Segoe UI',Arial,sans-serif", color: "#1e293b" };
const gridBgStyle = { position: "fixed", inset: 0, backgroundImage: "linear-gradient(#e2e8f0 1px, transparent 1px), linear-gradient(90deg, #e2e8f0 1px, transparent 1px)", backgroundSize: "28px 28px", opacity: 0.5, pointerEvents: "none" };
const headerStyle = { background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 20px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 1px 4px rgba(15,23,42,0.06)" };
const brandStyle = { fontFamily: "monospace", fontSize: 16, letterSpacing: 3, fontWeight: 700, color: "#1e293b" };
const divStyle = { width: 1, height: 18, background: "#e2e8f0" };
const navBtnStyle = { padding: "7px 13px", background: "#fafafa", border: "1px solid #e2e8f0", borderRadius: 6, color: "#64748b", fontFamily: "monospace", fontSize: 10, letterSpacing: 1, cursor: "pointer", textDecoration: "none" };
const dangerBtnStyle = { padding: "7px 13px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#991b1b", fontFamily: "monospace", fontSize: 10, cursor: "pointer" };
const contentStyle = { display: "grid", gridTemplateColumns: "1fr 260px", gap: 20, padding: 20, alignItems: "start" };
const statsBarStyle = { display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" };
const tabBarStyle = { display: "flex", background: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px 8px 0 0", overflowX: "auto" };
const taskAreaStyle = { background: "#fff", border: "1px solid #e2e8f0", borderTop: "none", borderRadius: "0 0 8px 8px", padding: 16, minHeight: 200 };
const panelStyle = { background: "#fff", border: "1px solid #e2e8f0", borderTop: "3px solid #ea580c", borderRadius: "0 0 8px 8px", padding: 16 };
const muteStyle = { fontFamily: "monospace", fontSize: 11, color: "#cbd5e1" };
const fieldGridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 };
const approveBtnStyle = { padding: "9px 16px", background: "#16a34a", border: "none", borderRadius: 6, color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" };
const rejectBtnStyle = { padding: "9px 16px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#991b1b", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" };
const archiveBtnStyle = { padding: "9px 14px", background: "#ea580c", border: "none", borderRadius: 6, color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" };
const secBtnStyle = { padding: "9px 12px", background: "#fafafa", border: "1px solid #e2e8f0", borderRadius: 6, color: "#64748b", fontSize: 12, cursor: "pointer" };
const inputStyle = { width: "100%", padding: "10px 12px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, color: "#1e293b", fontFamily: "inherit", fontSize: 13, boxSizing: "border-box", outline: "none" };
const taskCardStyle = (status) => {
  const colors = { pending: "#7c3aed", open: "#3b82f6", in_progress: "#8b5cf6", completed: "#22c55e" };
  return { background: "#fafafa", border: "1px solid #e2e8f0", borderLeft: `3px solid ${colors[status] || "#e2e8f0"}`, borderRadius: "0 8px 8px 0", padding: 14 };
};
const tabBtnStyle = (active, color) => ({ padding: "11px 14px", background: active ? "#fff" : "#fafafa", border: "none", borderBottom: `2px solid ${active ? color : "transparent"}`, color: active ? color : "#94a3b8", fontFamily: "inherit", fontSize: 13, fontWeight: active ? 600 : 400, cursor: "pointer", display: "flex", alignItems: "center", whiteSpace: "nowrap" });
const hintBoxStyle = (bg, border, color) => ({ background: bg, border: `1px solid ${border}`, borderLeft: `3px solid ${color}`, borderRadius: "0 6px 6px 0", padding: "9px 12px", fontFamily: "monospace", fontSize: 10, color, marginBottom: 14, letterSpacing: 0.5 });
const modalOverlay = { position: "fixed", inset: 0, background: "rgba(15,23,42,0.3)", zIndex: 4000, display: "flex", alignItems: "center", justifyContent: "center" };
const modalContent = { width: 400, background: "#fff", border: "1px solid #e2e8f0", borderTop: "3px solid #ef4444", borderRadius: "0 0 12px 12px", padding: 24, boxShadow: "0 20px 60px rgba(15,23,42,0.15)" };