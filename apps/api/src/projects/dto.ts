import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
export class CreateProjectDto {
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @IsString() @Matches(/^[A-Z][A-Z0-9_-]{1,15}$/) key!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(2048) repositoryUrl?: string | null;
}
export class UpdateProjectDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(2048) repositoryUrl?: string | null;
}
