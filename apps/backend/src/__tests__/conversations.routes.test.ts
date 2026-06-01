import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const conversationsTable = { id: 'id', type: 'type' };
const conversationMembersTable = { conversationId: 'conversationId', userId: 'userId' };

const mockFindConversation = vi.fn();
const mockFindMember = vi.fn();
const mockFindMany = vi.fn();
const mockDelete = vi.fn();

vi.mock('../lib/redis.js', () => ({
  get redis() {
    return null;
  },
  CONV_CACHE_TTL: 30,
  convCacheKey: (userId: string) => `conversations:${userId}`,
}));

vi.mock('../db/index.js', () => ({
  db: {
    query: {
      conversations: { findFirst: mockFindConversation },
      conversationMembers: { findFirst: mockFindMember, findMany: mockFindMany },
    },
    delete: mockDelete,
  },
}));

vi.mock('../db/schema.js', () => ({
  conversations: conversationsTable,
  conversationMembers: conversationMembersTable,
  messages: {
    id: 'id',
    conversationId: 'conversationId',
    senderId: 'senderId',
    content: 'content',
    createdAt: 'createdAt',
    deletedAt: 'deletedAt',
  },
  tokenTransfers: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  desc: vi.fn(),
  lt: vi.fn(),
  sql: vi.fn(),
}));

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { auth: { userId: string } }).auth = { userId: 'user-1' };
    next();
  },
}));

const { conversationsRouter } = await import('../routes/conversations.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/conversations', conversationsRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /conversations/:id', () => {
  it('returns 404 for an unknown conversation', async () => {
    mockFindConversation.mockResolvedValue(undefined);

    const res = await request(makeApp()).get('/conversations/conv-1');

    expect(res.status).toBe(404);
    expect(mockFindMember).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller is not a member', async () => {
    mockFindConversation.mockResolvedValue({
      id: 'conv-1',
      type: 'group',
      members: [],
      messages: [],
    });
    mockFindMember.mockResolvedValue(undefined);

    const res = await request(makeApp()).get('/conversations/conv-1');

    expect(res.status).toBe(403);
  });

  it('returns the same conversation shape as the list endpoint', async () => {
    const conversation = {
      id: 'conv-1',
      type: 'group',
      name: 'General',
      members: [
        {
          id: 'member-1',
          conversationId: 'conv-1',
          userId: 'user-1',
          user: {
            id: 'user-1',
            username: 'alice',
            avatarUrl: null,
            wallets: [],
          },
        },
      ],
      messages: [
        {
          id: 'msg-1',
          conversationId: 'conv-1',
          senderId: 'user-1',
          content: 'hello',
          deletedAt: null,
          sender: {
            id: 'user-1',
            username: 'alice',
            avatarUrl: null,
          },
        },
      ],
    };

    mockFindConversation.mockResolvedValue(conversation);
    mockFindMember.mockResolvedValue({ id: 'member-1' });

    const res = await request(makeApp()).get('/conversations/conv-1');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('conv-1');
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0].content).toBe('hello');
  });
});

describe('DELETE /conversations/:id/leave', () => {
  it('returns 400 for DM conversations', async () => {
    mockFindConversation.mockResolvedValue({ id: 'conv-dm', type: 'dm' });

    const res = await request(makeApp()).delete('/conversations/conv-dm/leave');

    expect(res.status).toBe(400);
  });

  it('returns 404 when the caller is not a member', async () => {
    mockFindConversation.mockResolvedValue({ id: 'conv-1', type: 'group' });
    mockFindMember.mockResolvedValue(undefined);

    const res = await request(makeApp()).delete('/conversations/conv-1/leave');

    expect(res.status).toBe(404);
  });

  it('deletes the conversation when the last member leaves', async () => {
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    mockDelete.mockReturnValue({ where: deleteWhere });
    mockFindConversation.mockResolvedValue({ id: 'conv-1', type: 'group' });
    mockFindMember.mockResolvedValue({ id: 'member-1' });
    mockFindMany.mockResolvedValue([{ userId: 'user-1' }]);

    const res = await request(makeApp()).delete('/conversations/conv-1/leave');

    expect(res.status).toBe(204);
    expect(mockDelete).toHaveBeenCalledWith(conversationsTable);
  });

  it('removes only the caller when other members remain', async () => {
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    mockDelete.mockReturnValue({ where: deleteWhere });
    mockFindConversation.mockResolvedValue({ id: 'conv-1', type: 'group' });
    mockFindMember.mockResolvedValue({ id: 'member-1' });
    mockFindMany.mockResolvedValue([{ userId: 'user-1' }, { userId: 'user-2' }]);

    const res = await request(makeApp()).delete('/conversations/conv-1/leave');

    expect(res.status).toBe(204);
    expect(mockDelete).toHaveBeenCalledWith(conversationMembersTable);
    expect(deleteWhere).toHaveBeenCalled();
  });
});