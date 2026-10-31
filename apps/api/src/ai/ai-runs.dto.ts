import { Type } from 'class-transformer';
import { AiRunStatus, Priority } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateAiRunDto {
  @IsUUID() projectId!: string;
}

export class AiRunQueryDto {
  @IsUUID() projectId!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsEnum(AiRunStatus) status?: AiRunStatus;
}

export class CreateAiRunMessageDto {
  @IsString() @Length(1, 10000) content!: string;
}

export class ConfirmAiRunDto {
  @IsOptional() @IsString() @Length(1, 200) title?: string;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsOptional() @IsObject() draft?: Record<string, unknown>;
}
