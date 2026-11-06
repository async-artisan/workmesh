import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

/** 接入码有效期：默认 900 秒；显式给出时限定 60..3600 秒（服务端再复核一次）。 */
export class CreateWorkspaceEnrollmentDto {
  @IsOptional() @IsInt() @Min(60) @Max(3600) ttlSeconds?: number;
}

/** 接入码明文只在签发响应中出现一次；消费接口匿名、无 Authorization。 */
export class ConsumeWorkspaceEnrollmentDto {
  @IsString() @Matches(/^wme_[A-Za-z0-9_-]{43}$/) code!: string;
}
