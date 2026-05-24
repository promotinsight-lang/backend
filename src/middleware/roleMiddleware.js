const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    // 1. Authentication Check: Ensure user object exists (set by authMiddleware)
    if (!req.user || !req.user.role) {
      console.warn(`[SECURITY WARN] Unauthorized route access attempt (No User Object). IP: ${req.ip || req.connection.remoteAddress}`);
      return res.status(401).json({ 
        success: false, 
        message: "Unauthorized access. Authentication required." 
      });
    }

    // 2. Normalize roles to prevent case-sensitivity bypass
    const userRole = req.user.role.trim().toLowerCase();
    const normalizedAllowedRoles = allowedRoles.map(role => role.trim().toLowerCase());

    // 3. Authorization Check: Ensure user has the required role
    if (!normalizedAllowedRoles.includes(userRole)) {
      console.warn(`[SECURITY WARN] Access Denied: User ID ${req.user.id} (Role: ${userRole}) attempted to access restricted route. IP: ${req.ip || req.connection.remoteAddress}`);
      return res.status(403).json({ 
        success: false, 
        message: "Access denied. You do not have the necessary permissions for this action." 
      });
    }

    // 4. Passed Authorization
    next();
  };
};

module.exports = authorize;