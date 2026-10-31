import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express, Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { ChangePasswordDto, LoginDto, RefreshDto, RegisterDto, UpdateProfileDto } from './dto';
import { isValidAvatar } from './avatar';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('register') register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }
  @Post('login') login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }
  @Post('refresh') refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto);
  }
  @Post('logout') logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }
  @UseGuards(AuthGuard)
  @Post('logout-all')
  logoutAll(@Req() request: Request & { user?: { sub: string } }) {
    return this.auth.logoutAll(request.user!.sub);
  }
  @UseGuards(AuthGuard)
  @Get('profile')
  profile(@Req() request: Request & { user?: { sub: string } }) {
    return this.auth.getProfile(request.user!.sub);
  }
  @UseGuards(AuthGuard)
  @Patch('profile')
  updateProfile(
    @Req() request: Request & { user?: { sub: string } },
    @Body() dto: UpdateProfileDto,
  ) {
    return this.auth.updateProfile(request.user!.sub, dto);
  }
  @UseGuards(AuthGuard)
  @Patch('password')
  changePassword(
    @Req() request: Request & { user?: { sub: string } },
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(request.user!.sub, dto);
  }
  @UseGuards(AuthGuard)
  @Patch('profile/avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2 * 1024 * 1024 },
      fileFilter: (_request, file, callback) => {
        const allowed = ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype);
        callback(allowed ? null : new BadRequestException('头像仅支持 PNG、JPEG 或 WebP'), allowed);
      },
    }),
  )
  async updateAvatar(
    @Req() request: Request & { user?: { sub: string } },
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file || !isValidAvatar(file.mimetype, file.buffer))
      throw new BadRequestException('头像文件无效');
    return this.auth.updateAvatar(request.user!.sub, file.mimetype, file.buffer);
  }
  @UseGuards(AuthGuard)
  @Get('profile/avatar')
  async avatar(@Req() request: Request & { user?: { sub: string } }, @Res() response: Response) {
    const avatar = await this.auth.getAvatar(request.user!.sub);
    if (!avatar) return response.sendStatus(404);
    response
      .type(avatar.avatarMimeType!)
      .set('Cache-Control', 'private, max-age=300')
      .send(avatar.avatarData);
  }
}
