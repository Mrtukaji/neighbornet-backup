const express = require("express");
const router = express.Router();
const { supabase } = require("../db");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "neighbornet_super_secret_key";

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

// Raise a dispute
router.post("/", requireAuth, async (req, res) => {
    try {
        const { targetType, targetId, reason, description } = req.body;
        if (!targetType || !targetId || !reason || !description) {
            return res.status(400).json({ message: "Missing fields." });
        }
        if (!["task", "rating"].includes(targetType)) {
            return res.status(400).json({ message: "Invalid target type." });
        }

        const { data: task, error: taskError } = await supabase
            .from("tasks")
            .select("id, rating_score")
            .eq("id", targetId)
            .single();

        if (!task) return res.status(404).json({ message: "Task not found." });

        if (targetType === "rating" && (!task.rating_score || task.rating_score === null)) {
            return res.status(400).json({ message: "No rating on this task." });
        }

        const { data: existing } = await supabase
            .from("disputes")
            .select("id")
            .eq("raised_by_user_id", req.user.userId)
            .eq("target_id", targetId)
            .eq("status", "pending")
            .maybeSingle();

        if (existing) {
            return res.status(409).json({ message: "You already have a pending dispute for this item." });
        }

        const { data: dispute, error: insertError } = await supabase
            .from("disputes")
            .insert({
                raised_by_user_id: req.user.userId,
                raised_by_name: req.user.name,
                target_type: targetType,
                target_id: targetId,
                reason,
                description,
                status: "pending",
            })
            .select()
            .single();

        if (insertError) throw insertError;
        res.status(201).json(dispute);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: error.message });
    }
});

// Get all disputes (moderator)
router.get("/", requireDispatcher, async (req, res) => {
    try {
        const { data: disputes, error } = await supabase
            .from("disputes")
            .select("*")
            .order("created_at", { ascending: false });
        if (error) throw error;
        res.json(disputes);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Resolve a dispute
router.put("/:id/resolve", requireDispatcher, async (req, res) => {
    try {
        const { resolution, action } = req.body;
        const { id } = req.params;

        const { data: dispute, error: fetchError } = await supabase
            .from("disputes")
            .select("*")
            .eq("id", id)
            .single();

        if (!dispute) return res.status(404).json({ message: "Dispute not found" });
        if (dispute.status !== "pending") return res.status(400).json({ message: "Dispute already resolved" });

        const { error: updateError } = await supabase
            .from("disputes")
            .update({
                status: "resolved",
                resolution: resolution || "Resolved by moderator",
                resolved_by_user_id: req.user.userId,
                resolved_at: new Date().toISOString(),
            })
            .eq("id", id);

        if (updateError) throw updateError;

        if (action === "remove_task" && dispute.target_type === "task") {
            await supabase.from("tasks").delete().eq("id", dispute.target_id);
        } else if (action === "remove_rating" && dispute.target_type === "rating") {
            await supabase
                .from("tasks")
                .update({ rating_score: null, rating_comment: null, rated_at: null })
                .eq("id", dispute.target_id);
        }

        res.json({ message: "Dispute resolved", disputeId: id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;