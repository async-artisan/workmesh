import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CreateRequirementDto, RequirementQueryDto, UpdateRequirementDto } from './dto';
import { RequirementsService } from './requirements.service';

@UseGuards(AuthGuard)
@Controller('requirements')
export class RequirementsController {
  constructor(private readonly requirements: RequirementsService) {}
  @Get() list(
    @Req() req: Request & { user?: { sub: string } },
    @Query() query: RequirementQueryDto,
  ) {
    return this.requirements.list(req.user!.sub, query);
  }
  @Get(':id') get(@Req() req: Request & { user?: { sub: string } }, @Param('id') id: string) {
    return this.requirements.get(req.user!.sub, id);
  }
  @Post() create(
    @Req() request: Request & { user?: { sub: string } },
    @Body() dto: CreateRequirementDto,
  ) {
    return this.requirements.create(request.user!.sub, dto);
  }
  @Patch(':id') update(
    @Req() req: Request & { user?: { sub: string } },
    @Param('id') id: string,
    @Body() dto: UpdateRequirementDto,
  ) {
    return this.requirements.update(req.user!.sub, id, dto);
  }
  @Delete(':id') remove(@Req() req: Request & { user?: { sub: string } }, @Param('id') id: string) {
    return this.requirements.remove(req.user!.sub, id);
  }
}
