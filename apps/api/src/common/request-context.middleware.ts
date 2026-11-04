import { Injectable, NestMiddleware } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export type V1RequestContext = Request & { requestId: string };

/**
 * 请求上下文（AsyncLocalStorage）。
 *
 * requestId 原本只挂在 Express 的 request 对象上，中间件/过滤器能拿到，但服务层与
 * Prisma 仓储层完全看不到——于是 `PrincipalStamp.requestId` 一直是空、票据的
 * `consumedRequestId` 只能用随机 UUID，审计记录与日志里的 requestId 对不上。
 * 用 ALS 把它变成「当前请求」的范围值，写入点不必再层层传参。
 */
const contextStorage = new AsyncLocalStorage<{ requestId: string }>();

/** 当前请求的 requestId；不在请求范围内（脚本、定时任务）返回 null。 */
export function currentRequestId(): string | null {
  return contextStorage.getStore()?.requestId ?? null;
}

/**
 * 在指定 requestId 的作用域内执行。供测试与非 HTTP 入口（后台任务、脚本）使用，
 * 让它们写出的 PrincipalStamp 与审计记录也有可追溯的 requestId。
 */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return contextStorage.run({ requestId }, fn);
}

/**
 * requestId 由服务端为每次请求生成 UUID，并在成功与失败链路共享。
 * 不信任客户端自定义的 X-Request-Id：它只会被忽略，不进入审计身份。
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const id = randomUUID();
    (request as V1RequestContext).requestId = id;
    response.setHeader('X-Request-Id', id);
    response.setHeader('Cache-Control', 'no-store');
    // 在 ALS 作用域内继续，后续的处理器与异步链路都能读到同一个 requestId。
    contextStorage.run({ requestId: id }, () => next());
  }
}

export function requestIdOf(request: Request | undefined): string {
  const existing = (request as V1RequestContext | undefined)?.requestId;
  return typeof existing === 'string' && existing ? existing : randomUUID();
}
