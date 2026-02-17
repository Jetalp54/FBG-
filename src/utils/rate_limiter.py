import time
import redis
import logging

logger = logging.getLogger(__name__)

class RedisRateLimiter:
    """
    Distributed Token Bucket Rate Limiter using Redis.
    Ensures safe concurrency across multiple workers/processes.
    """
    def __init__(self, redis_client: redis.Redis, key: str, rate_per_second: float, burst_capacity: int = None):
        """
        Args:
            redis_client: Initialized Redis client
            key: Unique key for this limiter (e.g., 'campaign:123:limit')
            rate_per_second: Number of tokens added per second
            burst_capacity: Max tokens the bucket can hold (defaults to rate * 2)
        """
        self.redis = redis_client
        self.key = key
        self.rate = float(rate_per_second)
        self.capacity = burst_capacity if burst_capacity else int(self.rate * 2)
        # Ensure minimum capacity of 1
        self.capacity = max(self.capacity, 1)
        
        # Lua script for atomic token consumption
        # Keys: [key]
        # Args: [rate, capacity, now_timestamp, requested_tokens]
        self.lua_script = """
        local key = KEYS[1]
        local rate = tonumber(ARGV[1])
        local capacity = tonumber(ARGV[2])
        local now = tonumber(ARGV[3])
        local requested = tonumber(ARGV[4])
        
        local last_tokens = tonumber(redis.call('HGET', key, 'tokens'))
        local last_refill = tonumber(redis.call('HGET', key, 'last_refill'))
        
        if last_tokens == nil then
            last_tokens = capacity
            last_refill = now
        end
        
        -- Refill tokens based on time delta
        local delta = math.max(0, now - last_refill)
        local filled_tokens = math.min(capacity, last_tokens + (delta * rate))
        
        local allowed = false
        local wait_time = 0
        local new_tokens = filled_tokens
        
        if filled_tokens >= requested then
            allowed = true
            new_tokens = filled_tokens - requested
        else
            allowed = false
            -- Calculate time to wait for enough tokens
            local needed = requested - filled_tokens
            wait_time = needed / rate
        end
        
        if allowed then
            redis.call('HSET', key, 'tokens', new_tokens, 'last_refill', now)
            -- Set expiry to avoid stale keys (e.g., 1 hour after activity)
            redis.call('EXPIRE', key, 3600)
        end
        
        return {allowed, wait_time}
        """
        self.script_sha = self.redis.script_load(self.lua_script)

    def acquire(self, tokens=1):
        """
        Attempt to acquire tokens. 
        Returns True if acquired immediately.
        Returns False (and caller should sleep) if limit exceeded.
        """
        try:
            now = time.time()
            # Redis evalsha is atomic
            result = self.redis.evalsha(self.script_sha, 1, self.key, self.rate, self.capacity, now, tokens)
            
            allowed = bool(result[0])
            wait_time = float(result[1])
            
            if allowed:
                return True, 0.0
            else:
                return False, wait_time
                
        except Exception as e:
            # Fallback: if Redis fails, allow action to prevent deadlock, but log error
            logger.error(f"RateLimiter Redis Error: {e}")
            return True, 0.0
