require("dotenv").config();

const multer = require("multer");
const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

const app = express();

/* ---------------- CLOUDINARY ---------------- */

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const cloudStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: "irn-maps",
    public_id: `floor${req.body.floor || Date.now()}`,
    overwrite: true,
    format: "png",
  }),
});

const upload = multer({ storage: cloudStorage });

/* ---------------- MIDDLEWARE ---------------- */

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(origin => origin.trim()).filter(Boolean)
  : [];

app.use(cors({
  origin: (origin, cb) => {
    if (
      !origin ||
      !process.env.ALLOWED_ORIGINS ||
      allowedOrigins.includes(origin) ||
      origin.startsWith("http://localhost") ||
      origin.startsWith("http://127.0.0.1")
    ) {
      return cb(null, true);
    }
    cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));
app.use(express.json());
app.use("/maps", express.static(path.join(__dirname, "maps")));

/* ---------------- MONGODB ATLAS ---------------- */

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB Atlas Connected");
  })
  .catch((err) => {
    console.error("MongoDB Error:", err);
  });

/* ---------------- ROOM SCHEMA ---------------- */

const roomSchema = new mongoose.Schema({
  name: String,
  coords: [Number],
  floor: Number,
  type: String,
  transitionId: String,
});

const Room = mongoose.model("Room", roomSchema);

/* ---------------- FLOOR SCHEMA ---------------- */

const floorSchema = new mongoose.Schema({
  floor: Number,
  name: String,
  mapImage: String,
  mapVersion: Number,
  width: Number,
  height: Number,
});

const Floor = mongoose.model("Floor", floorSchema);

/* ---------------- USER SCHEMA ---------------- */

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    default: "admin",
  },
});

const User = mongoose.model("User", userSchema);

/* ---------------- AUTH ---------------- */

app.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });

    if (!user) {
      return res.status(401).json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
    }

    res.json({ success: true, role: user.role, username: user.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- ROOMS API ---------------- */

app.get("/rooms", async (req, res) => {
  try {
    const rooms = await Room.find().sort({
      floor: 1,
      name: 1,
    });

    res.json(rooms);
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

app.post("/rooms", async (req, res) => {
  try {
    const room = new Room(req.body);

    await room.save();

    res.json(room);
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

app.put("/rooms/:id", async (req, res) => {
  try {
    const room = await Room.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    res.json(room);
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

app.delete("/rooms/:id", async (req, res) => {
  try {
    await Room.findByIdAndDelete(
      req.params.id
    );

    res.json({
      success: true,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

/* ---------------- FLOORS API ---------------- */

app.get("/floors", async (req, res) => {
  try {
    const floors = await Floor.find().sort({
      floor: 1,
    });

    res.json(floors);
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

app.post("/floors", async (req, res) => {
  try {
    const floor = new Floor(req.body);

    await floor.save();

    res.json(floor);
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

app.put("/floors/:id", async (req, res) => {
  try {
    const floor = await Floor.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    res.json(floor);
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

app.delete("/floors/:id", async (req, res) => {
  try {
    await Floor.findByIdAndDelete(
      req.params.id
    );

    res.json({
      success: true,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

/* ---------------- UPLOAD MAP ---------------- */

app.post("/upload-map", upload.single("map"), async (req, res) => {
  try {
    const floorNum = req.body.floor !== undefined ? Number(req.body.floor) : null;
    if (floorNum === null) return res.status(400).json({ error: "กรุณาระบุ floor" });

    // Cloudinary return URL ตรงจาก req.file.path
    const imageUrl = req.file.path;
    const ts = Date.now();

    const updatedFloor = await Floor.findOneAndUpdate(
      { floor: floorNum },
      { $set: { floor: floorNum, mapImage: imageUrl, mapVersion: ts } },
      { new: true, upsert: true }
    );

    res.json({ success: true, filename: imageUrl, imageUrl, floor: updatedFloor });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- UPDATE FLOOR MAP ---------------- */

app.put("/floors/:id/map", async (req, res) => {
  try {
    const floor = await Floor.findByIdAndUpdate(
      req.params.id,
      {
        mapImage: req.body.mapImage,
      },
      {
        new: true,
      }
    );

    res.json(floor);
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

/* ---------------- CREATE ADMIN ---------------- */

app.post("/create-admin", async (req, res) => {
  try {
    const existing = await User.findOne({ username: "admin" });
    if (existing) return res.json({ success: true, message: "Admin มีอยู่แล้ว" });

    const hashed = await bcrypt.hash("1234", 10);
    const admin = new User({ username: "admin", password: hashed, role: "admin" });
    await admin.save();

    res.json({ success: true, message: "สร้าง Admin สำเร็จ" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- TEST ---------------- */

app.get("/", (req, res) => {
  res.send("Indoor Navigation API Running");
});

/* ---------------- START SERVER ---------------- */

const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Server running on port ${PORT}`
  );
});
