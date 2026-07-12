console.log("✅ PRODUCT ROUTES MOUNTED at /api/products");
console.log("🔥🔥🔥 NEW SECURE SERVER RUNNING 🔥🔥🔥");

const express = require("express");
const http = require("http"); 
const { Server } = require("socket.io"); 
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const pool = require("./config/db");
const { assertDatabaseConfiguration } = pool;
const ensureSchema = require("./utils/ensureSchema");
require("dotenv").config();
const privateChatRoutes = require('./routes/privateChatRoutes');
const app = express();
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);

const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173,https://promotinsight.com")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const uploadsDir = path.resolve(__dirname, "..", "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

// ==========================================
// 📡 CREATE HTTP SERVER & INIT SOCKET.IO
// ==========================================
const server = http.createServer(app); 
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true 
  }
});
app.set('io', io);

// ==========================================
// 🛡️ ENTERPRISE-GRADE SECURITY MIDDLEWARES
// ==========================================

// 1. Set Security HTTP Headers
app.use(helmet());
app.use(helmet.crossOriginResourcePolicy({ policy: "cross-origin" })); 

// 2. CORS Setup
app.use(cors({
    origin: allowedOrigins,
    credentials: true,  // <--- এখানে একটি কমা (,) যুক্ত করা হয়েছে
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));

app.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

  const requestOrigin = req.get("origin") || req.get("referer");
  if (!requestOrigin) {
    return process.env.NODE_ENV === "production"
      ? res.status(403).json({ success: false, message: "Request origin required" })
      : next();
  }

  try {
    const origin = new URL(requestOrigin).origin;
    if (allowedOrigins.includes(origin)) return next();
  } catch {
    return res.status(403).json({ success: false, message: "Invalid request origin" });
  }

  return res.status(403).json({ success: false, message: "Request origin not allowed" });
});

// 3. Body Parser
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

// 4. Cookie Parser
app.use(cookieParser());

// 6. Global Rate Limiting
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 1000, 
    message: { success: false, message: "Too many requests from this IP, please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use("/api", globalLimiter);

// ==========================================
// 📁 STATIC FOLDER (Images)
// ==========================================
app.use("/uploads", express.static(uploadsDir));

// ==========================================
// 🔴 SOCKET.IO REAL-TIME TRACKING LOGIC
// ==========================================
let activeUsers = {};
const onlineUsersMap = new Map(); // 🟢 মাল্টিপল ট্যাবের জন্য Map ব্যবহার করা হলো
const privateChatSocket = require('./socket/privateChatSocket'); 

io.on('connection', (socket) => {
  console.log('🟢 New user connected via Socket:', socket.id);
  socket.join(`user_${socket.user.id}`);

  privateChatSocket(io, socket); 

  // 🟢 User Online Tracking (Multiple Tab Fix)
  socket.on('user_online', () => {
    onlineUsersMap.set(socket.id, String(socket.user.id));
    const uniqueOnlineUsers = Array.from(new Set(onlineUsersMap.values()));
    io.emit('online_users_update', uniqueOnlineUsers); 
  });

  socket.on('request_online_users', () => {
    const uniqueOnlineUsers = Array.from(new Set(onlineUsersMap.values()));
    socket.emit('online_users_update', uniqueOnlineUsers);
  });

  socket.on('page_change', (data) => {
    activeUsers[socket.id] = { page: data.page, timestamp: new Date() };
    io.emit('active_users_update', Object.keys(activeUsers).length);
  });

  socket.on('disconnect', () => {
    console.log('🔴 User disconnected:', socket.id);
    delete activeUsers[socket.id];
    io.emit('active_users_update', Object.keys(activeUsers).length);

    // 🔴 User Disconnect Tracking (স্মার্ট রিমুভ)
    if (onlineUsersMap.has(socket.id)) {
      onlineUsersMap.delete(socket.id);
      const uniqueOnlineUsers = Array.from(new Set(onlineUsersMap.values()));
      io.emit('online_users_update', uniqueOnlineUsers); 
    }
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
const feeConfigRoutes = require("./routes/feeConfigRoutes");
const verificationConfigRoutes = require("./routes/verificationConfigRoutes");

// 🔥 NEW: Payment Method Routes Import
const paymentMethodRoutes = require("./routes/paymentMethodRoutes");

// Mount Routes
app.use("/api/users", userRoutes); 
app.use("/api/products", productRoutes); 
app.use("/api/applications", applicationRoutes);
app.use("/api/withdrawals", withdrawalRoutes); 
app.use("/api/admin", adminRoutes);
app.use("/api/appeals", appealRoutes); 
app.use("/api/support", supportRoutes); 
app.use("/api/announcements", announcementRoutes); 
app.use("/api/blogs", blogRoutes); 
app.use("/api/config/fees", feeConfigRoutes);
app.use("/api/config/verification", verificationConfigRoutes);
app.use('/api/private-chat', privateChatRoutes);
// 🔥 NEW: Payment Method Routes Mount
app.use("/api/payment-methods", paymentMethodRoutes);

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

const assertAuthenticationConfiguration = () => {
  if (!String(process.env.JWT_SECRET || "").trim()) {
    throw new Error("JWT_SECRET is required.");
  }

  if (process.env.NODE_ENV === "production" &&
      !String(process.env.JWT_RESET_SECRET || process.env.PASSWORD_RESET_SECRET || "").trim()) {
    throw new Error("JWT_RESET_SECRET or PASSWORD_RESET_SECRET is required in production.");
  }
};

const startServer = async () => {
  try {
    assertDatabaseConfiguration();
    assertAuthenticationConfiguration();
    await ensureSchema();
    console.log("Database schema is ready");

    server.listen(PORT, () => {
      console.log(`🚀 Secure Enterprise Server running on port ${PORT}`);
      console.log(`📡 Socket.io is ready for real-time tracking!`);
    });
  } catch (error) {
    console.error("Failed to prepare database schema:", error);
    process.exit(1);
  }
};

startServer();

const parseCookieHeader = (cookieHeader = "") => (
  cookieHeader.split(";").reduce((cookies, pair) => {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex === -1) return cookies;
    const key = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {})
);

const getSocketToken = (socket) => {
  const cookies = parseCookieHeader(socket.handshake.headers.cookie);
  return cookies.token;
};

io.use(async (socket, next) => {
  try {
    const token = getSocketToken(socket);
    if (!token) {
      return next(new Error("Authentication required"));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userResult = await pool.query(
      "SELECT id, role, is_active, is_frozen FROM users WHERE id = $1",
      [decoded.id]
    );

    if (userResult.rows.length === 0 || userResult.rows[0].is_active === false) {
      return next(new Error("Invalid socket user"));
    }

    const user = userResult.rows[0];
    socket.user = {
      id: user.id,
      role: String(user.role).trim().toLowerCase(),
      is_active: user.is_active,
      is_frozen: user.is_frozen,
    };

    next();
  } catch (error) {
    next(new Error("Invalid socket token"));
  }
});
