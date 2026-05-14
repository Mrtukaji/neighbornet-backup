import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import debounce from "debounce";
import io from "socket.io-client";
import { createClient } from "@supabase/supabase-js";

const API_URL = import.meta.env.VITE_API_URL || (window.location.origin.includes('localhost') ? "http://localhost:3000" : window.location.origin);
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const SKILL_CATEGORIES = [
  "Gardening", "Plumbing", "Electrical", "Carpentry", "Cleaning", "Cooking",
  "Childcare", "Elderly Care", "Tech Support", "Transport / Errand",
  "Medical / First Aid", "General Labor",
];

const INTEREST_CATEGORIES = [
  "Environment", "Technology", "Health & Wellness", "Education & Tutoring",
  "Social Services", "Arts & Culture", "Sports & Recreation", "Emergency Response", "Animal Care"
];

const DIFFICULTIES = ["All", "Easy", "Medium", "Hard", "Critical"];
const URGENCIES = ["All", "Low", "Normal", "Urgent", "Critical"];
const STATUSES = ["All", "open", "in_progress", "completed"];
const SORT_OPTIONS = [
  { value: "newest", label: "Newest First" },
  { value: "points_desc", label: "Highest Points" },
  { value: "points_asc", label: "Lowest Points" },
  { value: "deadline_asc", label: "Earliest Deadline" },
];

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// ─── Map helpers ──────────────────────────────────────────────────────────────

function LocationPicker({ isPicking, pickedPosition, setPickedPosition }) {
  useMapEvents({
    click(e) {
      if (!isPicking) return;
      setPickedPosition({ lat: Number(e.latlng.lat.toFixed(6)), lng: Number(e.latlng.lng.toFixed(6)) });
    },
  });
  return pickedPosition
    ? <Marker position={[pickedPosition.lat, pickedPosition.lng]}><Popup>Selected location</Popup></Marker>
    : null;
}

function MapBoundsTracker({ onBoundsChange }) {
  const map = useMap();
  useEffect(() => { onBoundsChange(map.getBounds()); }, [map, onBoundsChange]);
  useMapEvents({
    moveend(e) { onBoundsChange(e.target.getBounds()); },
    zoomend(e) { onBoundsChange(e.target.getBounds()); },
  });
  return null;
}

function MapFocusController({ focusedTask }) {
  const map = useMap();
  useEffect(() => {
    if (!focusedTask || typeof focusedTask.lat !== "number") return;
    map.flyTo([focusedTask.lat, focusedTask.lng], Math.max(map.getZoom(), 16), { duration: 0.8 });
  }, [focusedTask, map]);
  return null;
}

function MyLocationButton({ onLocationError, onLocationSuccess }) {
  const map = useMap();
  const [locating, setLocating] = useState(false);
  const userMarkerRef = useRef(null);

  const clearUserMarker = () => {
    if (userMarkerRef.current) {
      userMarkerRef.current.remove();
      userMarkerRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearUserMarker();
  }, []);

  const handleLocate = () => {
    setLocating(true);
    clearUserMarker();

    if (!navigator.geolocation) {
      onLocationError("Geolocation is not supported by your browser.");
      setLocating(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        if ((Math.abs(latitude) < 0.0001 && Math.abs(longitude) < 0.0001) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
          onLocationError("Received invalid coordinates. Please try again.");
          setLocating(false);
          return;
        }

        const marker = L.marker([latitude, longitude]).addTo(map);
        marker.bindPopup("<b>📍 Your Location</b><br/>You are here.").openPopup();
        userMarkerRef.current = marker;
        map.flyTo([latitude, longitude], 16, { duration: 1.2 });

        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`)
          .then(res => res.json())
          .then(data => {
            if (data.display_name) {
              const shortAddress = data.display_name.split(",").slice(0, 3).join(",");
              onLocationSuccess(`📍 Centered on ${shortAddress}`);
            } else {
              onLocationSuccess(`📍 Centered on lat ${latitude.toFixed(4)}, lng ${longitude.toFixed(4)}`);
            }
          })
          .catch(() => {
            onLocationSuccess(`📍 Centered on lat ${latitude.toFixed(4)}, lng ${longitude.toFixed(4)}`);
          })
          .finally(() => setLocating(false));
      },
      (error) => {
        let msg = "Unable to get your location.";
        if (error.code === 1) msg = "Location access denied. Please allow location in your browser settings.";
        else if (error.code === 2) msg = "Location unavailable. Please try again later.";
        onLocationError(msg);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  return (
    <button onClick={handleLocate} disabled={locating} style={myLocationBtnStyle} title="Center map on your location">
      {locating ? "📍 ..." : "📍 My Location"}
    </button>
  );
}

// ─── Small UI pieces ──────────────────────────────────────────────────────────

function SectionLabel({ children }) {
  return <div style={{ fontFamily: "monospace", fontSize: 9, color: "#94a3b8", letterSpacing: 2, marginBottom: 8 }}>// {children}</div>;
}

function FieldLabel({ children }) {
  return <div style={{ fontFamily: "monospace", fontSize: 10, color: "#64748b", letterSpacing: 1, marginBottom: 4, marginTop: 10 }}>{children}</div>;
}

function StatusPill({ status }) {
  const cfg = {
    pending: { bg: "#faf5ff", color: "#7c3aed", border: "#ddd6fe", label: "Pending" },
    open: { bg: "#fff7ed", color: "#c2410c", border: "#fed7aa", label: "Open" },
    in_progress: { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe", label: "Active" },
    completed: { bg: "#f0fdf4", color: "#15803d", border: "#bbf7d0", label: "Done" },
  };
  const c = cfg[status] || cfg.open;
  return (
    <span style={{ background: c.bg, color: c.color, border: `1px solid ${c.border}`, borderRadius: 4, padding: "2px 8px", fontSize: 10, fontFamily: "monospace", fontWeight: 600, whiteSpace: "nowrap" }}>
      {c.label}
    </span>
  );
}

function UrgencyBadge({ urgency }) {
  if (!urgency || urgency === "Normal") return null;
  const cfg = {
    Low: { bg: "#f0fdf4", color: "#15803d", border: "#bbf7d0" },
    Urgent: { bg: "#fefce8", color: "#a16207", border: "#fde047" },
    Critical: { bg: "#fef2f2", color: "#991b1b", border: "#fecaca" },
  };
  const c = cfg[urgency];
  if (!c) return null;
  return (
    <span style={{ background: c.bg, color: c.color, border: `1px solid ${c.border}`, borderRadius: 4, padding: "2px 7px", fontSize: 9, fontFamily: "monospace", fontWeight: 600 }}>{urgency.toUpperCase()}</span>
  );
}

function StarRating({ score, onChange, size = 20 }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <span
          key={star}
          onClick={() => onChange && onChange(star)}
          onMouseEnter={() => onChange && setHovered(star)}
          onMouseLeave={() => onChange && setHovered(0)}
          style={{ fontSize: size, cursor: onChange ? "pointer" : "default", color: star <= (hovered || score) ? "#f59e0b" : "#e2e8f0", lineHeight: 1 }}
        >
          ★
        </span>
      ))}
    </div>
  );
}

function DeadlineTag({ deadline }) {
  if (!deadline) return null;
  const d = new Date(deadline);
  const now = new Date();
  const diffDays = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
  const color = diffDays < 0 ? "#991b1b" : diffDays <= 1 ? "#a16207" : "#15803d";
  const bg = diffDays < 0 ? "#fef2f2" : diffDays <= 1 ? "#fefce8" : "#f0fdf4";
  const border = diffDays < 0 ? "#fecaca" : diffDays <= 1 ? "#fde047" : "#bbf7d0";
  const label = diffDays < 0 ? "Overdue" : diffDays === 0 ? "Due today" : diffDays === 1 ? "Due tomorrow" : `Due ${d.toLocaleDateString()}`;
  return (
    <span style={{ background: bg, color, border: `1px solid ${border}`, borderRadius: 4, padding: "2px 7px", fontSize: 9, fontFamily: "monospace", fontWeight: 600 }}>
      📅 {label}
    </span>
  );
}

// ─── Rating Modal ─────────────────────────────────────────────────────────────

function RatingModal({ task, onClose, onSubmit }) {
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!score) return;
    setSubmitting(true);
    await onSubmit(task._id, score, comment);
    setSubmitting(false);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.3)", zIndex: 4000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 360, background: "#fff", border: "1px solid #e2e8f0", borderTop: "3px solid #ea580c", borderRadius: "0 0 12px 12px", padding: 24, boxShadow: "0 20px 60px rgba(15,23,42,0.15)" }}>
        <div style={{ fontFamily: "monospace", fontSize: 9, color: "#94a3b8", letterSpacing: 2, marginBottom: 8 }}>// RATE YOUR HELPER</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: "#1e293b", marginBottom: 4 }}>{task.title}</div>
        <div style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>How was {task.acceptedBy}'s help?</div>

        <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <StarRating score={score} onChange={setScore} size={32} />
          {score > 0 && (
            <span style={{ fontFamily: "monospace", fontSize: 11, color: "#ea580c", fontWeight: 600 }}>
              {["", "Poor", "Fair", "Good", "Great", "Excellent"][score]}
            </span>
          )}
        </div>

        <FieldLabel>Leave a comment (optional)</FieldLabel>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Describe how the helper did..."
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
        />

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={handleSubmit} disabled={!score || submitting} style={{ ...primaryBtnStyle, flex: 2, opacity: !score || submitting ? 0.5 : 1 }}>{submitting ? "Submitting..." : "Submit Rating →"}</button>
          <button onClick={onClose} style={{ ...secBtnStyle, flex: 1 }}>Skip</button>
        </div>
      </div>
    </div>
  );
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────

function FilterBar({ filters, onChange }) {
  return (
    <div style={filterBarStyle}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          placeholder="Search tasks..."
          style={{ ...filterInputStyle, minWidth: 160 }}
        />
        <FilterSelect label="Category" value={filters.category} options={["All", ...SKILL_CATEGORIES]} onChange={(v) => onChange({ ...filters, category: v })} />
        <FilterSelect label="Difficulty" value={filters.difficulty} options={DIFFICULTIES} onChange={(v) => onChange({ ...filters, difficulty: v })} />
        <FilterSelect label="Urgency" value={filters.urgency} options={URGENCIES} onChange={(v) => onChange({ ...filters, urgency: v })} />
        <FilterSelect label="Status" value={filters.status} options={STATUSES} onChange={(v) => onChange({ ...filters, status: v })} />
        <FilterSelect label="Sort" value={filters.sort} options={SORT_OPTIONS.map((o) => o.value)} labels={SORT_OPTIONS.map((o) => o.label)} onChange={(v) => onChange({ ...filters, sort: v })} />

        {(filters.search || filters.category !== "All" || filters.difficulty !== "All" || filters.urgency !== "All" || filters.status !== "All") && (
          <button onClick={() => onChange({ search: "", category: "All", difficulty: "All", urgency: "All", status: "All", sort: "newest" })} style={clearBtnStyle}>
            × Clear
          </button>
        )}
      </div>
    </div>
  );
}

function FilterSelect({ label, value, options, labels, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={filterSelectStyle} title={label}>
      {options.map((o, i) => (
        <option key={o} value={o}>{labels ? labels[i] : o === "All" ? `All ${label}` : o}</option>
      ))}
    </select>
  );
}

// ─── Dispute Modal ───────────────────────────────────────────────────────────

function DisputeModal({ task, onClose, onSubmit }) {
  const [activeTab, setActiveTab] = useState("map"); // map, list, my_tasks
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!reason || !description) return;
    setSubmitting(true);
    await onSubmit(task._id, reason, description);
    setSubmitting(false);
  };

  return (
    <div style={modalOverlayStyle}>
      <div style={{ ...modalCardStyle, maxWidth: 420 }}>
        <div style={{ fontFamily: "monospace", fontSize: 9, color: "#d97706", marginBottom: 8 }}>// RAISE DISPUTE</div>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>{task.title}</div>
        <div style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>Describe the issue for moderator review.</div>
        <div style={{ fontFamily: "monospace", fontSize: 10, color: "#64748b", letterSpacing: 1, marginBottom: 5, marginTop: 10 }}>Reason *</div>
        <select value={reason} onChange={(e) => setReason(e.target.value)} style={inputStyle}>
          <option value="">Select a reason</option>
          <option value="Unfair rating">Unfair rating</option>
          <option value="Task not completed properly">Task not completed properly</option>
          <option value="Wrong points awarded">Wrong points awarded</option>
          <option value="Other">Other</option>
        </select>
        <div style={{ fontFamily: "monospace", fontSize: 10, color: "#64748b", letterSpacing: 1, marginBottom: 5, marginTop: 10 }}>Description *</div>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={inputStyle} placeholder="Provide details..." />
        <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
          <button onClick={handleSubmit} disabled={!reason || !description || submitting} style={primaryBtnStyle}>{submitting ? "Submitting..." : "Submit Dispute →"}</button>
          <button onClick={onClose} style={secBtnStyle}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Evidence Upload Modal ────────────────────────────────────────────────────

const MAX_FILES = 5;
const MAX_SIZE_MB = 5;

function EvidenceUploadModal({ task, onClose, onSubmitWithEvidence, onSubmitWithout, uploading, uploadProgress }) {
  const [files, setFiles] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [validationError, setValidationError] = useState("");

  function addFiles(newFiles) {
    setValidationError("");
    const valid = [];
    for (const f of newFiles) {
      if (!f.type.startsWith("image/")) { setValidationError("Only image files are allowed."); continue; }
      if (f.size > MAX_SIZE_MB * 1024 * 1024) { setValidationError(`"${f.name}" exceeds ${MAX_SIZE_MB}MB limit.`); continue; }
      if (files.length + valid.length >= MAX_FILES) { setValidationError(`Maximum ${MAX_FILES} photos allowed.`); break; }
      valid.push(f);
    }
    setFiles(prev => [...prev, ...valid]);
  }

  function removeFile(idx) {
    setFiles(prev => prev.filter((_, i) => i !== idx));
    setValidationError("");
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    addFiles(Array.from(e.dataTransfer.files));
  }

  return (
    <div style={modalOverlayStyle}>
      <div style={{ ...modalCardStyle, maxWidth: 480, padding: 0, overflow: "hidden" }}>
        <div style={{ background: "#fafafa", borderBottom: "1px solid #f1f5f9", padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontFamily: "monospace", fontSize: 9, color: "#16a34a", letterSpacing: 2, marginBottom: 3 }}>// TASK COMPLETE</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1e293b" }}>{task.title}</div>
          </div>
          <button onClick={onClose} disabled={uploading} style={closeBtnStyle}>×</button>
        </div>

        <div style={{ padding: "18px 18px 16px" }}>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 16, lineHeight: 1.6 }}>
            Upload photos as evidence of task completion. This helps build trust and earns you better ratings.
          </div>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => document.getElementById("evidence-file-input").click()}
            style={{ border: `2px dashed ${dragOver ? "#16a34a" : "#cbd5e1"}`, borderRadius: 10, padding: "24px 16px", textAlign: "center", cursor: "pointer", background: dragOver ? "#f0fdf4" : "#f8fafc", transition: "all 0.15s ease", marginBottom: 14 }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>📸</div>
            <div style={{ fontWeight: 600, color: "#1e293b", fontSize: 14, marginBottom: 4 }}>
              {dragOver ? "Drop photos here" : "Drag & drop photos or click to browse"}
            </div>
            <div style={{ fontFamily: "monospace", fontSize: 10, color: "#94a3b8" }}>
              Up to {MAX_FILES} photos · Max {MAX_SIZE_MB}MB each · JPG, PNG, WEBP
            </div>
            <input id="evidence-file-input" type="file" multiple accept="image/*" style={{ display: "none" }} onChange={(e) => addFiles(Array.from(e.target.files))} />
          </div>

          {validationError && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "8px 12px", fontSize: 12, color: "#991b1b", marginBottom: 12 }}>
              ⚠ {validationError}
            </div>
          )}

          {files.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 8, marginBottom: 16 }}>
              {files.map((file, idx) => (
                <div key={idx} style={{ position: "relative", borderRadius: 8, overflow: "hidden", aspectRatio: "1", border: "1px solid #e2e8f0" }}>
                  <img src={URL.createObjectURL(file)} alt={`Preview ${idx + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  {uploading && uploadProgress?.current === idx && (
                    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <div style={{ color: "#fff", fontFamily: "monospace", fontSize: 10 }}>Uploading...</div>
                    </div>
                  )}
                  {uploading && uploadProgress?.done?.includes(idx) && (
                    <div style={{ position: "absolute", inset: 0, background: "rgba(22,163,74,0.7)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <div style={{ color: "#fff", fontSize: 20 }}>✓</div>
                    </div>
                  )}
                  {!uploading && (
                    <button onClick={(e) => { e.stopPropagation(); removeFile(idx); }} style={{ position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: "50%", background: "rgba(15,23,42,0.75)", border: "none", color: "#fff", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>×</button>
                  )}
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.45)", padding: "3px 5px" }}>
                    <div style={{ fontFamily: "monospace", fontSize: 8, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file.name}</div>
                  </div>
                </div>
              ))}
              {files.length < MAX_FILES && !uploading && (
                <div onClick={() => document.getElementById("evidence-file-input").click()} style={{ borderRadius: 8, border: "2px dashed #cbd5e1", display: "flex", alignItems: "center", justifyContent: "center", aspectRatio: "1", cursor: "pointer", color: "#94a3b8", fontSize: 24, background: "#f8fafc" }}>+</div>
              )}
            </div>
          )}

          {uploading && uploadProgress && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontFamily: "monospace", fontSize: 10, color: "#64748b" }}>Uploading {(uploadProgress.done?.length || 0) + 1} of {files.length}...</span>
                <span style={{ fontFamily: "monospace", fontSize: 10, color: "#16a34a" }}>{Math.round(((uploadProgress.done?.length || 0) / files.length) * 100)}%</span>
              </div>
              <div style={{ height: 4, background: "#e2e8f0", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", background: "#16a34a", borderRadius: 2, width: `${((uploadProgress.done?.length || 0) / files.length) * 100}%`, transition: "width 0.3s ease" }} />
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => files.length ? onSubmitWithEvidence(task._id, files) : setValidationError("Select at least one photo, or use Skip.")}
              disabled={uploading || files.length === 0}
              style={{ ...primaryBtnStyle, flex: 2, background: "#16a34a", opacity: (uploading || files.length === 0) ? 0.5 : 1 }}
            >
              {uploading ? "Uploading..." : `✓ Submit with ${files.length} Photo${files.length !== 1 ? "s" : ""}`}
            </button>
            <button onClick={() => onSubmitWithout(task._id)} disabled={uploading} style={{ ...secBtnStyle, flex: 1, opacity: uploading ? 0.5 : 1 }}>Skip</button>
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 9, color: "#94a3b8", textAlign: "center", marginTop: 8 }}>// Skipping is allowed but may affect your rating</div>
        </div>
      </div>
    </div>
  );
}

// ─── Evidence Lightbox ────────────────────────────────────────────────────────

function EvidenceLightbox({ images, startIndex, onClose }) {
  const [current, setCurrent] = useState(startIndex);
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setCurrent(c => Math.min(c + 1, images.length - 1));
      if (e.key === "ArrowLeft") setCurrent(c => Math.max(c - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [images.length, onClose]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(5,10,20,0.92)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <button onClick={onClose} style={{ position: "absolute", top: 18, right: 22, background: "none", border: "none", color: "#fff", fontSize: 28, cursor: "pointer", zIndex: 1 }}>×</button>
      {images.length > 1 && current > 0 && (
        <button onClick={(e) => { e.stopPropagation(); setCurrent(c => c - 1); }} style={{ position: "absolute", left: 18, background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: 26, width: 44, height: 44, borderRadius: "50%", cursor: "pointer" }}>‹</button>
      )}
      <img src={images[current]} alt={`Evidence ${current + 1}`} onClick={(e) => e.stopPropagation()} style={{ maxWidth: "90vw", maxHeight: "88vh", objectFit: "contain", borderRadius: 8, boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }} />
      {images.length > 1 && current < images.length - 1 && (
        <button onClick={(e) => { e.stopPropagation(); setCurrent(c => c + 1); }} style={{ position: "absolute", right: 18, background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: 26, width: 44, height: 44, borderRadius: "50%", cursor: "pointer" }}>›</button>
      )}
      <div style={{ position: "absolute", bottom: 18, fontFamily: "monospace", fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{current + 1} / {images.length}</div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [user, setUser] = useState(() => {
    const s = sessionStorage.getItem("neighbornet_user");
    return s ? JSON.parse(s) : null;
  });
  const [token] = useState(sessionStorage.getItem("neighbornet_token") || "");
  const [tasks, setTasks] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  const [focusedTask, setFocusedTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ratingTask, setRatingTask] = useState(null);
  const [flaggingTask, setFlaggingTask] = useState(null);
  const [toast, setToast] = useState(null);

  const [showPostPanel, setShowPostPanel] = useState(false);
  const [showTaskList, setShowTaskList] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [chatWithUser, setChatWithUser] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");

  // Task form
  const [category, setCategory] = useState(SKILL_CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [points, setPoints] = useState(10);
  const [difficulty, setDifficulty] = useState("Easy");
  const [urgency, setUrgency] = useState("Normal");
  const [deadline, setDeadline] = useState("");
  const [location, setLocation] = useState("");
  const [pickedPosition, setPickedPosition] = useState(null);
  const [editingTask, setEditingTask] = useState(null);

  // Filters
  const [filters, setFilters] = useState({ search: "", category: "All", difficulty: "All", urgency: "All", status: "All", sort: "newest" });

  const [mapBounds, setMapBounds] = useState(null);
  const onBoundsChange = useCallback((b) => setMapBounds(b), []);

  const [notifications, setNotifications] = useState([]);
  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);
  const notifPollRef = useRef(null);
  const [socket, setSocket] = useState(null);

  const [leaderboard, setLeaderboard] = useState([]);
  const [editingSkills, setEditingSkills] = useState(false);
  const [draftSkills, setDraftSkills] = useState([]);
  const [editingInterests, setEditingInterests] = useState(false);
  const [draftInterests, setDraftInterests] = useState([]);
  const [customSkillProfile, setCustomSkillProfile] = useState("");
  const [customInterestProfile, setCustomInterestProfile] = useState("");

  // Comments
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState("");

  // Dispute & Redeem
  const [disputeTask, setDisputeTask] = useState(null);
  const [showRedeemModal, setShowRedeemModal] = useState(false);

  // Image evidence
  const [showImageUploader, setShowImageUploader] = useState(false);
  const [selectedImages, setSelectedImages] = useState([]);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);

  // Derived lists
  const activeTasks = useMemo(() => tasks.filter((t) => !t.archived && t.status !== "pending"), [tasks]);
  const visibleActiveTasks = useMemo(() => {
    let filtered = activeTasks;
    if (mapBounds) {
      filtered = activeTasks.filter((t) => typeof t.lat === "number" && mapBounds.contains([t.lat, t.lng]));
    }
    if (user?.skills || user?.interests) {
      const uSkills = user.skills || [];
      const uInt = user.interests || [];
      return [...filtered].sort((a, b) => {
        const aMatch = uSkills.includes(a.category) || uInt.includes(a.category) ? 1 : 0;
        const bMatch = uSkills.includes(b.category) || uInt.includes(b.category) ? 1 : 0;
        if (bMatch !== aMatch) return bMatch - aMatch;
        // Secondary sort: Urgency
        const urgencyScore = { Critical: 3, Hard: 2, Medium: 1, Easy: 0 };
        return (urgencyScore[b.urgency] || 0) - (urgencyScore[a.urgency] || 0);
      });
    }
    return filtered;
  }, [activeTasks, mapBounds, user]);

  const myPosts = useMemo(() => !user ? [] : tasks.filter((t) => t.createdBy === user.name), [tasks, user]);
  const tasksIHelped = useMemo(() => !user ? [] : tasks.filter((t) => t.acceptedBy === user.name), [tasks, user]);
  const ratableTasks = useMemo(() => {
    if (!user) return [];
    return tasks.filter((t) =>
      t.createdBy === user.name &&
      (t.status === "completed" || t.archived) &&
      t.acceptedByUserId &&
      !t.rating_score
    );
  }, [tasks, user]);
  const myHistory = useMemo(() => {
    if (!user) return [];
    return tasks
      .filter((t) => t.archived && (t.createdBy === user.name || t.acceptedBy === user.name))
      .sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt));
  }, [tasks, user]);

  // Fetch tasks
  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.search) params.set("search", filters.search);
      if (filters.category !== "All") params.set("category", filters.category);
      if (filters.difficulty !== "All") params.set("difficulty", filters.difficulty);
      if (filters.urgency !== "All") params.set("urgency", filters.urgency);
      if (filters.status !== "All") params.set("status", filters.status);
      if (filters.sort) params.set("sort", filters.sort);

      const res = await fetch(`${API_URL}/tasks?${params}`);
      const data = await res.json();
      setTasks(data);
      setSelectedTask((prev) => {
        if (!data.length) return null;
        if (prev) return data.find((t) => t._id === prev._id) || null;
        return data.find((t) => t.status === "open") || null;
      });
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [filters]);

  const debouncedFetch = useCallback(debounce(() => fetchTasks(), 300), [fetchTasks]);

  // WebSocket
  useEffect(() => {
    if (token && user) {
      const newSocket = io(API_URL, { auth: { userId: user._id } });
      setSocket(newSocket);
      newSocket.on("new_notification", (notif) => {
        setNotifications(prev => [notif, ...prev]);
        showToast(notif.message, "info");
      });
      newSocket.on("new_message", (msg) => {
        if (chatWithUser && (msg.fromUserId === chatWithUser.userId || msg.toUserId === chatWithUser.userId)) {
          setChatMessages(prev => [...prev, msg]);
        }
        showToast(`New message from ${msg.fromUserName}`, "info");
      });
      newSocket.on("new_comment", (comment) => {
        if (selectedTask && comment.taskId === selectedTask._id) {
          setComments(prev => [...prev, comment]);
        }
      });
      return () => newSocket.disconnect();
    }
  }, [token, user]);

  useEffect(() => { if (selectedTask) fetchComments(selectedTask._id); }, [selectedTask]);

  async function fetchComments(taskId) {
    try {
      const res = await fetch(`${API_URL}/tasks/${taskId}/comments`, { headers: authHeaders });
      if (res.ok) setComments(await res.json());
    } catch { }
  }

  async function postComment(e) {
    e.preventDefault();
    if (!commentText.trim() || !selectedTask) return;
    try {
      const res = await fetch(`${API_URL}/tasks/${selectedTask._id}/comments`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ text: commentText }),
      });
      if (res.ok) {
        const newComment = await res.json();
        setComments(prev => [...prev, newComment]);
        setCommentText("");
      }
    } catch { }
  }

  async function fetchMyProfile() {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setUser(data);
      sessionStorage.setItem("neighbornet_user", JSON.stringify(data));
      if (data.role === "dispatcher" || data.role === "admin") window.location.href = "/admin";
    } catch {
      sessionStorage.removeItem("neighbornet_token");
      sessionStorage.removeItem("neighbornet_user");
      window.location.href = "/auth";
    }
  }

  async function fetchNotifications() {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/notifications`, { headers: authHeaders });
      if (res.ok) setNotifications(await res.json());
    } catch { }
  }

  async function markAllRead() {
    if (!token) return;
    await fetch(`${API_URL}/notifications/read-all`, { method: "PUT", headers: jsonHeaders });
    setNotifications((p) => p.map((n) => ({ ...n, read: true })));
  }

  async function fetchLeaderboard() {
    try {
      const res = await fetch(`${API_URL}/leaderboard`);
      if (res.ok) setLeaderboard(await res.json());
    } catch { }
  }

  function showToast(message, type = "info") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  const authHeaders = { Authorization: `Bearer ${token}` };
  const jsonHeaders = { "Content-Type": "application/json", ...authHeaders };

  // Image upload helper
  async function uploadEvidenceImage(file, taskId) {
    const fileExt = file.name.split('.').pop();
    const fileName = `${taskId}/${Date.now()}.${fileExt}`;
    const { data, error } = await supabase.storage
      .from('task-evidence')
      .upload(fileName, file, { cacheControl: '3600', upsert: false });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from('task-evidence').getPublicUrl(fileName);
    return publicUrl;
  }

  async function completeTaskWithEvidence(taskId, evidenceFiles) {
    if (!evidenceFiles.length) {
      return completeTask(taskId);
    }
    setUploadingEvidence(true);
    try {
      const uploadPromises = evidenceFiles.map(file => uploadEvidenceImage(file, taskId));
      const imageUrls = await Promise.all(uploadPromises);
      const res = await fetch(`${API_URL}/tasks/${taskId}/complete`, {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ evidenceImages: imageUrls }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setTasks((p) => p.map((t) => t._id === data._id ? data : t));
      setSelectedTask(data);
      setShowImageUploader(false);
      setSelectedImages([]);
      showToast("Task completed with evidence!", "success");
    } catch (err) { setError(err.message); }
    finally { setUploadingEvidence(false); }
  }

  async function createOrUpdateTask(e) {
    e.preventDefault();
    setError("");
    if (!category) return setError("Category is required.");
    if (!pickedPosition) return setError("Click the map to set a location.");
    try {
      const url = editingTask ? `${API_URL}/tasks/${editingTask._id}` : `${API_URL}/tasks`;
      const method = editingTask ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: jsonHeaders,
        body: JSON.stringify({ title: category, category, description, points: Number(points), difficulty, urgency, deadline: deadline || null, location, lat: pickedPosition.lat, lng: pickedPosition.lng }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setShowPostPanel(false);
      setEditingTask(null);
      resetForm();
      fetchTasks();
      showToast(editingTask ? "Task updated!" : "Task submitted! It will appear after approval.", "success");
    } catch (err) { setError(err.message); }
  }

  async function deleteTask(taskId) {
    if (!window.confirm("Are you sure you want to delete this task?")) return;
    try {
      const res = await fetch(`${API_URL}/tasks/${taskId}`, { method: "DELETE", headers: authHeaders });
      if (!res.ok) throw new Error((await res.json()).message);
      fetchTasks();
      showToast("Task deleted.", "success");
    } catch (err) { setError(err.message); }
  }

  async function flagTask(taskId, reason) {
    try {
      const res = await fetch(`${API_URL}/tasks/${taskId}/flag`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      setFlaggingTask(null);
      showToast("Task flagged. A moderator will review it.", "info");
    } catch (err) { setError(err.message); }
  }

  async function acceptTask(id) {
    try {
      const res = await fetch(`${API_URL}/tasks/${id}/accept`, { method: "PUT", headers: authHeaders });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setTasks((p) => p.map((t) => t._id === data._id ? data : t));
      setSelectedTask(data);
    } catch (err) { setError(err.message); }
  }

  async function completeTask(id) {
    try {
      const res = await fetch(`${API_URL}/tasks/${id}/complete`, { method: "PUT", headers: jsonHeaders, body: JSON.stringify({ evidenceImages: [] }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setTasks((p) => p.map((t) => t._id === data._id ? data : t));
      setSelectedTask(data);
      showToast("Task marked as completed! Evidence not required.", "success");
    } catch (err) { setError(err.message); }
  }

  async function submitRating(taskId, score, comment) {
    try {
      const res = await fetch(`${API_URL}/tasks/${taskId}/rate`, {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ score, comment }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setTasks((p) => p.map((t) => t._id === data._id ? data : t));
      setRatingTask(null);
      showToast("Thank you for rating!", "success");
    } catch (err) { setError(err.message); }
  }

  async function saveSkills() {
    try {
      const res = await fetch(`${API_URL}/auth/update-skills`, {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ skills: draftSkills }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setUser(data);
      sessionStorage.setItem("neighbornet_user", JSON.stringify(data));
      setEditingSkills(false);
    } catch (err) { setError(err.message); }
  }

  async function saveInterests() {
    try {
      const res = await fetch(`${API_URL}/auth/update-interests`, {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ interests: draftInterests }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setUser(data);
      sessionStorage.setItem("neighbornet_user", JSON.stringify(data));
      setEditingInterests(false);
    } catch (err) { setError(err.message); }
  }

  async function fetchConversation(otherUserId) {
    try {
      const res = await fetch(`${API_URL}/messages/${otherUserId}`, { headers: authHeaders });
      if (res.ok) setChatMessages(await res.json());
    } catch { }
  }

  async function sendMessage() {
    if (!chatInput.trim() || !chatWithUser) return;
    try {
      const res = await fetch(`${API_URL}/messages`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ toUserId: chatWithUser.userId, taskId: selectedTask?._id || null, content: chatInput }),
      });
      if (res.ok) {
        const msg = await res.json();
        setChatMessages(prev => [...prev, msg]);
        setChatInput("");
      }
    } catch { }
  }

  async function raiseDispute(taskId, reason, description) {
    try {
      const res = await fetch(`${API_URL}/disputes`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          targetType: "task",
          targetId: taskId,
          reason,
          description,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      setDisputeTask(null);
      showToast("Dispute submitted. A moderator will review it.", "success");
    } catch (err) { setError(err.message); }
  }

  function resetForm() {
    setTitle(""); setDescription(""); setPoints(10); setDifficulty("Easy");
    setUrgency("Normal"); setDeadline(""); setCategory(SKILL_CATEGORIES[0]);
    setLocation(""); setPickedPosition(null); setEditingTask(null);
  }

  function logout() { sessionStorage.removeItem("neighbornet_token"); sessionStorage.removeItem("neighbornet_user"); window.location.href = "/auth"; }

  useEffect(() => {
    if (!token) { window.location.href = "/auth"; return; }
    fetchMyProfile();
    fetchNotifications();
    notifPollRef.current = setInterval(fetchNotifications, 30000);
    return () => clearInterval(notifPollRef.current);
  }, []);

  useEffect(() => { debouncedFetch(); }, [filters, debouncedFetch]);
  useEffect(() => { if (showLeaderboard) fetchLeaderboard(); }, [showLeaderboard]);
  useEffect(() => {
    if (showNotifications && unreadCount > 0) {
      const t = setTimeout(markAllRead, 1500);
      return () => clearTimeout(t);
    }
  }, [showNotifications, unreadCount]);

  // Render
  return (
    <div style={pageStyle}>
      <div style={gridBgStyle} />
      <div style={shellStyle}>

        {/* HEADER */}
        <header style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={brandStyle}>NEIGHBOR<span style={{ color: "#ea580c" }}>NET</span></div>
            <div style={divStyle} />
            <div style={sysLabelStyle}><span style={dotStyle} />Online</div>
            <div style={divStyle} />
            <HdrBtn active={showTaskList} onClick={() => { setShowTaskList(p => !p); setShowPostPanel(false); }}>Tasks</HdrBtn>
            <HdrBtn active={showFilters} onClick={() => setShowFilters(p => !p)}>Filters {(filters.search || filters.category !== "All" || filters.difficulty !== "All" || filters.urgency !== "All" || filters.status !== "All") ? "●" : ""}</HdrBtn>
            <HdrBtn active={showLeaderboard} onClick={() => { setShowLeaderboard(p => !p); setShowNotifications(false); }}>Leaderboard</HdrBtn>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {ratableTasks.length > 0 && (
              <button onClick={() => setRatingTask(ratableTasks[0])} style={ratingPromptStyle}>
                ★ Rate a helper ({ratableTasks.length})
              </button>
            )}
            <button onClick={() => { setShowPostPanel(p => !p); setShowTaskList(false); setEditingTask(null); resetForm(); }} style={postBtnStyle}>
              + Post Task
            </button>

            <div style={{ position: "relative" }}>
              <button onClick={() => { setShowNotifications(p => !p); setShowLeaderboard(false); }} style={iconBtnStyle}>
                🔔
                {unreadCount > 0 && <span style={badgeStyle}>{unreadCount > 9 ? "9+" : unreadCount}</span>}
              </button>
              {showNotifications && (
                <div style={notifDropStyle}>
                  <SectionLabel>Notifications</SectionLabel>
                  {notifications.length === 0 && <div style={muteStyle}>No notifications yet.</div>}
                  <div style={{ display: "grid", gap: 6, maxHeight: 320, overflowY: "auto" }}>
                    {notifications.map((n) => (
                      <div key={n._id} style={{ background: n.read ? "#fafafa" : "#fff7ed", border: `1px solid ${n.read ? "#f1f5f9" : "#fed7aa"}`, borderLeft: `3px solid ${n.read ? "#e2e8f0" : "#ea580c"}`, borderRadius: "0 6px 6px 0", padding: "9px 10px" }}>
                        <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.4 }}>{n.message}</div>
                        <div style={{ fontFamily: "monospace", fontSize: 10, color: "#94a3b8", marginTop: 4 }}>{new Date(n.createdAt).toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div style={ptsBadgeStyle}>⭐ {user?.points ?? 0} pts</div>
            <button onClick={() => setShowProfile(p => !p)} style={iconBtnStyle}>👤</button>
            <button onClick={logout} style={logoutBtnStyle}>Logout</button>
          </div>
        </header>

        {showFilters && <FilterBar filters={filters} onChange={setFilters} />}

        {/* LEADERBOARD MODAL */}
        {showLeaderboard && (
          <div style={overlayBgStyle}>
            <div style={modalCardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <div>
                  <SectionLabel>Community Rankings</SectionLabel>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#1e293b" }}>Top Helpers</div>
                </div>
                <button onClick={() => setShowLeaderboard(false)} style={closeBtnStyle}>×</button>
              </div>
              {leaderboard.length === 0 && <div style={muteStyle}>No rankings yet.</div>}
              <div style={{ display: "grid", gap: 8 }}>
                {leaderboard.map((entry, i) => (
                  <div key={entry._id} style={{ display: "flex", alignItems: "center", gap: 12, background: i < 3 ? ["#fff7ed", "#f8fafc", "#fdf4ff"][i] : "#fafafa", border: "1px solid #e2e8f0", borderLeft: `3px solid ${["#ea580c", "#94a3b8", "#a855f7"][i] || "#e2e8f0"}`, borderRadius: "0 8px 8px 0", padding: "12px 14px" }}>
                    <div style={{ fontSize: i < 3 ? 18 : 13, minWidth: 28 }}>
                      {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, color: "#1e293b" }}>{entry.name}</div>
                      {entry.totalRatingCount > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                          <StarRating score={Math.round(entry.averageRating)} size={12} />
                          <span style={{ fontFamily: "monospace", fontSize: 10, color: "#94a3b8" }}>
                            {entry.averageRating} ({entry.totalRatingCount} ratings)
                          </span>
                        </div>
                      )}
                      {entry.engagementScore > 0 && (
                        <div style={{ fontFamily: "monospace", fontSize: 9, color: "#7c3aed", marginTop: 2 }}>📊 Score: {entry.engagementScore}</div>
                      )}
                      {entry.skills?.length > 0 && (
                        <div style={{ fontFamily: "monospace", fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
                          {entry.skills.slice(0, 3).join(" · ")}
                        </div>
                      )}
                    </div>
                    <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 6, padding: "6px 12px", textAlign: "center" }}>
                      <div style={{ fontFamily: "monospace", fontSize: 18, fontWeight: 700, color: "#ea580c" }}>{entry.points}</div>
                      <div style={{ fontFamily: "monospace", fontSize: 9, color: "#c2410c" }}>pts</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* MAIN MAP COLUMN */}
        <div style={mainLayoutStyle}>
          <div style={mapColumnStyle}>
            <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
              <MapContainer center={[14.829, 120.282]} zoom={13} style={{ height: "100%", width: "100%" }}>
                <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <MapBoundsTracker onBoundsChange={onBoundsChange} />
                <MapFocusController focusedTask={focusedTask} />
                <LocationPicker isPicking={showPostPanel} pickedPosition={pickedPosition} setPickedPosition={setPickedPosition} />
                <MyLocationButton
                  onLocationError={(msg) => showToast(msg, "error")}
                  onLocationSuccess={(msg) => showToast(msg, "success")}
                />
                {activeTasks.filter((t) => typeof t.lat === "number").map((t) => (
                  <Marker
                    key={t._id}
                    position={[t.lat, t.lng]}
                    eventHandlers={{ click: () => { setSelectedTask(t); setFocusedTask(t); } }}
                  >
                    <Popup>
                      <div style={{ minWidth: 180 }}>
                        <strong>{t.title}</strong>
                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                          {t.category} · {t.points} pts · {t.location}
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>

              <div style={mapTagStyle}><span style={{ color: "#ea580c", marginRight: 5 }}>|</span>Ops Map // Olongapo Sector</div>

              {/* CREATE/EDIT TASK PANEL */}
              {showPostPanel && (
                <div style={floatPanelStyle}>
                  <PanelHeader title={editingTask ? "Edit Task" : "Post a Task"} onClose={() => { setShowPostPanel(false); setPickedPosition(null); setEditingTask(null); }} />
                  <div style={{ fontFamily: "monospace", fontSize: 10, color: "#94a3b8", marginTop: 6, marginBottom: 2, background: "#fff7ed", border: "1px solid #fed7aa", borderLeft: "3px solid #ea580c", borderRadius: "0 6px 6px 0", padding: "7px 10px" }}>
                    {editingTask ? "Edit your pending task. Changes will be reviewed." : "Your task will be reviewed by a dispatcher before going live."}
                  </div>
                  <form onSubmit={createOrUpdateTask} style={{ display: "grid", gap: 2, marginTop: 6 }}>
                    <FieldLabel>Category *</FieldLabel>
                    <select value={category} onChange={(e) => setCategory(e.target.value)} style={{...inputStyle, fontWeight: 700}}>
                      <option value="" disabled>Select category...</option>
                      {SKILL_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                      {INTEREST_CATEGORIES.filter(i => !SKILL_CATEGORIES.includes(i)).map(c => <option key={c}>{c}</option>)}
                    </select>
                    <FieldLabel>Description (optional)</FieldLabel>
                    <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="More details..." rows={2} style={{ ...inputStyle, resize: "vertical" }} />
                    <FieldLabel>Location / Barangay *</FieldLabel>
                    <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Brgy. name or area" style={inputStyle} />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div>
                        <FieldLabel>Difficulty</FieldLabel>
                        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} style={inputStyle}>
                          {["Easy", "Medium", "Hard", "Critical"].map((d) => <option key={d}>{d}</option>)}
                        </select>
                      </div>
                      <div>
                        <FieldLabel>Points</FieldLabel>
                        <input type="number" value={points} onChange={(e) => setPoints(e.target.value)} min={1} style={inputStyle} />
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div>
                        <FieldLabel>Urgency</FieldLabel>
                        <select value={urgency} onChange={(e) => setUrgency(e.target.value)} style={inputStyle}>
                          {["Low", "Normal", "Urgent", "Critical"].map((u) => <option key={u}>{u}</option>)}
                        </select>
                      </div>
                      <div>
                        <FieldLabel>Deadline (optional)</FieldLabel>
                        <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} style={inputStyle} min={new Date().toISOString().split("T")[0]} />
                      </div>
                    </div>
                    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderLeft: "3px solid #3b82f6", borderRadius: "0 6px 6px 0", padding: "10px 12px", marginTop: 8, fontSize: 12, color: "#475569" }}>
                      Click on the map to set the task location.
                      {pickedPosition
                        ? <div style={{ fontFamily: "monospace", color: "#15803d", marginTop: 4, fontSize: 11 }}>✓ {pickedPosition.lat}, {pickedPosition.lng}</div>
                        : <div style={{ fontFamily: "monospace", color: "#ef4444", marginTop: 4, fontSize: 11 }}>No location selected</div>
                      }
                    </div>
                    <button type="submit" style={primaryBtnStyle}>{editingTask ? "Update Task →" : "Submit for Approval →"}</button>
                  </form>
                </div>
              )}

              {/* TASK LIST PANEL */}
              {showTaskList && (
                <div style={{ ...floatPanelStyle, right: 14, left: "auto", width: 340 }}>
                  <PanelHeader title="Active Tasks" onClose={() => setShowTaskList(false)} subtitle={`${visibleActiveTasks.length} in map view`} />
                  <div style={{ display: "grid", gap: 8, marginTop: 12, maxHeight: "64vh", overflowY: "auto" }}>
                    {visibleActiveTasks.length === 0 && <div style={muteStyle}>No active tasks in view.</div>}
                    {visibleActiveTasks.map((task) => (
                      <div key={task._id} onClick={() => { setSelectedTask(task); setFocusedTask(task); setShowTaskList(false); }} style={listCardStyle(task.status)}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
                          <div style={{ fontWeight: 700, color: "#1e293b", fontSize: 14 }}>{task.title}</div>
                          <StatusPill status={task.status} />
                        </div>
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 5 }}>
                          <UrgencyBadge urgency={task.urgency} />
                          <DeadlineTag deadline={task.deadline} />
                        </div>
                        <div style={metaStyle}>{task.category} · {task.location}</div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                          <span style={metaStyle}>{task.difficulty}</span>
                          <span style={{ fontFamily: "monospace", fontSize: 11, color: "#ea580c", fontWeight: 600 }}>{task.points} pts</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SELECTED TASK */}
              {selectedTask && !selectedTask.archived && (
                <div style={selectedCardStyle}>
                  <div style={{ background: "#fafafa", borderBottom: "1px solid #f1f5f9", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <SectionLabel>Task Detail</SectionLabel>
                    <button onClick={() => setSelectedTask(null)} style={closeBtnStyle}>×</button>
                  </div>
                  <div style={{ padding: 14, display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: "#1e293b" }}>{selectedTask.title}</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <StatusPill status={selectedTask.status} />
                      <UrgencyBadge urgency={selectedTask.urgency} />
                      <DeadlineTag deadline={selectedTask.deadline} />
                    </div>
                    {selectedTask.description && (
                      <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.5 }}>{selectedTask.description}</div>
                    )}
                    <div style={{ display: "grid", gap: 0 }}>
                      <DetailRow label="Category" value={selectedTask.category} />
                      <DetailRow label="Difficulty" value={selectedTask.difficulty} />
                      <DetailRow label="Points" value={`${selectedTask.points} pts`} accent />
                      <DetailRow label="Location" value={selectedTask.location} />
                      <DetailRow label="Posted by" value={selectedTask.createdBy || "—"} />
                      <DetailRow label="Helper" value={selectedTask.acceptedBy || "—"} />
                    </div>

                    {/* Evidence images */}
                    {selectedTask.evidence_images && selectedTask.evidence_images.length > 0 && (
                      <div>
                        <SectionLabel>Evidence Photos</SectionLabel>
                        <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "4px 0" }}>
                          {selectedTask.evidence_images.map((url, i) => (
                            <img key={i} src={url} alt={`Evidence ${i + 1}`} style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 4, cursor: "pointer" }} onClick={() => window.open(url)} />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Rating display */}
                    {selectedTask.rating_score && (
                      <div style={{ background: "#fefce8", border: "1px solid #fde047", borderRadius: 6, padding: "8px 12px" }}>
                        <div style={{ fontFamily: "monospace", fontSize: 9, color: "#a16207", marginBottom: 4 }}>HELPER RATING</div>
                        <StarRating score={selectedTask.rating_score} size={16} />
                        {selectedTask.rating_comment && <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>"{selectedTask.rating_comment}"</div>}
                      </div>
                    )}

                    {/* Comment section */}
                    <div style={{ marginTop: 8 }}>
                      <SectionLabel>Comments</SectionLabel>
                      <div style={{ maxHeight: 120, overflowY: "auto", marginBottom: 6 }}>
                        {comments.length === 0 && <div style={muteStyle}>No comments yet.</div>}
                        {comments.map(c => (
                          <div key={c._id} style={{ background: "#f8fafc", padding: 6, marginBottom: 6, borderRadius: 4 }}>
                            <strong>{c.userName}</strong>: {c.text}
                            <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 2 }}>{new Date(c.createdAt).toLocaleString()}</div>
                          </div>
                        ))}
                      </div>
                      <form onSubmit={postComment} style={{ display: "flex", gap: 6 }}>
                        <input type="text" value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Add a comment..." style={{ ...inputStyle, flex: 1 }} />
                        <button type="submit" style={secBtnStyle}>Post</button>
                      </form>
                    </div>

                    {/* Action buttons */}
                    {selectedTask.status === "open" && selectedTask.createdBy !== user?.name && (
                      <button onClick={() => acceptTask(selectedTask._id)} style={primaryBtnStyle}>Accept Task →</button>
                    )}
                    {selectedTask.status === "in_progress" && selectedTask.acceptedBy === user?.name && (
                      <>
                        <button onClick={() => setShowImageUploader(!showImageUploader)} style={secBtnStyle}>
                          {showImageUploader ? "Hide Evidence Upload" : "📸 Add Evidence Photos"}
                        </button>
                        {showImageUploader && (
                          <div style={{ marginTop: 8 }}>
                            <input type="file" multiple accept="image/*" onChange={(e) => setSelectedImages(Array.from(e.target.files))} />
                            {selectedImages.length > 0 && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                                {selectedImages.map((img, idx) => (
                                  <img key={idx} src={URL.createObjectURL(img)} alt="preview" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 4 }} />
                                ))}
                              </div>
                            )}
                            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "8px 12px", borderRadius: 6, fontSize: 13, color: "#15803d", marginTop: 8, marginBottom: 8 }}>
                              💡 <strong>Helper Quick Guide:</strong> Please ensure the task is completely fulfilled. Take a clear photo of the completed work and upload it below. The task poster will review this evidence before releasing your reward points.
                            </div>
                            <button
                              onClick={() => completeTaskWithEvidence(selectedTask._id, selectedImages)}
                              disabled={uploadingEvidence || selectedImages.length === 0}
                              style={{ ...primaryBtnStyle, marginTop: 8, background: selectedImages.length === 0 ? "#cbd5e1" : "#16a34a", cursor: selectedImages.length === 0 ? "not-allowed" : "pointer" }}
                            >
                              {uploadingEvidence ? "Uploading..." : selectedImages.length === 0 ? "Select a photo first" : "✓ Submit with Evidence"}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                    {(selectedTask.status === "completed" || (selectedTask.archived && !selectedTask.rating_score)) && selectedTask.createdBy === user?.name && (
                      <button onClick={() => setRatingTask(selectedTask)} style={{ ...primaryBtnStyle, background: "#d97706" }}>★ Rate Helper</button>
                    )}
                    {selectedTask.status === "completed" && selectedTask.createdBy !== user?.name && (
                      <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderLeft: "3px solid #22c55e", borderRadius: "0 6px 6px 0", padding: "10px 12px", fontSize: 13, color: "#15803d" }}>
                        ✓ Task completed — awaiting dispatcher review
                      </div>
                    )}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {selectedTask.createdBy === user?.name && selectedTask.status === "pending" && (
                        <>
                          <button onClick={() => { setEditingTask(selectedTask); setDescription(selectedTask.description || ""); setCategory(selectedTask.category); setPoints(selectedTask.points); setDifficulty(selectedTask.difficulty); setUrgency(selectedTask.urgency); setDeadline(selectedTask.deadline?.split("T")[0] || ""); setLocation(selectedTask.location); setPickedPosition({ lat: selectedTask.lat, lng: selectedTask.lng }); setShowPostPanel(true); setSelectedTask(null); }} style={secBtnStyle}>✎ Edit</button>
                          <button onClick={() => deleteTask(selectedTask._id)} style={rejectBtnStyle}>🗑 Delete</button>
                        </>
                      )}
                      {selectedTask.createdBy !== user?.name && selectedTask.acceptedBy !== user?.name && selectedTask.status !== "completed" && (
                        <button onClick={() => setChatWithUser({ userId: selectedTask.createdByUserId, name: selectedTask.createdBy })} style={{ ...secBtnStyle, background: "#eff6ff" }}>💬 Chat Poster</button>
                      )}
                      {selectedTask.acceptedBy === user?.name && (
                        <button onClick={() => setChatWithUser({ userId: selectedTask.createdByUserId, name: selectedTask.createdBy })} style={{ ...secBtnStyle, background: "#eff6ff" }}>💬 Chat Poster</button>
                      )}
                      {selectedTask.status !== "completed" && selectedTask.createdBy !== user?.name && !selectedTask.archived && (
                        <button onClick={() => setFlaggingTask(selectedTask)} style={{ ...secBtnStyle, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca" }}>⚑ Flag</button>
                      )}
                      {(selectedTask.status === "completed" || selectedTask.archived || selectedTask.rating_score) && (
                        <button onClick={() => setDisputeTask(selectedTask)} style={{ ...secBtnStyle, background: "#fffbeb", borderColor: "#fde047", color: "#92400e" }}>
                          📢 Raise Dispute
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* BOTTOM STRIP */}
            <div style={bottomStripStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px 8px" }}>
                <div>
                  <SectionLabel>Visible Operations</SectionLabel>
                  <div style={{ fontSize: 13, color: "#64748b" }}>Active tasks in current map view</div>
                </div>
                <div style={{ fontFamily: "monospace", fontSize: 12, color: "#ea580c", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 6, padding: "3px 10px", fontWeight: 600 }}>
                  {visibleActiveTasks.length} ops
                </div>
              </div>
              <div style={stripRowStyle}>
                {loading && <div style={{ ...muteStyle, padding: "0 16px" }}>Loading...</div>}
                {!loading && visibleActiveTasks.length === 0 && <div style={{ ...muteStyle, padding: "0 16px" }}>No tasks in view.</div>}
                {!loading && visibleActiveTasks.map((t, i) => (
                  <div key={t._id} onClick={() => { setSelectedTask(t); setFocusedTask(t); }} style={stripCardStyle(selectedTask?._id === t._id, t.status)}>
                    <div style={{ fontFamily: "monospace", fontSize: 9, color: "#cbd5e1", marginBottom: 4 }}>OP #{String(i + 1).padStart(3, "0")}</div>
                    <div style={{ fontWeight: 700, color: "#1e293b", fontSize: 14, marginBottom: 3, lineHeight: 1.2 }}>{t.title}</div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
                      <UrgencyBadge urgency={t.urgency} />
                      <DeadlineTag deadline={t.deadline} />
                    </div>
                    <div style={metaStyle}>{t.category} · {t.location}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                      <StatusPill status={t.status} />
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: "#ea580c", fontWeight: 600 }}>{t.points} pts</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT SIDEBAR – no home location */}
          <aside style={sidebarStyle}>
            <div style={sidebarPanelStyle}>
              <SectionLabel>Operator Status</SectionLabel>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#1e293b" }}>{user?.name}</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{user?.email}</div>
              <div style={{ marginTop: 10, background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 6, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontFamily: "monospace", fontSize: 10, color: "#92400e" }}>POINTS</span>
                <span style={{ fontFamily: "monospace", fontSize: 20, fontWeight: 700, color: "#ea580c" }}>{user?.points ?? 0}</span>
              </div>
              <button
                onClick={() => setShowRedeemModal(true)}
                style={{ ...primaryBtnStyle, marginTop: 12, background: "#d97706", fontSize: 12 }}
              >
                🎁 Redeem Points
              </button>
            </div>

            <div style={sidebarPanelStyle}>
              <SectionLabel>Live Stats</SectionLabel>
              <StatRow label="Active Tasks" value={activeTasks.length} />
              <StatRow label="In View" value={visibleActiveTasks.length} accent />
              <StatRow label="My Posts" value={myPosts.length} />
              <StatRow label="I Helped" value={tasksIHelped.length} />
              {ratableTasks.length > 0 && (
                <div style={{ marginTop: 6, background: "#fefce8", border: "1px solid #fde047", borderRadius: 6, padding: "7px 10px", fontSize: 12, color: "#92400e" }}>
                  ★ You have {ratableTasks.length} task{ratableTasks.length > 1 ? "s" : ""} to rate!
                </div>
              )}
            </div>

            <div style={sidebarPanelStyle}>
              <SectionLabel>My Skills</SectionLabel>
              {!editingSkills ? (
                <>
                  {(!user?.skills || user.skills.length === 0)
                    ? <div style={muteStyle}>No skills set yet.</div>
                    : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {user.skills.map((s) => (
                          <span key={s} style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 5, padding: "3px 8px", fontSize: 11, color: "#1d4ed8", fontWeight: 600 }}>{s}</span>
                        ))}
                      </div>
                    )
                  }
                  <button onClick={() => { setDraftSkills(user?.skills || []); setEditingSkills(true); }} style={{ ...secBtnStyle, marginTop: 10, width: "100%", fontSize: 12 }}>
                    Edit Skills
                  </button>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                    {SKILL_CATEGORIES.map((s) => (
                      <button key={s} onClick={() => setDraftSkills((p) => p.includes(s) ? p.filter((x) => x !== s) : [...p, s])}
                        style={{ padding: "4px 9px", borderRadius: 5, border: draftSkills.includes(s) ? "1px solid #bfdbfe" : "1px solid #e2e8f0", background: draftSkills.includes(s) ? "#eff6ff" : "#fafafa", color: draftSkills.includes(s) ? "#1d4ed8" : "#64748b", fontSize: 11, fontWeight: draftSkills.includes(s) ? 600 : 400, cursor: "pointer" }}>
                        {s}
                      </button>
                    ))}
                    {draftSkills.filter(s => !SKILL_CATEGORIES.includes(s)).map(skill => (
                      <button key={skill} type="button" onClick={() => setDraftSkills(p => p.filter(x => x !== skill))} style={{ padding: "4px 9px", borderRadius: 5, border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{skill} ×</button>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                    <input type="text" placeholder="Other skill..." style={{ ...inputStyle, padding: "6px 10px", flex: 1, fontSize: 12, margin: 0 }} value={customSkillProfile} onChange={e => setCustomSkillProfile(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if(customSkillProfile.trim()) { setDraftSkills(p => p.includes(customSkillProfile.trim()) ? p : [...p, customSkillProfile.trim()]); setCustomSkillProfile(""); } } }} />
                    <button type="button" onClick={() => { if(customSkillProfile.trim()) { setDraftSkills(p => p.includes(customSkillProfile.trim()) ? p : [...p, customSkillProfile.trim()]); setCustomSkillProfile(""); } }} style={{ ...secBtnStyle, padding: "6px 12px" }}>Add</button>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={saveSkills} style={{ ...primaryBtnStyle, flex: 1, padding: 8, fontSize: 12, marginTop: 0 }}>Save</button>
                    <button onClick={() => setEditingSkills(false)} style={{ ...secBtnStyle, flex: 1 }}>Cancel</button>
                  </div>
                </>
              )}
            </div>

            <div style={sidebarPanelStyle}>
              <SectionLabel>My Interests</SectionLabel>
              {!editingInterests ? (
                <>
                  {(!user?.interests || user.interests.length === 0)
                    ? <div style={muteStyle}>No interests set yet.</div>
                    : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {user.interests.map((i) => (
                          <span key={i} style={{ background: "#fefce8", border: "1px solid #fde047", borderRadius: 5, padding: "3px 8px", fontSize: 11, color: "#92400e", fontWeight: 600 }}>{i}</span>
                        ))}
                      </div>
                    )
                  }
                  <button onClick={() => { setDraftInterests(user?.interests || []); setEditingInterests(true); }} style={{ ...secBtnStyle, marginTop: 10, width: "100%", fontSize: 12 }}>
                    Edit Interests
                  </button>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                    {INTEREST_CATEGORIES.map((i) => (
                      <button key={i} onClick={() => setDraftInterests((p) => p.includes(i) ? p.filter((x) => x !== i) : [...p, i])}
                        style={{ padding: "4px 9px", borderRadius: 5, border: draftInterests.includes(i) ? "1px solid #fde047" : "1px solid #e2e8f0", background: draftInterests.includes(i) ? "#fefce8" : "#fafafa", color: draftInterests.includes(i) ? "#92400e" : "#64748b", fontSize: 11, fontWeight: draftInterests.includes(i) ? 600 : 400, cursor: "pointer" }}>
                        {i}
                      </button>
                    ))}
                    {draftInterests.filter(i => !INTEREST_CATEGORIES.includes(i)).map(interest => (
                      <button key={interest} type="button" onClick={() => setDraftInterests(p => p.filter(x => x !== interest))} style={{ padding: "4px 9px", borderRadius: 5, border: "1px solid #fde047", background: "#fefce8", color: "#92400e", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{interest} ×</button>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                    <input type="text" placeholder="Other interest..." style={{ ...inputStyle, padding: "6px 10px", flex: 1, fontSize: 12, margin: 0 }} value={customInterestProfile} onChange={e => setCustomInterestProfile(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if(customInterestProfile.trim()) { setDraftInterests(p => p.includes(customInterestProfile.trim()) ? p : [...p, customInterestProfile.trim()]); setCustomInterestProfile(""); } } }} />
                    <button type="button" onClick={() => { if(customInterestProfile.trim()) { setDraftInterests(p => p.includes(customInterestProfile.trim()) ? p : [...p, customInterestProfile.trim()]); setCustomInterestProfile(""); } }} style={{ ...secBtnStyle, padding: "6px 12px" }}>Add</button>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={saveInterests} style={{ ...primaryBtnStyle, flex: 1, padding: 8, fontSize: 12, marginTop: 0 }}>Save</button>
                    <button onClick={() => setEditingInterests(false)} style={{ ...secBtnStyle, flex: 1 }}>Cancel</button>
                  </div>
                </>
              )}
            </div>

            <div style={sidebarPanelStyle}>
              <SectionLabel>Reward System</SectionLabel>
              <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.5 }}>
                <strong style={{color:"#ea580c"}}>Earn Points</strong> by successfully completing tasks with evidence. Points determine your rank.
                <ul style={{ paddingLeft: 16, margin: "6px 0", color: "#64748b" }}>
                  <li>Critical Task: <strong>3x pts</strong></li>
                  <li>Hard Task: <strong>2x pts</strong></li>
                  <li>Medium: <strong>1.5x pts</strong></li>
                  <li>Easy: <strong>Base pts</strong></li>
                </ul>
                Your <strong>Reputation Rating</strong> increases when posters leave positive ★ reviews on completed ops.
              </div>
            </div>

            <div style={{ fontFamily: "monospace", fontSize: 9, color: "#cbd5e1", textAlign: "center", marginTop: 10 }}>
              14.8294° N · 120.2822° E
            </div>
          </aside>
        </div>

        {/* PROFILE PANEL */}
        {showProfile && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.3)", zIndex: 3000, display: "flex", justifyContent: "flex-end" }}>
            <div style={{ width: "min(960px,100%)", height: "100%", background: "#f8fafc", borderLeft: "1px solid #e2e8f0", borderTop: "3px solid #ea580c", padding: 20, boxSizing: "border-box", overflowY: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
                <div>
                  <SectionLabel>Operator Profile</SectionLabel>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#1e293b" }}>{user?.name}</div>
                  <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 3 }}>{user?.email}</div>
                  <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                    <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 6, padding: "5px 14px", fontFamily: "monospace", fontSize: 13, color: "#ea580c", fontWeight: 700 }}>
                      {user?.points ?? 0} points
                    </div>
                    {user?.totalRatingCount > 0 && (
                      <div style={{ background: "#fefce8", border: "1px solid #fde047", borderRadius: 6, padding: "5px 14px", display: "flex", alignItems: "center", gap: 6 }}>
                        <StarRating score={Math.round(user.averageRating)} size={14} />
                        <span style={{ fontFamily: "monospace", fontSize: 12, color: "#92400e" }}>{user.averageRating} avg ({user.totalRatingCount})</span>
                      </div>
                    )}
                  </div>
                </div>
                <button onClick={() => setShowProfile(false)} style={closeBtnStyle}>×</button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
                {[
                  { label: "My Posts", items: myPosts },
                  { label: "Tasks I Helped", items: tasksIHelped },
                  { label: "History", items: myHistory },
                ].map(({ label, items }) => (
                  <div key={label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderTop: "3px solid #ea580c", borderRadius: "0 0 8px 8px", padding: 14 }}>
                    <SectionLabel>{label}</SectionLabel>
                    {items.length === 0 && <div style={muteStyle}>No records yet.</div>}
                    <div style={{ display: "grid", gap: 8 }}>
                      {items.map((task) => (
                        <div key={task._id} style={{ background: "#f8fafc", border: "1px solid #f1f5f9", borderLeft: "3px solid #e2e8f0", borderRadius: "0 6px 6px 0", padding: "10px 12px" }}>
                          <div style={{ fontWeight: 700, color: "#1e293b", marginBottom: 3 }}>{task.title}</div>
                          <div style={metaStyle}>{task.category} · {task.location}</div>
                          {task.deadline && <DeadlineTag deadline={task.deadline} />}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                            <StatusPill status={task.status} />
                            {task.archived && task.acceptedBy === user?.name && (
                              <span style={{ fontFamily: "monospace", fontSize: 11, color: "#15803d", fontWeight: 600 }}>+{task.points} pts</span>
                            )}
                          </div>
                          {task.rating_score && (
                            <div style={{ marginTop: 6 }}>
                              <StarRating score={task.rating_score} size={13} />
                            </div>
                          )}
                          {!task.rating_score && task.createdBy === user?.name && (task.status === "completed" || task.archived) && task.acceptedByUserId && (
                            <button onClick={() => setRatingTask(task)} style={{ marginTop: 6, fontSize: 11, padding: "4px 10px", background: "#fefce8", border: "1px solid #fde047", borderRadius: 5, color: "#92400e", cursor: "pointer" }}>
                              ★ Rate helper
                            </button>
                          )}
                          {(task.status === "completed" || task.archived || task.rating_score) && (
                            <button onClick={() => setDisputeTask(task)} style={{ marginTop: 6, fontSize: 11, padding: "4px 10px", background: "#fffbeb", border: "1px solid #fde047", borderRadius: 5, color: "#92400e", cursor: "pointer" }}>
                              📢 Dispute
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* CHAT PANEL */}
      {chatWithUser && (
        <div style={{ position: "fixed", bottom: 80, right: 20, width: 320, background: "#fff", border: "1px solid #e2e8f0", borderTop: "3px solid #ea580c", borderRadius: "0 0 10px 10px", boxShadow: "0 8px 30px rgba(15,23,42,0.12)", zIndex: 3000, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: 10, background: "#fafafa", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>Chat with {chatWithUser.name}</strong>
            <button onClick={() => setChatWithUser(null)} style={closeBtnStyle}>×</button>
          </div>
          <div style={{ height: 300, overflowY: "auto", padding: 10 }}>
            {chatMessages.map(msg => (
              <div key={msg._id} style={{ textAlign: msg.fromUserId === user?._id ? "right" : "left", marginBottom: 8 }}>
                <div style={{ display: "inline-block", background: msg.fromUserId === user?._id ? "#ea580c" : "#f1f5f9", color: msg.fromUserId === user?._id ? "#fff" : "#1e293b", borderRadius: 8, padding: "6px 10px", maxWidth: "80%" }}>
                  {msg.content}
                </div>
                <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 2 }}>{new Date(msg.createdAt).toLocaleTimeString()}</div>
              </div>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); sendMessage(); }} style={{ display: "flex", borderTop: "1px solid #e2e8f0" }}>
            <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Type a message..." style={{ flex: 1, border: "none", padding: 10 }} />
            <button type="submit" style={{ background: "#ea580c", color: "#fff", border: "none", padding: "0 12px", cursor: "pointer" }}>Send</button>
          </form>
        </div>
      )}

      {/* RATING MODAL */}
      {ratingTask && <RatingModal task={ratingTask} onClose={() => setRatingTask(null)} onSubmit={submitRating} />}

      {/* FLAG MODAL */}
      {flaggingTask && (
        <FlagModal task={flaggingTask} onClose={() => setFlaggingTask(null)} onSubmit={flagTask} />
      )}

      {/* DISPUTE MODAL */}
      {disputeTask && (
        <DisputeModal
          task={disputeTask}
          onClose={() => setDisputeTask(null)}
          onSubmit={raiseDispute}
        />
      )}

      {/* REDEEM MODAL */}
      {showRedeemModal && (
        <div style={modalOverlayStyle}>
          <div style={{ ...modalCardStyle, maxWidth: 400 }}>
            <div style={{ fontFamily: "monospace", fontSize: 9, color: "#d97706", marginBottom: 8 }}>// POINTS REDEMPTION</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Coming Soon!</div>
            <div style={{ fontSize: 14, color: "#64748b", marginBottom: 16 }}>
              You have <strong>{user?.points || 0}</strong> points. In the next update, you'll be able to exchange them for vouchers, community recognition, and special badges.
            </div>
            <button onClick={() => setShowRedeemModal(false)} style={primaryBtnStyle}>Close</button>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: toast.type === "success" ? "#f0fdf4" : toast.type === "error" ? "#fef2f2" : "#eff6ff", border: `1px solid ${toast.type === "success" ? "#bbf7d0" : toast.type === "error" ? "#fecaca" : "#bfdbfe"}`, borderLeft: `3px solid ${toast.type === "success" ? "#22c55e" : toast.type === "error" ? "#ef4444" : "#3b82f6"}`, borderRadius: "0 8px 8px 0", padding: "12px 20px", zIndex: 5000, fontSize: 13, color: toast.type === "success" ? "#15803d" : toast.type === "error" ? "#991b1b" : "#1d4ed8", boxShadow: "0 4px 20px rgba(15,23,42,0.12)", maxWidth: 420, textAlign: "center" }}>
          {toast.message}
        </div>
      )}

      {error && (
        <div style={{ position: "fixed", bottom: 16, left: 16, background: "#fef2f2", border: "1px solid #fecaca", borderLeft: "3px solid #ef4444", borderRadius: "0 8px 8px 0", padding: "12px 16px", zIndex: 4000, fontSize: 13, color: "#991b1b" }}>
          {error}
        </div>
      )}
    </div>
  );
}

// ─── Flag Modal ───────────────────────────────────────────────────────────────

function FlagModal({ task, onClose, onSubmit }) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!reason.trim()) return;
    setSubmitting(true);
    await onSubmit(task._id, reason);
    setSubmitting(false);
  }

  return (
    <div style={modalOverlayStyle}>
      <div style={modalCardStyle}>
        <div style={{ fontFamily: "monospace", fontSize: 9, color: "#94a3b8", letterSpacing: 2, marginBottom: 8 }}>// REPORT TASK</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: "#1e293b", marginBottom: 4 }}>{task.title}</div>
        <div style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>This will be reviewed by a moderator.</div>
        <div style={{ fontFamily: "monospace", fontSize: 10, color: "#64748b", letterSpacing: 1, marginBottom: 6 }}>REASON *</div>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Describe why you're reporting this task..." rows={3} style={{ ...inputStyle, resize: "vertical" }} />
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={handleSubmit} disabled={!reason.trim() || submitting} style={{ ...primaryBtnStyle, flex: 2, marginTop: 0, background: "#ef4444", opacity: !reason.trim() || submitting ? 0.5 : 1 }}>{submitting ? "Submitting..." : "Submit Report →"}</button>
          <button onClick={onClose} style={{ ...secBtnStyle, flex: 1 }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Small components ─────────────────────────────────────────────────────────

function HdrBtn({ children, active, onClick }) {
  return (
    <button onClick={onClick} style={{ padding: "6px 13px", background: active ? "#fff7ed" : "transparent", border: `1px solid ${active ? "#fed7aa" : "#e2e8f0"}`, borderRadius: 6, color: active ? "#c2410c" : "#64748b", fontFamily: "monospace", fontSize: 11, letterSpacing: 1, cursor: "pointer", fontWeight: active ? 600 : 400 }}>
      {children}
    </button>
  );
}

function PanelHeader({ title, subtitle, onClose }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 16, color: "#1e293b" }}>{title}</div>
        {subtitle && <div style={{ fontFamily: "monospace", fontSize: 10, color: "#94a3b8", letterSpacing: 1, marginTop: 2 }}>{subtitle}</div>}
      </div>
      <button onClick={onClose} style={closeBtnStyle}>×</button>
    </div>
  );
}

function DetailRow({ label, value, accent }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>
      <span style={{ fontFamily: "monospace", fontSize: 10, color: "#94a3b8", letterSpacing: 1 }}>{label}</span>
      <span style={{ color: accent ? "#ea580c" : "#475569", fontWeight: accent ? 600 : 400, fontFamily: accent ? "monospace" : "inherit" }}>{value}</span>
    </div>
  );
}

function StatRow({ label, value, accent }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, fontSize: 13 }}>
      <span style={{ color: "#64748b" }}>{label}</span>
      <span style={{ fontFamily: "monospace", fontSize: 15, color: accent ? "#ea580c" : "#1e293b", fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const pageStyle = { width: "100vw", height: "100vh", background: "#f1f5f9", fontFamily: "'DM Sans','Segoe UI',Arial,sans-serif", color: "#1e293b", margin: 0, overflow: "hidden", position: "relative" };
const gridBgStyle = { position: "fixed", inset: 0, backgroundImage: "linear-gradient(#e2e8f0 1px, transparent 1px), linear-gradient(90deg, #e2e8f0 1px, transparent 1px)", backgroundSize: "28px 28px", opacity: 0.5, pointerEvents: "none", zIndex: 0 };
const shellStyle = { width: "100%", height: "100%", display: "flex", flexDirection: "column", position: "relative", zIndex: 1 };
const headerStyle = { background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 16px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 1px 4px rgba(15,23,42,0.06)", flexShrink: 0, height: 52 };
const brandStyle = { fontFamily: "monospace", fontSize: 16, letterSpacing: 3, fontWeight: 700, color: "#1e293b" };
const divStyle = { width: 1, height: 18, background: "#e2e8f0" };
const sysLabelStyle = { display: "flex", alignItems: "center", fontFamily: "monospace", fontSize: 10, color: "#22c55e", letterSpacing: 1 };
const dotStyle = { width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block", marginRight: 5 };
const postBtnStyle = { padding: "7px 14px", background: "#ea580c", border: "none", borderRadius: 6, color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const ratingPromptStyle = { padding: "7px 12px", background: "#fefce8", border: "1px solid #fde047", borderRadius: 6, color: "#92400e", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const iconBtnStyle = { width: 34, height: 34, borderRadius: 6, border: "1px solid #e2e8f0", background: "#fafafa", cursor: "pointer", fontSize: 14, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" };
const ptsBadgeStyle = { background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 6, padding: "4px 10px", fontFamily: "monospace", fontSize: 11, color: "#ea580c", fontWeight: 600 };
const logoutBtnStyle = { padding: "6px 12px", background: "transparent", border: "1px solid #e2e8f0", borderRadius: 6, color: "#94a3b8", fontFamily: "monospace", fontSize: 10, letterSpacing: 1, cursor: "pointer" };
const badgeStyle = { position: "absolute", top: -3, right: -3, background: "#ef4444", color: "white", borderRadius: "50%", fontSize: 8, fontWeight: 700, width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center" };
const mainLayoutStyle = { display: "grid", gridTemplateColumns: "1fr 260px", flex: 1, minHeight: 0 };
const mapColumnStyle = { display: "flex", flexDirection: "column", minHeight: 0 };
const mapTagStyle = { position: "absolute", top: 10, left: 10, fontFamily: "monospace", fontSize: 10, color: "#475569", background: "#fff", border: "1px solid #e2e8f0", padding: "4px 10px", zIndex: 1000, boxShadow: "0 2px 8px rgba(0,0,0,0.08)", borderRadius: "0 4px 4px 0" };
const floatPanelStyle = { position: "absolute", top: 14, left: 14, width: 320, background: "#fff", border: "1px solid #e2e8f0", borderTop: "3px solid #ea580c", borderRadius: "0 0 10px 10px", boxShadow: "0 8px 30px rgba(15,23,42,0.12)", padding: 16, zIndex: 1000, maxHeight: "84vh", overflowY: "auto" };
const selectedCardStyle = { position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", width: 330, background: "#fff", border: "1px solid #e2e8f0", borderTop: "3px solid #ea580c", borderRadius: "0 0 10px 10px", boxShadow: "0 8px 30px rgba(15,23,42,0.12)", zIndex: 1000, overflow: "hidden", maxHeight: "70vh", overflowY: "auto" };
const inputStyle = { width: "100%", padding: "10px 12px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, color: "#1e293b", fontFamily: "inherit", fontSize: 13, boxSizing: "border-box", outline: "none" };
const primaryBtnStyle = { width: "100%", padding: "11px 16px", marginTop: 12, background: "#ea580c", border: "none", borderRadius: 6, color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const secBtnStyle = { padding: "9px 12px", background: "#fafafa", border: "1px solid #e2e8f0", borderRadius: 6, color: "#64748b", fontSize: 12, cursor: "pointer" };
const closeBtnStyle = { background: "#fafafa", border: "1px solid #e2e8f0", borderRadius: 6, color: "#94a3b8", width: 28, height: 28, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" };
const bottomStripStyle = { height: 210, background: "#fff", borderTop: "1px solid #e2e8f0", display: "flex", flexDirection: "column" };
const stripRowStyle = { display: "flex", gap: 10, overflowX: "auto", flex: 1, padding: "0 16px 14px" };
const sidebarStyle = { background: "#fff", borderLeft: "1px solid #e2e8f0", padding: 14, boxSizing: "border-box", overflowY: "auto", display: "grid", gap: 14, alignContent: "start" };
const sidebarPanelStyle = { background: "#fafafa", border: "1px solid #f1f5f9", borderRadius: 8, padding: 14 };
const muteStyle = { fontFamily: "monospace", fontSize: 11, color: "#cbd5e1" };
const metaStyle = { fontFamily: "monospace", fontSize: 10, color: "#94a3b8", letterSpacing: 0.5 };
const notifDropStyle = { position: "absolute", top: 40, right: 0, width: 300, background: "#fff", border: "1px solid #e2e8f0", borderTop: "3px solid #ea580c", borderRadius: "0 0 10px 10px", padding: 14, zIndex: 3000, boxShadow: "0 8px 30px rgba(15,23,42,0.12)" };
const overlayBgStyle = { position: "fixed", inset: 0, background: "rgba(15,23,42,0.2)", zIndex: 3000, display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 60 };
const modalCardStyle = { width: "min(520px,92%)", background: "#fff", border: "1px solid #e2e8f0", borderTop: "3px solid #ea580c", borderRadius: "0 0 12px 12px", padding: 22, maxHeight: "80vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(15,23,42,0.15)" };
const modalOverlayStyle = { position: "fixed", inset: 0, background: "rgba(15,23,42,0.3)", zIndex: 4000, display: "flex", alignItems: "center", justifyContent: "center" };
const filterBarStyle = { background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "8px 16px" };
const filterInputStyle = { padding: "7px 11px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, color: "#1e293b", fontFamily: "inherit", fontSize: 13, outline: "none" };
const filterSelectStyle = { padding: "7px 10px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, color: "#475569", fontFamily: "monospace", fontSize: 11, outline: "none", cursor: "pointer" };
const clearBtnStyle = { padding: "7px 12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, color: "#991b1b", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const myLocationBtnStyle = {
  position: "absolute",
  bottom: 20,
  right: 20,
  zIndex: 1000,
  padding: "10px 14px",
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
  color: "#1e293b",
  fontFamily: "monospace",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 5,
};

function listCardStyle(status) {
  const borderColor = status === "open" ? "#ea580c" : status === "in_progress" ? "#3b82f6" : "#22c55e";
  return { background: "#fafafa", border: "1px solid #f1f5f9", borderLeft: `3px solid ${borderColor}`, borderRadius: "0 6px 6px 0", padding: "10px 12px", cursor: "pointer" };
}

function stripCardStyle(active, status) {
  const borderColor = status === "open" ? "#ea580c" : status === "in_progress" ? "#3b82f6" : "#22c55e";
  return { minWidth: 190, maxWidth: 190, background: active ? "#fff7ed" : "#fafafa", border: "1px solid #e2e8f0", borderTop: `3px solid ${borderColor}`, borderRadius: "0 0 8px 8px", padding: 12, cursor: "pointer", flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "space-between" };
}

// Add mobile responsive styles to document head
const styleSheet = document.createElement("style");
styleSheet.textContent = `
@media (max-width: 768px) {
  aside { display: none !important; }
  [style*="grid-template-columns: 1fr 260px"] { grid-template-columns: 1fr !important; }
  .leaflet-container { height: 55vh !important; min-height: 300px; }
  [style*="position: absolute; top: 14px; left: 14px; width: 320px"] {
    position: fixed !important;
    bottom: 0 !important;
    top: auto !important;
    left: 0 !important;
    right: 0 !important;
    width: 100% !important;
    max-height: 60vh !important;
    border-radius: 12px 12px 0 0 !important;
    z-index: 2000;
    overflow-y: auto;
  }
  [style*="position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); width: 330px"] {
    width: 95% !important;
    left: 2.5% !important;
    transform: none !important;
    bottom: 10px;
  }
  [style*="height: 210px"] {
    height: auto;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: rgba(255,255,255,0.95);
    border-top: 1px solid #e2e8f0;
    backdrop-filter: blur(8px);
    z-index: 500;
  }
  [style*="position: fixed; bottom: 80px; right: 20px; width: 320px"] {
    width: 90% !important;
    right: 5% !important;
    left: 5% !important;
    bottom: 20px !important;
  }
  button, .leaflet-marker-icon { min-height: 44px; min-width: 44px; }
}
`;
document.head.appendChild(styleSheet);