import { Router } from 'express';
import type { IRouter } from 'express';
import { and, asc, count, desc, eq, lt, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { conversationMembers, conversations, messages, tokenTransfers } from '../db/schema.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { redis, CONV_CACHE_TTL, convCacheKey } from '../lib/redis.js';

export const conversationsRouter: IRouter = Router();

conversationsRouter.use(requireAuth);

const SEARCH_RESULT_LIMIT = 20;

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
          members: {
            with: {
              user: {
                columns: { id: true, username: true, avatarUrl: true },
                with: { wallets: { columns: { address: true, isPrimary: true } } },
              },
            },
          },
          messages: {
            orderBy: desc(messages.createdAt),
            limit: 1,
            with: { sender: { columns: { id: true, username: true, avatarUrl: true } } },
          },
        },
      },
    },
  });

  // Single subquery for message counts — no N+1
  const conversationIds = memberships.map((m) => m.conversationId);
  const countRows =
    conversationIds.length > 0
      ? await db
          .select({ conversationId: messages.conversationId, count: count() })
          .from(messages)
          .where(sql`${messages.conversationId} = ANY(ARRAY[${sql.join(conversationIds.map((id) => sql`${id}::uuid`), sql`, `)}])`)
          .groupBy(messages.conversationId)
      : [];

  const countMap = new Map(countRows.map((r) => [r.conversationId, r.count]));

  const result = memberships.map((m) => ({
    ...m.conversation,
    messageCount: countMap.get(m.conversationId) ?? 0,
  }));

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

// #14 — GET /conversations/:id/messages
// Cursor-based pagination via ?before=<messageId>&limit=<n> (max 50).
// Returns messages in ascending order with a `nextCursor` field.
const MAX_MESSAGES_LIMIT = 50;
const DEFAULT_MESSAGES_LIMIT = 30;

conversationsRouter.get('/:id/messages', async (req: AuthRequest, res) => {
  const userId = req.auth!.userId;
  const conversationId = req.params['id'] as string | undefined;

  if (!conversationId) {
    res.status(400).json({ error: 'Conversation id is required' });
    return;
  }

  // Parse & clamp limit
  const rawLimit = parseInt(req.query['limit'] as string, 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_MESSAGES_LIMIT)
    : DEFAULT_MESSAGES_LIMIT;

  const before = typeof req.query['before'] === 'string' ? req.query['before'] : undefined;

  // Membership check — non-members receive 403
  const membership = await db.query.conversationMembers.findFirst({
    where: and(
      eq(conversationMembers.conversationId, conversationId),
      eq(conversationMembers.userId, userId),
    ),
  });

  if (!membership) {
    res.status(403).json({ error: 'Not a member of this conversation' });
    return;
  }

  // Resolve cursor: look up the `createdAt` of the "before" message
  let cursor: Date | undefined;
  if (before) {
    const ref = await db.query.messages.findFirst({
      where: eq(messages.id, before),
    });
    if (!ref) {
      res.status(400).json({ error: 'Invalid cursor' });
      return;
    }
    cursor = ref.createdAt;
  }

  // Fetch one extra to determine whether there is a next page
  const rows = await db.query.messages.findMany({
    where: cursor
      ? and(eq(messages.conversationId, conversationId), lt(messages.createdAt, cursor))
      : eq(messages.conversationId, conversationId),
    orderBy: desc(messages.createdAt),
    limit: limit + 1,
    with: { sender: { columns: { id: true, username: true, avatarUrl: true } } },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  // Return in ascending (oldest-first) order
  page.reverse();

  const nextCursor = hasMore ? page[0]?.id ?? null : null;

  res.json({ messages: page, nextCursor });
});

conversationsRouter.get('/:id/search', async (req: AuthRequest, res) => {
  const userId = req.auth!.userId;
  const conversationId = req.params['id'] as string | undefined;
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  if (!conversationId) {
    res.status(400).json({ error: 'Conversation id is required' });
    return;
  }

  if (!query) {
    res.status(400).json({ error: 'Search query is required' });
    return;
  }

  const membership = await db.query.conversationMembers.findFirst({
    where: and(
      eq(conversationMembers.conversationId, conversationId),
      eq(conversationMembers.userId, userId),
    ),
  });

  if (!membership) {
    res.status(403).json({ error: 'Not a member of this conversation' });
    return;
  }

  const results = await db.execute<{
    id: string;
    conversationId: string;
    senderId: string;
    content: string;
    createdAt: Date;
    snippet: string;
    rank: string;
  }>(sql`
    WITH search_query AS (
      SELECT websearch_to_tsquery('english', ${query}) AS query
    )
    SELECT
      ${messages.id} AS "id",
      ${messages.conversationId} AS "conversationId",
      ${messages.senderId} AS "senderId",
      ${messages.content} AS "content",
      ${messages.createdAt} AS "createdAt",
      ts_headline(
        'english',
        ${messages.content},
        search_query.query,
        'StartSel=<mark>, StopSel=</mark>, MaxWords=24, MinWords=8, ShortWord=3, HighlightAll=false'
      ) AS "snippet",
      ts_rank_cd(to_tsvector('english', ${messages.content}), search_query.query) AS "rank"
    FROM ${messages}, search_query
    WHERE ${messages.conversationId} = ${conversationId}
      AND search_query.query @@ to_tsvector('english', ${messages.content})
    ORDER BY "rank" DESC, ${messages.createdAt} DESC
    LIMIT ${SEARCH_RESULT_LIMIT}
  `);

  res.json({ results });
});

// Save a token transfer for a conversation
conversationsRouter.post('/:id/transfers', async (req: AuthRequest, res) => {
  const userId = req.auth!.userId;
  const conversationId = req.params['id'] as string | undefined;

  if (!conversationId) {
    res.status(400).json({ error: 'Conversation id is required' });
    return;
  }

  // Check membership
  const membership = await db.query.conversationMembers.findFirst({
    where: and(
      eq(conversationMembers.conversationId, conversationId),
      eq(conversationMembers.userId, userId),
    ),
  });

  if (!membership) {
    res.status(403).json({ error: 'Not a member of this conversation' });
    return;
  }

  const recipientAddress = req.body.recipient_address ?? req.body.recipientAddress;
  const amount = req.body.amount;
  const tokenContractId = req.body.token_contract_id ?? req.body.tokenContractId;
  const txHash = req.body.tx_hash ?? req.body.txHash;
  const memo = req.body.memo;

  if (!recipientAddress || amount === undefined || !tokenContractId || !txHash) {
    res.status(400).json({ error: 'recipientAddress, amount, tokenContractId, and txHash are required' });
    return;
  }

  // Check for duplicate txHash
  const existing = await db.query.tokenTransfers.findFirst({
    where: eq(tokenTransfers.txHash, txHash),
  });

  if (existing) {
    res.status(409).json({ error: 'Transaction hash already exists' });
    return;
  }

  try {
    const [newTransfer] = await db
      .insert(tokenTransfers)
      .values({
        conversationId,
        senderId: userId,
        recipientAddress,
        amount: String(amount),
        tokenContractId,
        txHash,
        memo: memo ?? null,
      })
      .returning();

    res.status(201).json(newTransfer);
  } catch (err) {
    res.status(409).json({ error: 'Database conflict or validation error' });
  }
});

// List token transfers for a conversation
conversationsRouter.get('/:id/transfers', async (req: AuthRequest, res) => {
  const userId = req.auth!.userId;
  const conversationId = req.params['id'] as string | undefined;

  if (!conversationId) {
    res.status(400).json({ error: 'Conversation id is required' });
    return;
  }

  // Check membership
  const membership = await db.query.conversationMembers.findFirst({
    where: and(
      eq(conversationMembers.conversationId, conversationId),
      eq(conversationMembers.userId, userId),
    ),
  });

  if (!membership) {
    res.status(403).json({ error: 'Not a member of this conversation' });
    return;
  }

  try {
    const transfers = await db.query.tokenTransfers.findMany({
      where: eq(tokenTransfers.conversationId, conversationId),
      orderBy: desc(tokenTransfers.createdAt),
    });

    res.json(transfers);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve transfers' });
  }
});
