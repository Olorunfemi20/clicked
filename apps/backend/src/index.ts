import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import morgan from 'morgan';
import { sql } from 'drizzle-orm';
import { db } from './db/index.js';
import { authRouter } from './routes/auth.js';
import { conversationsRouter } from './routes/conversations.js';
import { requireAuth } from './middleware/auth.js';
import { socketAuthMiddleware, type AuthSocket } from './middleware/socketAuth.js';
import { registerMessagingHandlers } from './socket/messaging.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({ status: 'ok', db: 'connected' });
  } catch {
    res.status(503).json({ status: 'error', db: 'unreachable' });
  }
});

app.use('/auth', authRouter);
app.use('/conversations', conversationsRouter);

// Protected route example
app.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.auth });
});

io.use(socketAuthMiddleware);

io.on('connection', (socket: AuthSocket) => {
  console.log('User connected:', socket.auth?.userId, socket.id);
  registerMessagingHandlers(io, socket);
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.auth?.userId);
  });
});

const PORT = process.env['PORT'] ?? 3001;
httpServer.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
