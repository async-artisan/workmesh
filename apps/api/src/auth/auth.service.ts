import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto, LoginDto, RefreshDto, RegisterDto, UpdateProfileDto } from './dto';
import { createHash, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';

export interface AuthPayload {
  sub: string;
  email: string;
  role: string;
  type: 'access' | 'refresh';
  jti?: string;
  exp?: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const name = dto.name?.trim() || undefined;
    const existing = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existing) throw new ConflictException('邮箱已被注册');
    const user = await this.prisma.user.create({
      data: {
        email,
        name,
        passwordHash: await bcrypt.hash(dto.password, 12),
        organization: {
          create: {
            name: `${name || email.split('@')[0]}'s workspace`,
            slug: `ws-${randomUUID().slice(0, 12)}`,
          },
        },
      },
    });
    return {
      user: this.publicUser(user),
      ...(await this.issueTokens(user.id, user.email, user.role)),
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
    });
    if (!user || !user.isActive || !(await bcrypt.compare(dto.password, user.passwordHash)))
      throw new UnauthorizedException('邮箱或密码错误');
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return {
      user: this.publicUser(user),
      ...(await this.issueTokens(user.id, user.email, user.role)),
    };
  }

  async refresh(dto: RefreshDto) {
    let payload: AuthPayload;
    try {
      payload = await this.jwt.verifyAsync<AuthPayload>(dto.refreshToken, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('刷新令牌无效');
    }
    if (payload.type !== 'refresh') throw new UnauthorizedException('刷新令牌无效');
    const tokenHash = this.hash(dto.refreshToken);
    const stored = await this.prisma.refreshToken.findFirst({
      where: { tokenHash, userId: payload.sub, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!stored) throw new UnauthorizedException('刷新令牌已失效');
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count !== 1) throw new UnauthorizedException('刷新令牌已失效');
    return this.issueTokens(payload.sub, payload.email, payload.role);
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hash(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: true };
  }

  async logoutAll(userId: string) {
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: result.count };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('账户无效');
    return this.publicUser(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { name: dto.name } });
    return this.publicUser(user);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive || !(await bcrypt.compare(dto.currentPassword, user.passwordHash)))
      throw new BadRequestException('当前密码不正确');
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, 12) },
    });
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { changed: true };
  }

  async updateAvatar(userId: string, mimeType: string, data: Buffer) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarData: data, avatarMimeType: mimeType },
    });
    return this.publicUser(user);
  }

  async getAvatar(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarData: true, avatarMimeType: true },
    });
    return user?.avatarData && user.avatarMimeType ? user : null;
  }

  private async issueTokens(id: string, email: string, role: string) {
    const accessToken = await this.jwt.signAsync(
      { sub: id, email, role, type: 'access' },
      {
        secret: this.config.getOrThrow('JWT_SECRET'),
        expiresIn: Number(this.config.get<string>('JWT_ACCESS_EXPIRES_IN')) || 900,
      },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: id, email, role, type: 'refresh', jti: randomUUID() },
      {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
        expiresIn: Number(this.config.get<string>('JWT_REFRESH_EXPIRES_IN')) || 604800,
      },
    );
    const expiry = this.jwt.decode<AuthPayload>(refreshToken)?.exp;
    if (!expiry) throw new Error('Refresh token expiry is missing');
    await this.prisma.refreshToken.create({
      data: { tokenHash: this.hash(refreshToken), userId: id, expiresAt: new Date(expiry * 1000) },
    });
    return { accessToken, refreshToken };
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
  private publicUser(user: { id: string; email: string; name: string | null; role: string }) {
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }
}
