import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// ── Redis mock ─────────────────────────────────────────────────────────────

const mockGet = vi.fn();
const mockSetex = vi.fn();
const mockDel = vi.fn();

vi.mock('../lib/redis.js', () => ({
  get redis() { return mockRedisInstance; },
  CONV_CACHE_TTL: 30,
  convCacheKey: (userId: string) => `conversations:${userId}`,
}));

let mockRedisInstance: {
  get: typeof mockGet;
  setex: typeof mockSetex;
  del: typeof mockDel;
} | null = {
  get: mockGet,
  setex: mockSetex,
  del: mockDel,
};

// ── DB mock ────────────────────────────────────────────────────────────────

const mockFindMany = vi.fn();

vi.mock('../db/index.js', () => ({
  db: {
    query: {
      conversationMembers: { findMany: mockFindMany },
    },
  },
}));

vi.mock('../db/schema.js', () => ({ conversationMembers: {} }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));

// ── Auth middleware mock: always passes with test userId ───────────────────

const TEST_USER_ID = 'user-test-123';

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { auth: { userId: string } }).auth = { userId: TEST_USER_ID };
    next();
  },
}));

// ── Import router after mocks ──────────────────────────────────────────────

const { conversationsRouter } = await import('../routes/conversations.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/conversations', conversationsRouter);
  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('GET /conversations — Redis caching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisInstance = { get: mockGet, setex: mockSetex, del: mockDel };
  });

  it('returns cached data without hitting DB on cache hit', async () => {
    const cached = [{ id: 'conv-1', type: 'dm' }];
    mockGet.mockResolvedValue(JSON.stringify(cached));

    const res = await request(makeApp()).get('/conversations');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(cached);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('queries DB and writes to cache on cache miss', async () => {
    mockGet.mockResolvedValue(null); // cache miss
    const dbResult = [{ id: 'conv-2', type: 'group' }];
    mockFindMany.mockResolvedValue(dbResult.map((c) => ({ conversation: c })));
    mockSetex.mockResolvedValue('OK');

    const res = await request(makeApp()).get('/conversations');

    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalled();
    expect(mockSetex).toHaveBeenCalledWith(
      `conversations:${TEST_USER_ID}`,
      30,
      JSON.stringify(dbResult),
    );
  });

  it('falls back to DB when Redis is unavailable (redis is null)', async () => {
    mockRedisInstance = null; // simulate no Redis
    const dbResult = [{ id: 'conv-3' }];
    mockFindMany.mockResolvedValue(dbResult.map((c) => ({ conversation: c })));

    const res = await request(makeApp()).get('/conversations');

    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('falls back to DB when Redis.get throws', async () => {
    mockGet.mockRejectedValue(new Error('Redis connection refused'));
    const dbResult = [{ id: 'conv-4' }];
    mockFindMany.mockResolvedValue(dbResult.map((c) => ({ conversation: c })));
    mockSetex.mockResolvedValue('OK');

    const res = await request(makeApp()).get('/conversations');

    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalled();
  });

  it('uses per-user cache key (conversations:<userId>)', async () => {
    mockGet.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([]);
    mockSetex.mockResolvedValue('OK');

    await request(makeApp()).get('/conversations');

    expect(mockGet).toHaveBeenCalledWith(`conversations:${TEST_USER_ID}`);
    expect(mockSetex).toHaveBeenCalledWith(
      `conversations:${TEST_USER_ID}`,
      expect.any(Number),
      expect.any(String),
    );
  });
});