import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateProjectDto {
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  /** 编号前缀：2–6 位大写字母，创建后不可变更。 */
  @IsString() @Matches(/^[A-Z]{2,6}$/) key!: string;
  @IsOptional() @IsString() @MaxLength(10000) description?: string;
}

export class UpdateProjectDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(10000) description?: string;
}

export class AddProjectMemberDto {
  @IsString() @MinLength(3) @MaxLength(320) email!: string;
}

export class CreateRequirementDto {
  @IsString() @MinLength(1) @MaxLength(200) title!: string;

  @IsOptional() @IsString() @MaxLength(10000) description?: string;
}

/** 需求编辑只允许改标题/描述；priority、用户故事等字段当前模型没有，先不伪造。 */
export class UpdateRequirementDto {
  @IsInt() @Min(1) expectedVersion!: number;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;

  @IsOptional() @IsString() @MaxLength(10000) description?: string;
}

export class ConfirmationDto {
  @IsUUID() ticketId!: string;

  @IsString() @MinLength(1) @MaxLength(64) ticketSecret!: string;
}

/** 业务角色授予/撤销：expectedVersion 指 ProjectMember.version，不接受 0 或缺失。 */
export class ProjectRoleChangeDto {
  @IsInt() @Min(1) expectedVersion!: number;

  @IsString() @MinLength(1) @MaxLength(1000) reason!: string;

  @ValidateNested() @Type(() => ConfirmationDto) confirmation!: ConfirmationDto;
}
