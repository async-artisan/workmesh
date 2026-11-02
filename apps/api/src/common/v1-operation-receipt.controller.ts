import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { V1OperationReceiptService } from './v1-operation-receipt.service';

function principalOf(request: V1Request) {
  if (!request.v1Principal)
    throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'AUTH_REQUIRED', undefined, 401);
  return request.v1Principal;
}

@UseGuards(V1AuthGuard)
@Controller('v1/operation-receipts')
export class V1OperationReceiptController {
  constructor(
    @Inject(V1OperationReceiptService) private readonly receipts: V1OperationReceiptService,
  ) {}

  @Get(':operationKey')
  get(
    @Req() request: V1Request,
    @Param('operationKey') operationKey: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.receipts.getReceipt(principalOf(request), operationKey, projectId ?? null);
  }
}
