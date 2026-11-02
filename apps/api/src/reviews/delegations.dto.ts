import { IsDateString, IsUUID } from 'class-validator';

export class CreateDelegationDto {
  @IsUUID() slotId!: string;

  @IsUUID() delegateUserId!: string;

  /** 必须晚于当前时间；到期自动失效。 */
  @IsDateString() expiresAt!: string;
}
