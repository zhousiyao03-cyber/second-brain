import test from "node:test";
import assert from "node:assert/strict";

import * as redisCacheModule from "./redis-cache.ts";

const { RedisCache } = redisCacheModule;

test("RedisCache.invalidateWhere deletes every key under a raw-key prefix", async () => {
  const deletedKeys = [];
  const cache = new RedisCache({ name: "notes.list", ttlSeconds: 60 });

  cache.__setTestClientForUnitTest({
    scan: async (_cursor, options) => {
      assert.equal(options.MATCH, "sb:notes.list:user-1:*");
      return {
        cursor: "0",
        keys: [
          "sb:notes.list:user-1:*:30:0",
          "sb:notes.list:user-1:folder-a:30:0",
        ],
      };
    },
    del: async (keys) => {
      deletedKeys.push(...keys);
      return keys.length;
    },
  });

  await cache.invalidateWhere("user-1:");

  assert.deepEqual(deletedKeys, [
    "sb:notes.list:user-1:*:30:0",
    "sb:notes.list:user-1:folder-a:30:0",
  ]);
});
