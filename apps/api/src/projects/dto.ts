import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
export class CreateProjectDto {
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  // 编号前缀：2–6 位大写字母，创建后不可变更（改名需要迁移全部需求编号）
  @IsString() @Matches(/^[A-Z]{2,6}$/) key!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(2048) repositoryUrl?: string | null;
}
export class UpdateProjectDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(2048) repositoryUrl?: string | null;
}
