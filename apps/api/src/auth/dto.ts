import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class RegisterDto {
  @IsEmail({}, { message: '请输入有效的邮箱地址' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;
  @IsString()
  @MinLength(8, { message: '密码长度至少为 8 位' })
  @MaxLength(128, { message: '密码长度不能超过 128 位' })
  @Matches(/[A-Z]/, { message: '密码必须包含至少一个大写字母' })
  @Matches(/[a-z]/, { message: '密码必须包含至少一个小写字母' })
  @Matches(/[0-9]/, { message: '密码必须包含至少一个数字' })
  @Matches(/[!@#$%^&*(),.?":{}|<>]/, { message: '密码必须包含至少一个特殊字符' })
  password!: string;
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: '姓名长度不能超过 50 位' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name?: string;
}

export class LoginDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
}

export class RefreshDto {
  @IsString() refreshToken!: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name?: string;
}

export class ChangePasswordDto {
  @IsString() currentPassword!: string;
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/[A-Z]/)
  @Matches(/[a-z]/)
  @Matches(/[0-9]/)
  @Matches(/[!@#$%^&*(),.?":{}|<>]/)
  newPassword!: string;
}
