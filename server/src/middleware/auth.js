import jwt from 'jsonwebtoken';
import { httpError } from '../lib/errors.js';

const COOKIE = 'shogird_token';
// JWT лежит в httpOnly cookie: JavaScript страницы его не видит, значит XSS не украдёт токен.
const cookieOptions = () => ({ httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });

export function setAuthCookie(res, payload) {
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.cookie(COOKIE, token, { ...cookieOptions(), maxAge: 7 * 24 * 3600 * 1000 });
}

export const clearAuthCookie = (res) => res.clearCookie(COOKIE, cookieOptions());

// Ставит req.user, если cookie валиден; иначе пропускает как гостя
export function optionalAuth(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (token) {
    try {
      const p = jwt.verify(token, process.env.JWT_SECRET);
      req.user = { userId: p.userId, role: p.role, profileId: p.profileId };
    } catch { /* просроченный или подделанный токен = гость */ }
  }
  next();
}

export function requireAuth(req, res, next) {
  optionalAuth(req, res, () => {
    if (!req.user) return next(httpError(401, 'UNAUTHORIZED', 'Login required'));
    next();
  });
}

export const requireRole = (...roles) => (req, res, next) =>
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (!roles.includes(req.user.role)) return next(httpError(403, 'FORBIDDEN', 'Access denied'));
    next();
  });
