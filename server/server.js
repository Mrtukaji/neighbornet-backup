require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { body, validationResult } = require("express-validator");
const helmet = require("helmet");
const http = require("http");
const socketIo = require("socket.io");
const { supabase } = require("./db");

const authRoutes = require("./routes/auth");
const disputeRoutes = require("./routes/disputes");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: process.env.CORS_ORIGIN || "*" } });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "neighbornet_super_secret_key";

// Helper: convert Supabase 'id' to '_id' for frontend compatibility
function fixIds(data) {
  if (!data) return null;
  if (Array.isArray(data)) return data.map(item => fixIds(item));
  if (typeof data === 'object' && data !== null) {
    const newObj = { ...data, _id: data.id };
    delete newObj.id;
    return newObj;
  }
  return data;
}

// Middleware
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || true, credentials: true }));
app.use(express.json());

const flagLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: "Too many flag reports, please try again later." }
});

// Auth middleware
function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized." });
    }
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}

function requireDispatcher(req, res, next) {
  if (!req.user || (req.user.role !== "dispatcher" && req.user.role !== "admin")) {
    return res.status(403).json({ message: "Dispatcher access only." });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access only." });
  }
  next();
}

// Audit helper
async function audit(action, user, targetType, targetId, targetLabel, details = {}) {
  try {
    await supabase.from("audit_logs").insert({
      action,
      actor_name: user.name,
      actor_id: user.userId,
      actor_role: user.role,
      target_type: targetType,
      target_id: targetId ? String(targetId) : null,
      target_label: targetLabel,
      details,
    });
  } catch (e) { console.error("Audit log error:", e.message); }
}

// Engagement recalc helper
async function recalcEngagement(userId) {
  try {
    const { data: user } = await supabase.from("users").select("total_tasks_helped, consecutive_streak, average_rating").eq("id", userId).single();
    if (!user) return;
    const score = (user.total_tasks_helped || 0) * 10 +
      (user.consecutive_streak || 0) * 5 +
      (user.average_rating || 0) * 20;
    await supabase.from("users").update({ engagement_score: Math.round(score) }).eq("id", userId);
  } catch (e) { console.error("Engagement recalc error:", e.message); }
}

// Socket.io
io.on("connection", (socket) => {
  const userId = socket.handshake.auth.userId;
  if (userId) socket.join(`user_${userId}`);
  socket.on("join_task_chat", (taskId) => socket.join(`task_${taskId}`));
});

function emitNotification(userId, notification) {
  io.to(`user_${userId}`).emit("new_notification", notification);
}

function emitNewComment(taskId, comment) {
  io.to(`task_${taskId}`).emit("new_comment", comment);
}

// Routes
app.get("/", (req, res) => res.send("NeighborNet API is running"));
app.use("/auth", authRoutes);
app.use("/disputes", disputeRoutes);

// Leaderboard
app.get("/leaderboard", async (req, res) => {
  try {
    const { data: topUsers, error } = await supabase
      .from("users")
      .select("name, points, skills, average_rating, total_rating_count, engagement_score")
      .eq("role", "community")
      .order("points", { ascending: false })
      .limit(10);
    if (error) throw error;
    res.json(fixIds(topUsers));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Notifications
app.get("/notifications", requireAuth, async (req, res) => {
  try {
    const { data: notifications, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", req.user.userId)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw error;
    res.json(fixIds(notifications));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put("/notifications/read-all", requireAuth, async (req, res) => {
  try {
    await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", req.user.userId)
      .eq("read", false);
    res.json({ message: "All notifications marked as read." });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Tasks
app.get("/tasks", async (req, res) => {
  try {
    const { search, category, difficulty, urgency, status, sort } = req.query;
    let query = supabase.from("tasks").select("*");

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,location.ilike.%${search}%`);
    }
    if (category && category !== "All") query = query.eq("category", category);
    if (difficulty && difficulty !== "All") query = query.eq("difficulty", difficulty);
    if (urgency && urgency !== "All") query = query.eq("urgency", urgency);
    if (status && status !== "All") query = query.eq("status", status);

    if (sort === "points_desc") query = query.order("points", { ascending: false });
    else if (sort === "points_asc") query = query.order("points", { ascending: true });
    else if (sort === "deadline_asc") query = query.order("deadline", { ascending: true });
    else query = query.order("created_at", { ascending: false });

    const { data: tasks, error } = await query;
    if (error) throw error;
    res.json(fixIds(tasks));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST create task (community only)
app.post("/tasks", requireAuth, [
  body("title").notEmpty().trim().escape(),
  body("location").notEmpty().trim().escape(),
  body("lat").isFloat({ min: -90, max: 90 }),
  body("lng").isFloat({ min: -180, max: 180 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ message: errors.array()[0].msg });
  try {
    if (req.user.role !== "community") {
      return res.status(403).json({ message: "Only community users can create tasks." });
    }
    const { data: config } = await supabase.from("config").select("*").limit(1).single();
    const maxPoints = config?.max_points_per_task || 500;
    const rawPoints = Number(req.body.points) || 10;
    const cappedPoints = Math.min(rawPoints, maxPoints);

    const { data: newTask, error } = await supabase
      .from("tasks")
      .insert({
        title: req.body.title,
        description: req.body.description || "",
        category: req.body.category,
        points: cappedPoints,
        difficulty: req.body.difficulty,
        urgency: req.body.urgency || "Normal",
        deadline: req.body.deadline || null,
        location: req.body.location,
        lat: req.body.lat,
        lng: req.body.lng,
        created_by: req.user.name,
        created_by_user_id: req.user.userId,
        status: "pending",
      })
      .select()
      .single();

    if (error) throw error;

    await supabase.rpc('increment_total_tasks_posted', { user_id: req.user.userId });

    const { data: dispatchers } = await supabase.from("users").select("id").in("role", ["dispatcher", "admin"]);
    if (dispatchers?.length) {
      const notifications = dispatchers.map(d => ({
        user_id: d.id,
        message: `New task pending approval: "${newTask.title}" by ${req.user.name}.`,
        task_id: newTask.id,
        task_title: newTask.title,
      }));
      await supabase.from("notifications").insert(notifications);
      dispatchers.forEach(d => emitNotification(d.id, { message: notifications[0].message }));
    }

    res.status(201).json(fixIds(newTask));
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message });
  }
});

// PUT edit own pending task
app.put("/tasks/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", id)
      .single();
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (task.created_by_user_id !== req.user.userId && req.user.role !== "admin") {
      return res.status(403).json({ message: "You can only edit your own pending tasks." });
    }
    if (task.status !== "pending") {
      return res.status(400).json({ message: "Only pending tasks can be edited." });
    }

    const { data: config } = await supabase.from("config").select("*").limit(1).single();
    const maxPoints = config?.max_points_per_task || 500;
    const rawPoints = Number(req.body.points) || task.points;
    const cappedPoints = Math.min(rawPoints, maxPoints);

    const updates = {
      title: req.body.title || task.title,
      description: req.body.description ?? task.description,
      category: req.body.category || task.category,
      points: cappedPoints,
      difficulty: req.body.difficulty || task.difficulty,
      urgency: req.body.urgency || task.urgency,
      deadline: req.body.deadline || task.deadline,
      location: req.body.location || task.location,
    };
    if (req.body.lat && req.body.lng) {
      updates.lat = req.body.lat;
      updates.lng = req.body.lng;
    }

    const { data: updatedTask, error: updateError } = await supabase
      .from("tasks")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (updateError) throw updateError;
    await audit("TASK_EDITED", req.user, "task", id, task.title);
    res.json(fixIds(updatedTask));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// DELETE own pending task
app.delete("/tasks/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", id)
      .single();
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (task.created_by_user_id !== req.user.userId && req.user.role !== "admin") {
      return res.status(403).json({ message: "You can only delete your own pending tasks." });
    }
    if (task.status !== "pending") {
      return res.status(400).json({ message: "Only pending tasks can be deleted." });
    }
    await supabase.from("tasks").delete().eq("id", id);
    await audit("TASK_DELETED", req.user, "task", id, task.title);
    res.json({ message: "Task deleted successfully." });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PUT accept task
app.put("/tasks/:id/accept", requireAuth, async (req, res) => {
  try {
    if (req.user.role !== "community") {
      return res.status(403).json({ message: "Only community users can accept tasks." });
    }
    const { data: user } = await supabase.from("users").select("is_flagged").eq("id", req.user.userId).single();
    if (user?.is_flagged) {
      return res.status(403).json({ message: "Your account is flagged and cannot accept tasks." });
    }

    const { id } = req.params;
    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", id)
      .single();
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (task.created_by_user_id === req.user.userId) {
      return res.status(403).json({ message: "You cannot accept your own task." });
    }
    if (task.archived) return res.status(400).json({ message: "Archived tasks cannot be accepted" });
    if (task.status !== "open") return res.status(400).json({ message: "Task already taken or unavailable" });

    const { data: updatedTask, error: updateError } = await supabase
      .from("tasks")
      .update({
        status: "in_progress",
        accepted_by: req.user.name,
        accepted_by_user_id: req.user.userId,
      })
      .eq("id", id)
      .select()
      .single();

    if (updateError) throw updateError;

    await supabase.from("notifications").insert({
      user_id: task.created_by_user_id,
      message: `${req.user.name} has accepted your task "${task.title}".`,
      task_id: task.id,
      task_title: task.title,
    });
    emitNotification(task.created_by_user_id, { message: `Task accepted: ${task.title}` });
    res.json(fixIds(updatedTask));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PUT complete task (with evidence images)
app.put("/tasks/:id/complete", requireAuth, async (req, res) => {
  try {
    if (req.user.role !== "community") {
      return res.status(403).json({ message: "Only community users can complete tasks." });
    }
    const { id } = req.params;
    const { evidenceImages } = req.body; // array of image URLs

    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", id)
      .single();
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (task.archived) return res.status(400).json({ message: "Archived tasks cannot be completed" });
    if (task.status !== "in_progress") return res.status(400).json({ message: "Task not in progress" });
    if (task.accepted_by !== req.user.name) {
      return res.status(403).json({ message: "You can only complete tasks you accepted." });
    }

    const { data: updatedTask, error: updateError } = await supabase
      .from("tasks")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        evidence_images: evidenceImages || []
      })
      .eq("id", id)
      .select()
      .single();

    if (updateError) throw updateError;

    if (task.created_by_user_id) {
      await supabase.from("notifications").insert({
        user_id: task.created_by_user_id,
        message: `${req.user.name} has completed your task "${task.title}"! Evidence uploaded.`,
        task_id: task.id,
        task_title: task.title,
      });
      emitNotification(task.created_by_user_id, { message: `Task completed: ${task.title}` });
    }
    res.json(fixIds(updatedTask));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PUT rate a task
app.put("/tasks/:id/rate", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: task, error: fetchError } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", id)
      .single();
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (task.created_by !== req.user.name) {
      return res.status(403).json({ message: "Only the task poster can rate the helper." });
    }
    if (!task.accepted_by_user_id) return res.status(400).json({ message: "No helper to rate." });
    if (task.rating_score) return res.status(400).json({ message: "Already rated." });

    const { score, comment } = req.body;
    if (!score || score < 1 || score > 5) {
      return res.status(400).json({ message: "Score must be between 1 and 5." });
    }

    const { data: updatedTask, error: updateError } = await supabase
      .from("tasks")
      .update({
        rating_score: score,
        rating_comment: comment || null,
        rated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (updateError) throw updateError;

    const { data: helper } = await supabase.from("users").select("average_rating, total_rating_count").eq("id", task.accepted_by_user_id).single();
    const newCount = (helper.total_rating_count || 0) + 1;
    const newAvg = ((helper.average_rating || 0) * (helper.total_rating_count || 0) + score) / newCount;
    await supabase.from("users").update({
      average_rating: Math.round(newAvg * 10) / 10,
      total_rating_count: newCount,
    }).eq("id", task.accepted_by_user_id);
    await recalcEngagement(task.accepted_by_user_id);

    await supabase.from("notifications").insert({
      user_id: task.accepted_by_user_id,
      message: `You received a ${score}-star rating for "${task.title}".${comment ? ` Comment: "${comment}"` : ""}`,
      task_id: task.id,
      task_title: task.title,
    });
    emitNotification(task.accepted_by_user_id, { message: `New rating: ${score} stars` });
    res.json(fixIds(updatedTask));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST flag a task
app.post("/tasks/:id/flag", requireAuth, flagLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: "A reason is required to flag a task." });
    }
    const { data: task, error: taskError } = await supabase.from("tasks").select("*").eq("id", id).single();
    if (!task) return res.status(404).json({ message: "Task not found" });

    const { error: flagError } = await supabase.from("flags").insert({
      task_id: id,
      flagged_by_user_id: req.user.userId,
      flagged_by_name: req.user.name,
      reason: reason.trim(),
      resolved: false,
    });
    if (flagError) throw flagError;

    const { data: mods } = await supabase.from("users").select("id").in("role", ["dispatcher", "admin"]);
    if (mods?.length) {
      const notifs = mods.map(m => ({
        user_id: m.id,
        message: `Task "${task.title}" was flagged by ${req.user.name}: "${reason}"`,
        task_id: id,
        task_title: task.title,
      }));
      await supabase.from("notifications").insert(notifs);
      mods.forEach(m => emitNotification(m.id, { message: notifs[0].message }));
    }
    res.json({ message: "Task flagged successfully." });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Comments
app.get("/tasks/:id/comments", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: comments, error } = await supabase
      .from("comments")
      .select("*")
      .eq("task_id", id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    res.json(fixIds(comments));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/tasks/:id/comments", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ message: "Comment cannot be empty." });
    const { data: task } = await supabase.from("tasks").select("created_by_user_id, accepted_by_user_id, title").eq("id", id).single();
    if (!task) return res.status(404).json({ message: "Task not found" });

    const { data: comment, error } = await supabase
      .from("comments")
      .insert({
        task_id: id,
        user_id: req.user.userId,
        user_name: req.user.name,
        text: text.trim(),
      })
      .select()
      .single();

    if (error) throw error;
    emitNewComment(id, comment);

    const participants = [task.created_by_user_id, task.accepted_by_user_id].filter(pid => pid && pid !== req.user.userId);
    for (const pid of participants) {
      await supabase.from("notifications").insert({
        user_id: pid,
        message: `${req.user.name} commented on task "${task.title}": "${text.substring(0, 50)}..."`,
        task_id: id,
        task_title: task.title,
      });
      emitNotification(pid, { message: `New comment on ${task.title}` });
    }
    res.status(201).json(fixIds(comment));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Messages
app.post("/messages", requireAuth, async (req, res) => {
  try {
    const { toUserId, taskId, content } = req.body;
    if (!toUserId || !content) return res.status(400).json({ message: "Missing fields." });
    const { data: message, error } = await supabase
      .from("messages")
      .insert({
        from_user_id: req.user.userId,
        from_user_name: req.user.name,
        to_user_id: toUserId,
        task_id: taskId || null,
        content: content.trim(),
      })
      .select()
      .single();
    if (error) throw error;
    io.to(`user_${toUserId}`).emit("new_message", message);
    res.status(201).json(fixIds(message));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/messages/:otherUserId", requireAuth, async (req, res) => {
  try {
    const { otherUserId } = req.params;
    const { data: messages, error } = await supabase
      .from("messages")
      .select("*")
      .or(`from_user_id.eq.${req.user.userId},to_user_id.eq.${req.user.userId}`)
      .order("created_at", { ascending: true });
    if (error) throw error;
    const filtered = messages.filter(m => (m.from_user_id === otherUserId && m.to_user_id === req.user.userId) || (m.from_user_id === req.user.userId && m.to_user_id === otherUserId));
    res.json(fixIds(filtered));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Admin routes
app.get("/admin/tasks", requireAuth, requireDispatcher, async (req, res) => {
  try {
    const { data: tasks, error } = await supabase.from("tasks").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    res.json(fixIds(tasks));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put("/admin/tasks/:id/approve", requireAuth, requireDispatcher, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: task } = await supabase.from("tasks").select("*").eq("id", id).single();
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (task.status !== "pending") return res.status(400).json({ message: "Only pending tasks can be approved" });

    const { data: config } = await supabase.from("config").select("*").limit(1).single();
    let multiplier = config.point_multiplier;
    if (config.bonus_category && task.category === config.bonus_category) {
      multiplier *= config.bonus_multiplier;
    }
    let newPoints = Math.min(Math.round(task.points * multiplier), config.max_points_per_task);

    const { data: updatedTask, error: updateError } = await supabase
      .from("tasks")
      .update({
        points: newPoints,
        status: "open",
        approved_by: req.user.name,
        approved_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (updateError) throw updateError;

    const { data: matchingHelpers } = await supabase
      .from("users")
      .select("id")
      .eq("role", "community")
      .contains("skills", [task.category])
      .neq("id", task.created_by_user_id);
    if (matchingHelpers?.length) {
      const notifs = matchingHelpers.map(h => ({
        user_id: h.id,
        message: `New task matching your skill "${task.category}": "${task.title}" in ${task.location}.`,
        task_id: id,
        task_title: task.title,
      }));
      await supabase.from("notifications").insert(notifs);
      matchingHelpers.forEach(h => emitNotification(h.id, { message: notifs[0].message }));
    }
    if (task.created_by_user_id) {
      await supabase.from("notifications").insert({
        user_id: task.created_by_user_id,
        message: `Your task "${task.title}" has been approved and is now live on the map!`,
        task_id: id,
        task_title: task.title,
      });
      emitNotification(task.created_by_user_id, { message: `Task approved: ${task.title}` });
    }
    await audit("TASK_APPROVED", req.user, "task", id, task.title);
    res.json(fixIds(updatedTask));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put("/admin/tasks/:id/reject", requireAuth, requireDispatcher, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: task } = await supabase.from("tasks").select("*").eq("id", id).single();
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (task.status !== "pending") return res.status(400).json({ message: "Only pending tasks can be rejected" });
    const rejectionReason = req.body.reason || "Did not meet community guidelines.";
    const { data: updatedTask, error: updateError } = await supabase
      .from("tasks")
      .update({
        archived: true,
        rejected_by: req.user.name,
        rejected_at: new Date().toISOString(),
        rejection_reason: rejectionReason,
      })
      .eq("id", id)
      .select()
      .single();

    if (updateError) throw updateError;

    if (task.created_by_user_id) {
      await supabase.from("notifications").insert({
        user_id: task.created_by_user_id,
        message: `Your task "${task.title}" was not approved. Reason: "${rejectionReason}"`,
        task_id: id,
        task_title: task.title,
      });
      emitNotification(task.created_by_user_id, { message: `Task rejected: ${task.title}` });
    }
    await audit("TASK_REJECTED", req.user, "task", id, task.title, { reason: rejectionReason });
    res.json(fixIds(updatedTask));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put("/admin/tasks/:id/edit", requireAuth, requireDispatcher, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = {};
    const allowed = ["title", "description", "category", "points", "difficulty", "urgency", "deadline", "location", "lat", "lng"];
    for (const field of allowed) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    if (updates.points) {
      const { data: config } = await supabase.from("config").select("max_points_per_task").limit(1).single();
      updates.points = Math.min(updates.points, config.max_points_per_task);
    }
    const { data: updatedTask, error } = await supabase
      .from("tasks")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    await audit("TASK_EDITED_BY_ADMIN", req.user, "task", id, updatedTask.title);
    res.json(fixIds(updatedTask));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put("/admin/tasks/:id/archive", requireAuth, requireDispatcher, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: task } = await supabase.from("tasks").select("*").eq("id", id).single();
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (task.archived) return res.status(400).json({ message: "Task already archived" });
    if (task.status !== "completed") return res.status(400).json({ message: "Only completed tasks can be archived" });

    const { data: updatedTask, error: updateError } = await supabase
      .from("tasks")
      .update({
        archived: true,
        archived_at: new Date().toISOString(),
        archived_by: req.user.name,
      })
      .eq("id", id)
      .select()
      .single();

    if (updateError) throw updateError;

    if (task.accepted_by_user_id) {
      const { data: helper } = await supabase.from("users").select("last_active_at, consecutive_streak").eq("id", task.accepted_by_user_id).single();
      const now = new Date();
      const lastActive = helper.last_active_at ? new Date(helper.last_active_at) : null;
      let newStreak = (helper.consecutive_streak || 0) + 1;
      if (lastActive && (now - lastActive) > 24 * 60 * 60 * 1000) {
        newStreak = 1;
      }
      await supabase.rpc('increment_user_points', { user_id: task.accepted_by_user_id, points_to_add: task.points });
      const { data: helperStats } = await supabase.from("users").select("total_tasks_helped").eq("id", task.accepted_by_user_id).single();
      await supabase.from("users").update({
        total_tasks_helped: (helperStats?.total_tasks_helped || 0) + 1,
        consecutive_streak: newStreak,
        last_active_at: now.toISOString(),
      }).eq("id", task.accepted_by_user_id);
      await recalcEngagement(task.accepted_by_user_id);

      await supabase.from("notifications").insert({
        user_id: task.accepted_by_user_id,
        message: `You earned ${task.points} points for completing "${task.title}"! Great work!`,
        task_id: id,
        task_title: task.title,
      });
      emitNotification(task.accepted_by_user_id, { message: `+${task.points} points earned!` });
    }
    await audit("TASK_ARCHIVED", req.user, "task", id, task.title, { pointsAwarded: task.points });
    res.json(fixIds(updatedTask));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Bulk approve/reject
app.post("/admin/tasks/bulk-approve", requireAuth, requireDispatcher, async (req, res) => {
  try {
    const { taskIds } = req.body;
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ message: "Provide an array of task IDs." });
    }
    const { data: config } = await supabase.from("config").select("*").limit(1).single();
    const results = [];
    for (const id of taskIds) {
      const { data: task } = await supabase.from("tasks").select("*").eq("id", id).single();
      if (task && task.status === "pending") {
        let multiplier = config.point_multiplier;
        if (config.bonus_category && task.category === config.bonus_category) {
          multiplier *= config.bonus_multiplier;
        }
        let newPoints = Math.min(Math.round(task.points * multiplier), config.max_points_per_task);
        await supabase.from("tasks").update({
          points: newPoints,
          status: "open",
          approved_by: req.user.name,
          approved_at: new Date().toISOString(),
        }).eq("id", id);
        results.push({ id, success: true });
      } else {
        results.push({ id, success: false, reason: "Not pending or not found" });
      }
    }
    await audit("BULK_APPROVE", req.user, "system", null, `${results.filter(r => r.success).length} tasks`);
    res.json({ results });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/admin/tasks/bulk-reject", requireAuth, requireDispatcher, async (req, res) => {
  try {
    const { taskIds, reason } = req.body;
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ message: "Provide an array of task IDs." });
    }
    const results = [];
    for (const id of taskIds) {
      const { data: task } = await supabase.from("tasks").select("*").eq("id", id).single();
      if (task && task.status === "pending") {
        await supabase.from("tasks").update({
          archived: true,
          rejected_by: req.user.name,
          rejected_at: new Date().toISOString(),
          rejection_reason: reason || "Bulk rejection by admin",
        }).eq("id", id);
        results.push({ id, success: true });
      } else {
        results.push({ id, success: false, reason: "Not pending or not found" });
      }
    }
    await audit("BULK_REJECT", req.user, "system", null, `${results.filter(r => r.success).length} tasks`);
    res.json({ results });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Flags
app.get("/admin/flags", requireAuth, requireDispatcher, async (req, res) => {
  try {
    const { data: flagged, error } = await supabase
      .from("flags")
      .select("*, tasks(*)")
      .eq("resolved", false)
      .order("flagged_at", { ascending: false });
    if (error) throw error;
    const tasksMap = {};
    flagged.forEach(flag => {
      if (!tasksMap[flag.task_id]) tasksMap[flag.task_id] = { ...flag.tasks, flagReports: [] };
      tasksMap[flag.task_id].flagReports.push({
        flaggedBy: flag.flagged_by_name,
        flaggedByUserId: flag.flagged_by_user_id,
        reason: flag.reason,
        flaggedAt: flag.flagged_at,
        resolved: flag.resolved,
        resolvedBy: flag.resolved_by,
        resolvedAt: flag.resolved_at,
      });
    });
    res.json(fixIds(Object.values(tasksMap)));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put("/admin/flags/:taskId/:flagIndex/resolve", requireAuth, requireDispatcher, async (req, res) => {
  try {
    const { taskId, flagIndex } = req.params;
    const { data: flags } = await supabase
      .from("flags")
      .select("id")
      .eq("task_id", taskId)
      .eq("resolved", false)
      .order("flagged_at", { ascending: true });
    if (!flags || flags.length <= parseInt(flagIndex)) return res.status(404).json({ message: "Flag not found" });
    const flagId = flags[flagIndex].id;
    await supabase
      .from("flags")
      .update({
        resolved: true,
        resolved_by: req.user.name,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", flagId);
    res.json({ message: "Flag resolved" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// User Management
app.get("/admin/users", requireAuth, requireDispatcher, async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from("users")
      .select("id, name, email, role, points, skills, interests, location_lat, location_lng, location_address, is_flagged, flag_reason, engagement_score, total_tasks_posted, total_tasks_helped, consecutive_streak, last_active_at, average_rating, total_rating_count, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json(fixIds(users));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put("/admin/users/:id/flag", requireAuth, requireDispatcher, async (req, res) => {
  try {
    const { id } = req.params;
    const { isFlagged, flagReason } = req.body;
    const { data: user, error } = await supabase
      .from("users")
      .update({
        is_flagged: !!isFlagged,
        flag_reason: isFlagged ? flagReason || "Flagged by moderator" : null,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    await audit(isFlagged ? "USER_FLAGGED" : "USER_UNFLAGGED", req.user, "user", id, user.name, { reason: flagReason });
    res.json(fixIds(user));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put("/admin/users/:id/role", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    if (!["community", "dispatcher", "admin"].includes(role)) {
      return res.status(400).json({ message: "Invalid role." });
    }
    const { data: user, error } = await supabase
      .from("users")
      .update({ role })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    await audit("USER_ROLE_CHANGED", req.user, "user", id, user.name, { newRole: role });
    res.json(fixIds(user));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Config
app.get("/admin/config", requireAuth, requireDispatcher, async (req, res) => {
  try {
    const { data: cfg } = await supabase.from("config").select("*").limit(1).single();
    res.json(cfg);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put("/admin/config", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { pointMultiplier, bonusCategory, bonusMultiplier, maxPointsPerTask } = req.body;
    const updates = {};
    if (pointMultiplier !== undefined) updates.point_multiplier = pointMultiplier;
    if (bonusCategory !== undefined) updates.bonus_category = bonusCategory || null;
    if (bonusMultiplier !== undefined) updates.bonus_multiplier = bonusMultiplier;
    if (maxPointsPerTask !== undefined) updates.max_points_per_task = maxPointsPerTask;
    updates.updated_at = new Date().toISOString();
    const { data: cfg, error } = await supabase
      .from("config")
      .update(updates)
      .eq("id", (await supabase.from("config").select("id").limit(1)).data?.[0]?.id)
      .select()
      .single();
    if (error) throw error;
    await audit("CONFIG_UPDATED", req.user, "config", cfg.id, "Reward Config", updates);
    res.json(cfg);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Audit Log
app.get("/admin/audit", requireAuth, requireDispatcher, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Number(req.query.limit) || 30);
    const offset = (page - 1) * limit;
    const { data: entries, error } = await supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    const { count: total } = await supabase.from("audit_logs").select("*", { count: "exact", head: true });
    if (error) throw error;
    res.json({ entries: fixIds(entries), total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Backup
app.get("/admin/backup", requireAuth, requireDispatcher, async (req, res) => {
  try {
    const [tasks, users, notifications, auditLogs, config] = await Promise.all([
      supabase.from("tasks").select("*"),
      supabase.from("users").select("id, name, email, role, points, skills, interests, location_lat, location_lng, location_address, is_flagged, engagement_score, total_tasks_posted, total_tasks_helped, consecutive_streak, average_rating, total_rating_count, created_at"),
      supabase.from("notifications").select("*"),
      supabase.from("audit_logs").select("*"),
      supabase.from("config").select("*").limit(1).single(),
    ]);
    const backup = {
      exportedAt: new Date().toISOString(),
      version: "1.0",
      tasks: tasks.data,
      users: users.data,
      notifications: notifications.data,
      auditLogs: auditLogs.data,
      config: config.data,
    };
    await audit("BACKUP_DOWNLOADED", req.user, "system", null, "Full Backup");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="neighbornet-backup-${new Date().toISOString().split("T")[0]}.json"`);
    res.json(backup);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Restore (admin only)
app.post("/admin/restore", requireAuth, requireAdmin, async (req, res) => {
  try {
    const backup = req.body;
    if (!backup || !backup.tasks || !backup.users || !backup.config) {
      return res.status(400).json({ message: "Invalid backup file. Must contain tasks, users, and config." });
    }

    for (const user of backup.users) {
      const { id, name, email, role, points, skills, interests, location_lat, location_lng, location_address, is_flagged, flag_reason, engagement_score, total_tasks_posted, total_tasks_helped, consecutive_streak, last_active_at, average_rating, total_rating_count, created_at } = user;
      await supabase.from("users").upsert({
        id, name, email, role, points, skills, interests, location_lat, location_lng, location_address,
        is_flagged, flag_reason, engagement_score, total_tasks_posted, total_tasks_helped,
        consecutive_streak, last_active_at, average_rating, total_rating_count, created_at,
        updated_at: new Date().toISOString()
      }, { onConflict: "id" });
    }

    for (const task of backup.tasks) {
      const { id, title, description, category, points, difficulty, urgency, deadline, location, lat, lng, status, created_by, created_by_user_id, accepted_by, accepted_by_user_id, approved_by, approved_at, rejected_by, rejection_reason, rejected_at, completed_at, archived, archived_at, archived_by, rating_score, rating_comment, rated_at, created_at, evidence_images } = task;
      await supabase.from("tasks").upsert({
        id, title, description, category, points, difficulty, urgency, deadline, location, lat, lng,
        status, created_by, created_by_user_id, accepted_by, accepted_by_user_id, approved_by, approved_at,
        rejected_by, rejection_reason, rejected_at, completed_at, archived, archived_at, archived_by,
        rating_score, rating_comment, rated_at, created_at, evidence_images: evidence_images || []
      }, { onConflict: "id" });
    }

    if (backup.notifications) {
      for (const notif of backup.notifications) {
        await supabase.from("notifications").upsert(notif, { onConflict: "id" });
      }
    }

    if (backup.config) {
      await supabase.from("config").upsert(backup.config, { onConflict: "id" });
    }

    await audit("DATABASE_RESTORED", req.user, "system", null, `Restored from backup with ${backup.tasks.length} tasks, ${backup.users.length} users`);
    res.json({ message: "Database restored successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});

// Analytics
app.get("/admin/analytics", requireAuth, requireDispatcher, async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: tasksLast30 } = await supabase
      .from("tasks")
      .select("created_at")
      .gte("created_at", thirtyDaysAgo);
    const tasksByDay = {};
    tasksLast30?.forEach(t => {
      const day = t.created_at.split("T")[0];
      tasksByDay[day] = (tasksByDay[day] || 0) + 1;
    });
    const tasksLast30Array = Object.entries(tasksByDay).map(([_id, count]) => ({ _id, count })).sort((a, b) => a._id.localeCompare(b._id));

    const { data: completedLast30 } = await supabase
      .from("tasks")
      .select("completed_at")
      .gte("completed_at", thirtyDaysAgo)
      .not("completed_at", "is", null);
    const completedByDay = {};
    completedLast30?.forEach(t => {
      const day = t.completed_at.split("T")[0];
      completedByDay[day] = (completedByDay[day] || 0) + 1;
    });
    const completedLast30Array = Object.entries(completedByDay).map(([_id, count]) => ({ _id, count })).sort((a, b) => a._id.localeCompare(b._id));

    const { count: activeUsers } = await supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .or(`last_active_at.gte.${sevenDaysAgo},total_tasks_posted.gt.0,total_tasks_helped.gt.0`);

    const { count: totalUsers } = await supabase.from("users").select("*", { count: "exact", head: true }).eq("role", "community");
    const { count: totalCompleted } = await supabase.from("tasks").select("*", { count: "exact", head: true }).eq("status", "completed");
    const { count: totalNonPending } = await supabase.from("tasks").select("*", { count: "exact", head: true }).neq("status", "pending");
    const completionRate = totalNonPending > 0 ? (totalCompleted / totalNonPending) * 100 : 0;
    const { count: pendingDisputes } = await supabase.from("disputes").select("*", { count: "exact", head: true }).eq("status", "pending");

    res.json({
      tasksLast30: tasksLast30Array,
      completedLast30: completedLast30Array,
      activeUsers,
      totalUsers,
      completionRate: Math.round(completionRate),
      pendingDisputes,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Serve built frontend in production
const path = require('path');
const clientBuildPath = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientBuildPath));

// Catch-all: send index.html for any non-API route (supports /admin, /auth, etc.)
app.use((req, res, next) => {
  // Only serve index.html for GET requests that don't start with /api (though API routes are earlier)
  if (req.method === 'GET') {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  } else {
    next();
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});