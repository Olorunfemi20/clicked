import type { Socket } from 'socket.io';
import { verifyToken, type JwtPayload } from '../lib/jwt.js';

export interface AuthSocket extends Socket {
  auth?: JwtPayload;
}

export function socketAuthMiddleware(
  socket: AuthSocket,
  next: (err?: Error) => void,
): void {
  const token = socket.handshake.auth['token'] as string | undefined;

  if (!token) {
    next(new Error('Authentication token required'));
    return;
  }

  try {
    socket.auth = verifyToken(token);
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
}
