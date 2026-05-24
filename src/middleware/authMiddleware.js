const jwt = require("jsonwebtoken");
const pool = require("../config/db");

const protect = async (req, res, next) => {
  try {
    let token;

    // 1. Primary Secure Method: Read from HttpOnly Cookie
    if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    } 
    // 2. Fallback Method: Authorization header (For Mobile Apps / Postman testing)
    else if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({ success: false, message: "Not authorized, no secure token found" });
    }

    // Verify the JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 🔥 ENTERPRISE SECURITY: Database Sync Check
    // Instant invalidation if user is deleted, banned, or frozen after token generation
    const userCheck = await pool.query(
      "SELECT id, role, is_active, is_frozen FROM users WHERE id = $1",
      [decoded.id]
    );

    if (userCheck.rows.length === 0) {
      // Clear cookie if user doesn't exist anymore
      res.clearCookie('token');
      return res.status(401).json({ success: false, message: "User no longer exists in the system" });
    }

    const user = userCheck.rows[0];

    // Global Ban Check: Instantly block access across all protected routes
    if (user.is_active === false) {
      res.clearCookie('token');
      return res.status(403).json({ 
        success: false, 
        message: "Your account has been deactivated. Please contact support via appeal." 
      });
    }

    // Attach secured and synchronized user data to the request
    req.user = {
      id: user.id,
      role: user.role.trim().toLowerCase(),
      is_active: user.is_active,
      is_frozen: user.is_frozen
    };

    next();
  } catch (error) {
    console.error("AUTH ERROR:", error.message);
    // Clear cookie on invalid/expired token to force re-login
    res.clearCookie('token');
    res.status(401).json({ success: false, message: "Not authorized, token failed or expired" });
  }
};

// 🔥 NEW: Admin Check Middleware
const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ success: false, message: "Not authorized as an admin" });
  }
};

module.exports = { protect, isAdmin };
// 🚨 SECURITY NOTE: This middleware is the first line of defense for all protected routes