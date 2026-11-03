import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ConfirmationDto } from './dto';
import { INVITATION_MAX_TTL_HOURS } from './invitations.policy';

/**
 * 创建邀请：角色 key 集合必填，邮箱可选（限定受邀人），有效期默认 72 小时。
 * 用 roleKeys 而不是 roleIds：请求体禁止出现 roleIds 这类“自报身份”字段，
 * 服务端按项目把 key 解析成角色 id。
 */
export class CreateInvitationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @Matches(/^[a-z][a-z0-9-]{0,47}$/, { each: true })
  roleKeys!: string[];

  @IsOptional()
  @IsString()
  @Matches(/^[^\s@]{1,64}@[^\s@]{1,190}$/)
  email?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(INVITATION_MAX_TTL_HOURS)
  expiresInHours?: number;

  /** 与项目当前 version 做 CAS：并发创建邀请时只允许一个成功。 */
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ValidateNested()
  @Type(() => ConfirmationDto)
  confirmation!: ConfirmationDto;
}

/** 未注册用户接受邀请：设置密码即建号并加入项目。 */
export class AcceptInvitationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;

  /** 邀请未绑定邮箱时必填；绑定邮箱时忽略。 */
  @IsOptional()
  @IsString()
  @Matches(/^[^\s@]{1,64}@[^\s@]{1,190}$/)
  email?: string;
}
