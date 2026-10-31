import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import type { Request } from 'express';
import type { AuthPayload } from './auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthPayload }>();
    const [type, token] = (request.headers.authorization ?? '').split(' ');
    if (type !== 'Bearer' || !token) throw new UnauthorizedException('需要登录');
    try {
      const payload = await this.jwt.verifyAsync<AuthPayload>(token, {
        secret: this.config.getOrThrow('JWT_SECRET'),
      });
      if (payload.type !== 'access') throw new Error('Wrong token type');
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { isActive: true },
      });
      if (!user?.isActive) throw new Error('Inactive account');
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('访问令牌无效');
    }
  }
}
