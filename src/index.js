console.log("✅ PRODUCT ROUTES MOUNTED at /api/products");
console.log("🔥🔥🔥 NEW SECURE SERVER RUNNING 🔥🔥🔥");

const express = require("express");
const http = require("http"); // 🔥 NEW: http module import kora holo
const { Server } = require("socket.io"); // 🔥 NEW: socket.io theke Server import kora holo
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const pool = require("./config/db");
require("dotenv").config();

const app = express();

// ==========================================
// 📡 CREATE HTTP SERVER & INIT SOCKET.IO
// ==========================================
const server = http.createServer(app); // 🔥 NEW: Express app ke HTTP server er sathe connect kora holo
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173", // Only allow your frontend
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true // MUST BE TRUE
  }
});

// ==========================================
// 🛡️ ENTERPRISE-GRADE SECURITY MIDDLEWARES
// ==========================================

// 1. Set Security HTTP Headers (Blocks Clickjacking, Sniffing, etc.)
app.use(helmet());
app.use(helmet.crossOriginResourcePolicy({ policy: "cross-origin" })); // Allows safe cross-origin image loading

// 2. CORS Setup (Strict Origins & Credentials)
app.use(cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true, 
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// 3. Body Parser with Payload Limits (Prevents DoS via large payloads)
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

// 4. Cookie Parser (🔥 REQUIRED for reading HttpOnly JWT cookies)
app.use(cookieParser());

// 6. Global Rate Limiting (Defense in Depth Fallback)
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limit each IP to 1000 total requests
    message: { success: false, message: "Too many requests from this IP, please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use("/api", globalLimiter);

// ==========================================
// 📁 STATIC FOLDER (Images)
// ==========================================
app.use("/uploads", express.static("uploads"));

// ==========================================
// 🔴 SOCKET.IO REAL-TIME TRACKING LOGIC
// ==========================================
let activeUsers = {};

io.on('connection', (socket) => {
  console.log('🟢 New user connected via Socket:', socket.id);

  // User jokhon kono page e jabe
  socket.on('page_change', (data) => {
    activeUsers[socket.id] = {
      page: data.page,
      timestamp: new Date()
    };
    
    // Admin der ke updated count pathano
    io.emit('active_users_update', Object.keys(activeUsers).length);
  });

  // User jokhon ber hoye jabe
  socket.on('disconnect', () => {
    console.log('🔴 User disconnected:', socket.id);
    delete activeUsers[socket.id];
    
    // Admin der ke updated count pathano
    io.emit('active_users_update', Object.keys(activeUsers).length);
  });
});

// ==========================================
// 🔗 ROUTES IMPORT & MOUNT
// ==========================================
const userRoutes = require("./routes/userRoutes");
const productRoutes = require("./routes/productRoutes");
const applicationRoutes = require("./routes/applicationRoutes");
const withdrawalRoutes = require("./routes/withdrawalRoutes");
const adminRoutes = require("./routes/adminRoutes");
const appealRoutes = require("./routes/appealRoutes"); 
const supportRoutes = require("./routes/supportRoutes"); 
const announcementRoutes = require("./routes/announcementRoutes"); 
const blogRoutes = require("./routes/blogRoutes"); 
// 🔥 NEW: Fee Configuration Routes import kora holo
const feeConfigRoutes = require("./routes/feeConfigRoutes");

app.use("/api/users", userRoutes); 
app.use("/api/products", productRoutes); 
app.use("/api/applications", applicationRoutes);
app.use("/api/withdrawals", withdrawalRoutes); 
app.use("/api/admin", adminRoutes);
app.use("/api/appeals", appealRoutes); 
app.use("/api/support", supportRoutes); 
app.use("/api/announcements", announcementRoutes); 
app.use("/api/blogs", blogRoutes); 
// 🔥 NEW: Fee Configuration API route mount kora holo
app.use("/api/config/fees", feeConfigRoutes);

// ==========================================
// 🌐 HEALTH CHECK & ERROR HANDLING
// ==========================================
app.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({
      success: true,
      message: "Secure API running ✔",
      time: result.rows[0].now,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "DB connection error" });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// Global Error handler
app.use((err, req, res, next) => {
  console.error("🔥 GLOBAL ERROR:", err.stack);
  res.status(500).json({ success: false, message: "Internal Server Error" });
});

// ==========================================
// 🕒 START BACKGROUND JOBS
// ==========================================
const startCronJobs = require('./cronJobs'); 
startCronJobs(); 

// ==========================================
// 🚀 SERVER IGNITION
// ==========================================
const PORT = process.env.PORT || 5000;

// 🔥 CHANGED: app.listen er bodole server.listen kora hoyeche
server.listen(PORT, () => {
  console.log(`🚀 Secure Enterprise Server running on port ${PORT}`);
  console.log(`📡 Socket.io is ready for real-time tracking!`);
});