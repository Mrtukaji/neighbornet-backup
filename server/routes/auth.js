const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { supabase } = require("../db");

// Define TASK_CATEGORIES directly (must match frontend)
const TASK_CATEGORIES = [
  "Gardening", "Plumbing", "Electrical", "Carpentry", "Cleaning", "Cooking",
  "Childcare", "Elderly Care", "Tech Support", "Transport / Errand",
  "Medical / First Aid", "General Labor",
];

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "neighbornet_super_secret_key";

// SIGN UP
router.post("/signup", async (req, res) => {
  try {
    const { name, email, password, skills, interests, lat, lng, address } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: "All fields are required." });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }

    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("email", email.toLowerCase().trim())
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ message: "Email is already registered." });
    }

    const validatedSkills = Array.isArray(skills)
      ? skills.filter((s) => TASK_CATEGORIES.includes(s))
      : [];
    const validatedInterests = Array.isArray(interests) ? interests : [];

    const hashedPassword = await bcrypt.hash(password, 10);

    const { data: newUser, error } = await supabase
      .from("users")
      .insert({
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        role: "community",
        skills: validatedSkills,
        interests: validatedInterests,
        location_lat: lat && !isNaN(lat) ? lat : null,
        location_lng: lng && !isNaN(lng) ? lng : null,
        location_address: address || null,
        email_verified: true,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      message: "Account created successfully. You can now log in.",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});

// LOGIN
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data: user, error } = await supabase
      .from("users")
      .select("id, name, email, role, points, skills, interests, location_lat, location_lng, location_address, password")
      .eq("email", email.toLowerCase().trim())
      .maybeSingle();

    if (!user) return res.status(400).json({ message: "Invalid email or password." });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid email or password." });

    const token = jwt.sign(
      { userId: user.id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: {
        _id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        points: user.points,
        skills: user.skills,
        interests: user.interests,
        location: { lat: user.location_lat, lng: user.location_lng, address: user.location_address },
        emailVerified: true,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET CURRENT USER
router.get("/me", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized." });
    }
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const { data: user, error } = await supabase
      .from("users")
      .select("id, name, email, role, points, skills, interests, location_lat, location_lng, location_address, engagement_score, total_tasks_posted, total_tasks_helped, consecutive_streak, last_active_at, average_rating, total_rating_count")
      .eq("id", decoded.userId)
      .single();

    if (!user) return res.status(404).json({ message: "User not found." });
    res.json({
      _id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      points: user.points,
      skills: user.skills,
      interests: user.interests,
      location: { lat: user.location_lat, lng: user.location_lng, address: user.location_address },
      engagement_score: user.engagement_score,
      total_tasks_posted: user.total_tasks_posted,
      total_tasks_helped: user.total_tasks_helped,
      consecutive_streak: user.consecutive_streak,
      last_active_at: user.last_active_at,
      average_rating: user.average_rating,
      total_rating_count: user.total_rating_count,
    });
  } catch (error) {
    res.status(401).json({ message: "Invalid or expired token." });
  }
});

// UPDATE SKILLS
router.put("/update-skills", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized." });
    }
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const { skills } = req.body;
    if (!Array.isArray(skills)) return res.status(400).json({ message: "Skills must be an array." });
    const validatedSkills = skills.filter((s) => TASK_CATEGORIES.includes(s));
    const { data: user, error } = await supabase
      .from("users")
      .update({ skills: validatedSkills })
      .eq("id", decoded.userId)
      .select()
      .single();

    if (error) throw error;
    res.json({
      _id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      points: user.points,
      skills: user.skills,
      interests: user.interests,
      location: { lat: user.location_lat, lng: user.location_lng, address: user.location_address },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// UPDATE INTERESTS
router.put("/update-interests", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized." });
    }
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const { interests } = req.body;
    if (!Array.isArray(interests)) return res.status(400).json({ message: "Interests must be an array." });
    const { data: user, error } = await supabase
      .from("users")
      .update({ interests })
      .eq("id", decoded.userId)
      .select()
      .single();

    if (error) throw error;
    res.json({
      _id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      points: user.points,
      skills: user.skills,
      interests: user.interests,
      location: { lat: user.location_lat, lng: user.location_lng, address: user.location_address },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// UPDATE HOME LOCATION
router.put("/update-location", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized." });
    }
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const { lat, lng, address } = req.body;
    if (typeof lat !== "number" || typeof lng !== "number") {
      return res.status(400).json({ message: "Valid lat/lng required." });
    }
    const { data: user, error } = await supabase
      .from("users")
      .update({ location_lat: lat, location_lng: lng, location_address: address || null })
      .eq("id", decoded.userId)
      .select()
      .single();

    if (error) throw error;
    res.json({
      _id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      points: user.points,
      skills: user.skills,
      interests: user.interests,
      location: { lat: user.location_lat, lng: user.location_lng, address: user.location_address },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;