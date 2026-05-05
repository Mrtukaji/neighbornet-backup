import React, { useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

const SKILL_CATEGORIES = [
  "Gardening", "Plumbing", "Electrical", "Carpentry", "Cleaning", "Cooking",
  "Childcare", "Elderly Care", "Tech Support", "Transport / Errand",
  "Medical / First Aid", "General Labor",
];

const INTEREST_CATEGORIES = [
  "Environment", "Technology", "Health & Wellness", "Education & Tutoring",
  "Social Services", "Arts & Culture", "Sports & Recreation", "Emergency Response", "Animal Care"
];

export default function AuthApp() {
  const [mode, setMode] = useState("login");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const [signupForm, setSignupForm] = useState({
    name: "", email: "", password: "", skills: [], interests: []
  });
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });

  const toggleSkill = (skill) => {
    setSignupForm(prev => ({
      ...prev,
      skills: prev.skills.includes(skill) ? prev.skills.filter(s => s !== skill) : [...prev.skills, skill]
    }));
  };

  const toggleInterest = (interest) => {
    setSignupForm(prev => ({
      ...prev,
      interests: prev.interests.includes(interest) ? prev.interests.filter(i => i !== interest) : [...prev.interests, interest]
    }));
  };

  async function handleSignup(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signupForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Signup failed.");
      setSuccess(data.message);
      setTimeout(() => {
        setMode("login");
        setSignupForm({ name: "", email: "", password: "", skills: [], interests: [] });
        setSuccess("");
      }, 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Login failed.");
      sessionStorage.setItem("neighbornet_token", data.token);
      sessionStorage.setItem("neighbornet_user", JSON.stringify(data.user));
      window.location.href = (data.user.role === "dispatcher" || data.user.role === "admin") ? "/admin" : "/";
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={pageStyle}>
      <div style={gridBgStyle} />
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <div style={brandStyle}>NEIGHBOR<span style={{ color: "#ea580c" }}>NET</span></div>
          <div style={taglineStyle}>Barangay Community Dispatch System</div>
          <div style={onlineStyle}><span style={dotStyle} />System Online</div>
        </div>

        <div style={tabRowStyle}>
          <button onClick={() => { setMode("login"); setError(""); setSuccess(""); }} style={tabStyle(mode === "login")}>Log In</button>
          <button onClick={() => { setMode("signup"); setError(""); setSuccess(""); }} style={tabStyle(mode === "signup")}>Register</button>
        </div>

        {mode === "login" && (
          <form onSubmit={handleLogin} style={formStyle}>
            <FieldLabel>Email Address</FieldLabel>
            <input type="email" placeholder="you@example.com" value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} style={inputStyle} required />
            <FieldLabel>Password</FieldLabel>
            <input type="password" placeholder="••••••••" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} style={inputStyle} required />
            <button type="submit" disabled={loading} style={primaryBtnStyle}>{loading ? "Logging in..." : "Log In →"}</button>
          </form>
        )}

        {mode === "signup" && (
          <form onSubmit={handleSignup} style={formStyle}>
            <FieldLabel>Full Name</FieldLabel>
            <input type="text" placeholder="Your name" value={signupForm.name} onChange={(e) => setSignupForm({ ...signupForm, name: e.target.value })} style={inputStyle} required />
            <FieldLabel>Email Address</FieldLabel>
            <input type="email" placeholder="you@example.com" value={signupForm.email} onChange={(e) => setSignupForm({ ...signupForm, email: e.target.value })} style={inputStyle} required />
            <FieldLabel>Password (min. 6 characters)</FieldLabel>
            <input type="password" placeholder="••••••••" value={signupForm.password} onChange={(e) => setSignupForm({ ...signupForm, password: e.target.value })} style={inputStyle} required minLength={6} />

            <FieldLabel>Helper Skills</FieldLabel>
            <div style={skillGridStyle}>
              {SKILL_CATEGORIES.map(skill => (
                <button key={skill} type="button" onClick={() => toggleSkill(skill)} style={skillChipStyle(signupForm.skills.includes(skill))}>{skill}</button>
              ))}
            </div>

            <FieldLabel>Interests (topics you care about)</FieldLabel>
            <div style={skillGridStyle}>
              {INTEREST_CATEGORIES.map(interest => (
                <button key={interest} type="button" onClick={() => toggleInterest(interest)} style={skillChipStyle(signupForm.interests.includes(interest))}>{interest}</button>
              ))}
            </div>

            <button type="submit" disabled={loading} style={primaryBtnStyle}>{loading ? "Creating Account..." : "Create Account →"}</button>
          </form>
        )}

        {error && <div style={errorStyle}>{error}</div>}
        {success && <div style={successStyle}>{success}</div>}
        <a href="/" style={backLinkStyle}>← Back to map</a>
      </div>
    </div>
  );
}

function FieldLabel({ children }) { return <div style={{ fontFamily: "monospace", fontSize: 10, color: "#64748b", letterSpacing: 1, marginBottom: 5, marginTop: 12 }}>{children}</div>; }

const pageStyle = { minHeight: "100vh", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "'DM Sans', 'Segoe UI', Arial, sans-serif", position: "relative" };
const gridBgStyle = { position: "fixed", inset: 0, backgroundImage: "linear-gradient(#e2e8f0 1px, transparent 1px), linear-gradient(90deg, #e2e8f0 1px, transparent 1px)", backgroundSize: "28px 28px", opacity: 0.6, pointerEvents: "none" };
const cardStyle = { width: "100%", maxWidth: 440, background: "#fff", border: "1px solid #e2e8f0", borderTop: "3px solid #ea580c", borderRadius: "0 0 10px 10px", overflow: "hidden", position: "relative", zIndex: 1, boxShadow: "0 4px 24px rgba(15,23,42,0.08)" };
const cardHeaderStyle = { background: "#fafafa", borderBottom: "1px solid #f1f5f9", padding: "20px 22px 16px" };
const brandStyle = { fontFamily: "monospace", fontSize: 20, letterSpacing: 3, fontWeight: 700, color: "#1e293b" };
const taglineStyle = { fontSize: 12, color: "#94a3b8", marginTop: 4, letterSpacing: 0.3 };
const onlineStyle = { display: "flex", alignItems: "center", fontFamily: "monospace", fontSize: 10, color: "#22c55e", letterSpacing: 1, marginTop: 10 };
const dotStyle = { width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block", marginRight: 6 };
const tabRowStyle = { display: "flex", borderBottom: "1px solid #f1f5f9" };
const tabStyle = (active) => ({ flex: 1, padding: "12px 16px", background: active ? "#fff" : "#fafafa", border: "none", borderBottom: active ? "2px solid #ea580c" : "2px solid transparent", color: active ? "#1e293b" : "#94a3b8", fontFamily: "monospace", fontSize: 12, letterSpacing: 1, cursor: "pointer", fontWeight: active ? 600 : 400 });
const formStyle = { padding: "14px 22px 20px", display: "grid", gap: 3 };
const inputStyle = { width: "100%", padding: "10px 12px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, color: "#1e293b", fontFamily: "inherit", fontSize: 14, boxSizing: "border-box", outline: "none" };
const primaryBtnStyle = { width: "100%", padding: "12px 16px", marginTop: 16, background: "#ea580c", border: "none", borderRadius: 6, color: "#fff", fontFamily: "monospace", fontSize: 12, letterSpacing: 1, fontWeight: 600, cursor: "pointer" };
const skillGridStyle = { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 };
const skillChipStyle = (active) => ({ padding: "5px 11px", borderRadius: 6, border: active ? "1px solid #fdba74" : "1px solid #e2e8f0", background: active ? "#fff7ed" : "#f8fafc", color: active ? "#c2410c" : "#64748b", fontFamily: "inherit", fontSize: 12, fontWeight: active ? 600 : 400, cursor: "pointer" });
const errorStyle = { margin: "0 22px 16px", background: "#fef2f2", border: "1px solid #fecaca", borderLeft: "3px solid #ef4444", borderRadius: "0 6px 6px 0", padding: "10px 12px", fontSize: 13, color: "#991b1b" };
const successStyle = { margin: "0 22px 16px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderLeft: "3px solid #22c55e", borderRadius: "0 6px 6px 0", padding: "10px 12px", fontSize: 13, color: "#15803d" };
const backLinkStyle = { display: "block", textAlign: "center", padding: "13px", background: "#fafafa", borderTop: "1px solid #f1f5f9", fontFamily: "monospace", fontSize: 11, letterSpacing: 1, color: "#94a3b8", textDecoration: "none" };