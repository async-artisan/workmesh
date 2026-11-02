import { Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { V1NotificationService } from './v1-notification.service';

function principalOf(request: V1Request) {
  if (!request.v1Principal)
    throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'AUTH_REQUIRED', undefined, 401);
  return request.v1Principal;
}

/** 通知动作只面向当前登录人，不接受收件人参数，避免变成任意发信接口。 */
@UseGuards(V1AuthGuard)
@Controller('v1/notifications')
export class V1NotificationController {
  constructor(private readonly notifications: V1NotificationService) {}

  @Post('email-digest')
  @HttpCode(200)
  sendDigest(@Req() request: V1Request) {
    return this.notifications.sendEmailDigest(principalOf(request));
  }
}
