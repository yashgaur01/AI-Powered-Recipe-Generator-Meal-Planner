import { verifyAccessToken } from "../lib/jwt.js";

function extractToken(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

export function attachUserIfPresent(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next();

  try {
    req.user = verifyAccessToken(token);
  } catch (_error) {
    req.user = null;
  }
  return next();
}

export function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }

  try {
    req.user = verifyAccessToken(token);
    return next();
  } catch (_error) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const userRole = String(req.user.role || "USER").toUpperCase();
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ message: "You do not have permission to access this resource" });
    }

    return next();
  };
}
