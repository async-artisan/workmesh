import { Type } from 'class-transformer';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { ConfirmationDto } from './dto';

/** 定义 payload 的深度校验在 validator 中完成；DTO 只保证它是对象。 */
export class SaveWorkspaceDefinitionDraftDto {
  /** 草稿代数基线；首次保存（尚无定义行）传 0。 */
  @IsInt() @Min(0) expectedDefinitionVersion!: number;

  /** 客户端声明的规范化 payload 摘要；必须与服务端重算一致。 */
  @IsString() @Matches(/^[0-9a-f]{64}$/) payloadDigest!: string;

  @IsObject() definition!: Record<string, unknown>;
}

export class ValidateWorkspaceDefinitionDto {
  /** 省略时校验已保存草稿。 */
  @IsOptional() @IsObject() definition?: Record<string, unknown>;
}

export class PublishWorkspaceDefinitionDto {
  @IsInt() @Min(1) expectedProjectVersion!: number;

  @IsInt() @Min(0) expectedDefinitionVersion!: number;

  @IsString() @Matches(/^[0-9a-f]{64}$/) payloadDigest!: string;

  @ValidateNested() @Type(() => ConfirmationDto) confirmation!: ConfirmationDto;
}
