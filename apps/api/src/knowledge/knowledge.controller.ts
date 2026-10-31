import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { extname } from 'node:path';
import type { Express } from 'express';
import type { Request } from 'express';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthGuard } from '../auth/auth.guard';
import { KnowledgeService } from './knowledge.service';

class CreateKnowledgeDto {
  @IsString() @MaxLength(100) name!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
}
class DocumentDto {
  @IsString() filename!: string;
  @IsString() mimeType!: string;
  @IsString() content!: string;
}
class SearchDto {
  @IsString() @MaxLength(500) query!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
class KnowledgeQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
class UpdateKnowledgeDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

@UseGuards(AuthGuard)
@Controller('knowledge-bases')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}
  @Get('project/:projectId') list(
    @Req() req: Request & { user?: { sub: string } },
    @Param('projectId') projectId: string,
    @Query() query: KnowledgeQueryDto,
  ) {
    return this.knowledge.list(req.user!.sub, projectId, query.page, query.limit);
  }
  @Patch(':id') update(
    @Req() req: Request & { user?: { sub: string } },
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeDto,
  ) {
    return this.knowledge.update(req.user!.sub, id, dto.name, dto.description);
  }
  @Delete(':id') remove(@Req() req: Request & { user?: { sub: string } }, @Param('id') id: string) {
    return this.knowledge.remove(req.user!.sub, id);
  }
  @Post('project/:projectId') create(
    @Req() req: Request & { user?: { sub: string } },
    @Param('projectId') projectId: string,
    @Body() dto: CreateKnowledgeDto,
  ) {
    return this.knowledge.create(req.user!.sub, projectId, dto.name, dto.description);
  }
  @Post(':id/documents') add(
    @Req() req: Request & { user?: { sub: string } },
    @Param('id') id: string,
    @Body() dto: DocumentDto,
  ) {
    return this.knowledge.addDocument(req.user!.sub, id, dto.filename, dto.mimeType, dto.content);
  }
  @Post(':id/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_request, file, callback) => {
        const extension = extname(file.originalname).toLowerCase();
        const validText =
          ['.txt', '.md'].includes(extension) &&
          ['text/plain', 'text/markdown', 'application/octet-stream'].includes(file.mimetype);
        const validPdf = extension === '.pdf' && file.mimetype === 'application/pdf';
        callback(
          validText || validPdf
            ? null
            : new BadRequestException('仅支持 TXT、Markdown 和 PDF 文件'),
          validText || validPdf,
        );
      },
    }),
  )
  async upload(
    @Req() req: Request & { user?: { sub: string } },
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('请选择文件');
    let content = file.buffer.toString('utf8');
    if (file.mimetype === 'application/pdf') {
      if (file.buffer.subarray(0, 4).toString() !== '%PDF')
        throw new BadRequestException('PDF 文件格式无效');
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: file.buffer });
      try {
        content = (await parser.getText()).text;
      } catch {
        throw new BadRequestException('无法解析此 PDF 文件');
      } finally {
        await parser.destroy();
      }
      if (!content.trim()) throw new BadRequestException('PDF 未包含可检索文本');
    }
    return this.knowledge.addDocument(req.user!.sub, id, file.originalname, file.mimetype, content);
  }
  @Get(':id/search') search(
    @Req() req: Request & { user?: { sub: string } },
    @Param('id') id: string,
    @Query() dto: SearchDto,
  ) {
    return this.knowledge.search(req.user!.sub, id, dto.query, dto.page, dto.limit);
  }
  @Get(':id/context') context(
    @Req() req: Request & { user?: { sub: string } },
    @Param('id') id: string,
    @Query('query') query: string,
    @Query('maxChars') maxChars?: string,
  ) {
    return this.knowledge.buildContext(req.user!.sub, id, query, Number(maxChars) || 6000);
  }
}
