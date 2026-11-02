import { Module } from '@nestjs/common';
import { V1ReviewModule } from '../reviews/v1-review.module';
import { V1TaskModule } from '../tasks/v1-task.module';
import { V1ActivityController } from './v1-activity.controller';
import { V1ActivityService } from './v1-activity.service';
import { V1EmailService } from './v1-email.service';
import { V1NotificationController } from './v1-notification.controller';
import { V1NotificationService } from './v1-notification.service';
import { V1WorkbenchController } from './v1-workbench.controller';
import { V1WorkbenchService } from './v1-workbench.service';

@Module({
  imports: [V1ReviewModule, V1TaskModule],
  controllers: [V1WorkbenchController, V1ActivityController, V1NotificationController],
  providers: [V1WorkbenchService, V1ActivityService, V1EmailService, V1NotificationService],
})
export class V1WorkbenchModule {}
