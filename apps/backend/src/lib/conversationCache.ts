import { convCacheKey, redis } from './redis.js';

export async function invalidateConversationCaches(userIds: string[]): Promise<void> {
  if (!redis || userIds.length === 0) {
    return;
  }

  await Promise.allSettled(
    [...new Set(userIds)].map((userId) => redis.del(convCacheKey(userId))),
  );
}