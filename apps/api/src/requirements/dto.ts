import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Priority, RequirementStatus } from '@prisma/client';

export class RequirementQueryDto {
  @IsUUID() projectId!: string;
  @IsOptional() @IsEnum(RequirementStatus) status?: RequirementStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'title', 'status', 'priority'])
  sortBy?: 'createdAt' | 'updatedAt' | 'title' | 'status' | 'priority';
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder?: 'asc' | 'desc';
}

export class CreateRequirementDto {
  @IsUUID() projectId!: string;
  @IsString() @Length(1, 200) title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsOptional() @IsArray() @IsString({ each: true }) userStories?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) acceptanceCriteria?: string[];
}

export class UpdateRequirementDto {
  @IsOptional() @IsString() @Length(1, 200) title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsOptional() @IsEnum(RequirementStatus) status?: RequirementStatus;
  @IsOptional() @IsArray() @IsString({ each: true }) userStories?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) acceptanceCriteria?: string[];
}
