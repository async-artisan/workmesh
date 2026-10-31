import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';

@Injectable()
export class RedisCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private readonly client?: RedisClientType;

  constructor() {
    const url = process.env.REDIS_URL;
    if (url) this.client = createClient({ url }) as RedisClientType;
  }

  async onModuleInit() {
    if (!this.client) return;
    this.client.on('error', (error) => this.logger.warn(`Redis unavailable: ${error.message}`));
    try {
      await this.client.connect();
    } catch (error) {
      this.logger.warn(
        `Redis connection failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  async onModuleDestroy() {
    if (this.client?.isOpen) await this.client.quit();
  }

  async getOrSet<T>(key: string, factory: () => Promise<T>, ttlSeconds: number): Promise<T> {
    if (!this.client?.isReady) return factory();
    let cached: string | null;
    try {
      cached = await this.client.get(key);
    } catch (error) {
      this.logger.warn(
        `Redis cache bypassed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return factory();
    }
    if (cached !== null) return JSON.parse(cached) as T;
    const value = await factory();
    try {
      await this.client.set(key, JSON.stringify(value), { EX: ttlSeconds });
    } catch (error) {
      this.logger.warn(
        `Redis cache write skipped: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
    return value;
  }
}
