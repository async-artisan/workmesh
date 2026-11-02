import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export const CHANGE_AFFECTED = ['COPY', 'SCOPE', 'ACCEPTANCE', 'CONTRACT', 'GOAL'] as const;
export type ChangeAffected = (typeof CHANGE_AFFECTED)[number];

export const FREEZE_MODES = ['BLOCK', 'WARN', 'ALLOW'] as const;
export type FreezeMode = (typeof FREEZE_MODES)[number];

export class CreateChangeRequestDto {
  @IsUUID() requirementId!: string;

  /** 受影响面：COPY 文案、SCOPE 范围、ACCEPTANCE 验收、CONTRACT 接口/数据、GOAL 目标。 */
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(CHANGE_AFFECTED, { each: true })
  affected!: ChangeAffected[];

  @IsString() @MaxLength(2000) reason!: string;

  /** 本次变更涉及的验收 key；用于影响预览与失效范围。 */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  acceptanceKeys?: string[];
}

export class DecideChangeRequestDto {
  @IsIn(['ACCEPTED', 'REJECTED']) decision!: 'ACCEPTED' | 'REJECTED';

  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
}

export class UpdateChangePolicyDto {
  @IsIn(FREEZE_MODES) freezeMode!: FreezeMode;

  /** 等级 → 审批角色 key 列表；只接受 L0–L3。 */
  @IsObject() levels!: Record<string, string[]>;
}
