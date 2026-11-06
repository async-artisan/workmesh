import { Type } from 'class-transformer';
import {
  IsIn,
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

/**
 * 代码仓库登记：externalId 使用厂商稳定 ID（GitHub 数值仓库 ID），
 * 仓库改名不影响身份；重复登记同一 (adapter, externalId) 返回 409。
 *
 * T2 起 provider 登记补齐高风险写规则：人审票据 + 幂等键 + `Project.version` CAS。
 * human-declared 来源不再使用本接口，改用 `/repositories/declarations`。
 */
export class CreateProjectRepositoryDto {
  @IsIn(['github']) adapter!: 'github';

  @IsString() @MinLength(1) @MaxLength(120) externalId!: string;

  @IsString() @MinLength(1) @MaxLength(120) owner!: string;

  @IsString() @MinLength(1) @MaxLength(120) name!: string;

  @IsOptional() @IsString() @MaxLength(200) defaultBranch?: string;

  /** 项目共享配置版本（Project.version）：仓库写操作统一用它做 CAS。 */
  @IsInt() @Min(1) expectedProjectVersion!: number;

  @ValidateNested() @Type(() => ConfirmationDto) confirmation!: ConfirmationDto;
}

/** 既有 DELETE 归档接口的请求体：路径不变，补齐票据与版本 CAS。 */
export class ArchiveProjectRepositoryDto {
  @IsInt() @Min(1) expectedProjectVersion!: number;

  @ValidateNested() @Type(() => ConfirmationDto) confirmation!: ConfirmationDto;
}

/**
 * HUMAN 声明的受控 locator。locator 原样进入票据摘要（用户批准的就是它），
 * 服务端再用保守规范化结果做 locator 去重与展示字段推导。
 */
export class DeclareRepositoryDto {
  @IsInt() @Min(1) expectedProjectVersion!: number;

  @IsString() @MinLength(1) @MaxLength(500) locator!: string;

  /** 显式别名请求：把 locator 绑到同项目内该仓库；冲突时 409 LOCATOR_ALREADY_BOUND。 */
  @IsOptional() @IsUUID() targetRepositoryId?: string;

  /** 仅作展示；不参与身份判定、locator 匹配或唯一键。 */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) displayName?: string;

  @ValidateNested() @Type(() => ConfirmationDto) confirmation!: ConfirmationDto;
}

/** 自定义业务角色：key 创建后不可变，否则工作流、角色包与历史引用会断链。 */
export class CreateProjectRoleDto {
  @IsString() @Matches(/^[a-z][a-z0-9-]{0,47}$/) key!: string;

  @IsString() @MinLength(1) @MaxLength(80) title!: string;
}

export class UpdateProjectRoleDto {
  @IsInt() @Min(1) expectedVersion!: number;

  @IsString() @MinLength(1) @MaxLength(80) title!: string;
}

const UNIT_KINDS = ['SERVICE', 'APP', 'DATASET', 'EXTERNAL'] as const;
const UNIT_STATUSES = ['ACTIVE', 'DEPRECATED'] as const;
const EDGE_KINDS = ['CALLS', 'READS', 'PUBLISHES', 'UPSTREAM'] as const;
const EDGE_PROTOCOLS = ['HTTP', 'GRPC', 'MQ', 'DB'] as const;
const EDGE_SOURCES = ['DECLARED', 'INFERRED', 'RUNTIME'] as const;
const CONFIDENCES = ['HIGH', 'MEDIUM', 'LOW'] as const;

/** 工作单元：key 创建后不可变，依赖图与任务绑定都以它为准。 */
export class CreateUnitDto {
  @IsString() @Matches(/^[a-z][a-z0-9-]{0,47}$/) key!: string;

  @IsString() @MinLength(1) @MaxLength(120) name!: string;

  @IsOptional() @IsIn(UNIT_KINDS) kind?: (typeof UNIT_KINDS)[number];

  @IsOptional() @IsUUID() repositoryId?: string;

  @IsOptional() @IsString() @MaxLength(200) repoPath?: string;

  @IsOptional() @IsUUID() ownerUserId?: string;
}

export class UpdateUnitDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;

  @IsOptional() @IsIn(UNIT_STATUSES) status?: (typeof UNIT_STATUSES)[number];

  @IsOptional() @IsString() @MaxLength(200) repoPath?: string;

  @IsOptional() @IsUUID() ownerUserId?: string;
}

export class CreateUnitDependencyDto {
  @IsUUID() fromUnitId!: string;

  @IsUUID() toUnitId!: string;

  @IsIn(EDGE_KINDS) edgeKind!: (typeof EDGE_KINDS)[number];

  @IsOptional() @IsIn(EDGE_PROTOCOLS) protocol?: (typeof EDGE_PROTOCOLS)[number];

  @IsOptional() @IsUUID() contractDocumentId?: string;

  @IsOptional() @IsIn(EDGE_SOURCES) source?: (typeof EDGE_SOURCES)[number];

  @IsOptional() @IsIn(CONFIDENCES) confidence?: (typeof CONFIDENCES)[number];

  @IsOptional() @IsString() @MaxLength(500) evidence?: string;
}
