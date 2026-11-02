import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class RegisterDto {
  @IsString() @Matches(/^[^\s@]{1,64}@[^\s@]{1,190}$/) email!: string;
  @IsString() @MinLength(8) @MaxLength(200) password!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
}

export class LoginDto {
  @IsString() @MaxLength(254) email!: string;
  @IsString() @MaxLength(200) password!: string;
}

export class CreateCliAuthorizationDto {
  @IsString() @MinLength(1) @MaxLength(80) clientName!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) codeChallenge!: string;
  @IsIn(['S256']) codeChallengeMethod!: 'S256';
  @IsString() @Matches(/^[0-9a-f]{64}$/) credentialSecretHash!: string;
}

export class LookupCliAuthorizationDto {
  @IsString() @MinLength(8) @MaxLength(12) userCode!: string;
}

export class ApproveCliAuthorizationDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @IsString() projectId!: string;
  @IsString() roleId!: string;
  @IsString({ each: true }) scopes!: string[];
  @IsInt() @Min(1) @Max(365) expiresInDays!: number;
}

export class DenyCliAuthorizationDto {
  @IsInt() @Min(0) expectedVersion!: number;
}

export class PollCliAuthorizationDto {
  @IsString() authorizationId!: string;
  @IsString() @MaxLength(200) deviceCode!: string;
  @IsString() @MinLength(43) @MaxLength(128) codeVerifier!: string;
}

export class RoleSlotDto {
  @IsString() roleId!: string;
  @IsOptional() @IsString() approvalSlotId?: string | null;
}

export class ActionBindingDto {
  @IsString() @MaxLength(64) action!: string;
  @IsOptional() @IsString() projectId?: string | null;
  @IsString() @MaxLength(40) targetType!: string;
  @IsString() targetId!: string;
  @IsInt() @Min(0) expectedVersion!: number;
  @IsOptional() @ValidateNested() @Type(() => RoleSlotDto) roleSlot?: RoleSlotDto | null;
  @IsObject() payload!: Record<string, unknown>;
}

export class ActionPreviewDto extends ActionBindingDto {}

export class ConfirmationTicketDto extends ActionBindingDto {
  @IsString() @Matches(/^[0-9a-f]{64}$/) actionDigest!: string;
  @IsString() @MinLength(1) @MaxLength(200) password!: string;
}
