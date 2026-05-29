import { Router } from 'express';
import type { IRouter } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { conversationMembers } from '../db/schema.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { redis, CONV_CACHE_TTL, convCacheKey } from '../lib/redis.js';

export const conversationsRouter: IRouter = Router();

conversationsRouter.use(requireAuth);

// List all conversations the authenticated user belongs to
conversationsRouter.get('/', async (req: AuthRequest, res) => {
  const userId = req.auth!.userId;
  const key = convCacheKey(userId);

  // Cache read — skip on cache miss or Redis unavailable
  if (redis) {
    try {
      const cached = await redis.get(key);
      if (cached) {
        res.json(JSON.parse(cached) as unknown);
        return;
      }
    } catch {
      // Fall through to DB on Redis error
    }
  }

  const memberships = await db.query.conversationMembers.findMany({
    where: eq(conversationMembers.userId, userId),
    with: {
      conversation: {
        with: {
          members: { with: { user: { columns: { id: true, username: true, avatarUrl: true } } } },
        },
      },
    },
  });

  const result = memberships.map((m) => m.conversation);

  // Cache write with 30-second TTL
  if (redis) {
    try {
      await redis.setex(key, CONV_CACHE_TTL, JSON.stringify(result));
    } catch {
      // Ignore — response is already computed
    }
  }

  res.json(result);
});
