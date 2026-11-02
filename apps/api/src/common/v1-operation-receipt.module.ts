import { Module } from '@nestjs/common';
import { V1OperationReceiptController } from './v1-operation-receipt.controller';
import { V1OperationReceiptPrismaRepository } from './v1-operation-receipt.prisma-repository';
import { V1_OPERATION_RECEIPT_REPOSITORY } from './v1-operation-receipt.repository';
import { V1OperationReceiptService } from './v1-operation-receipt.service';

/**
 * 操作收据只读模块。
 * 依赖全局 AuthModule 提供的 V1AuthorizationService；主应用需在 AppModule imports 中装配本模块。
 */
@Module({
  controllers: [V1OperationReceiptController],
  providers: [
    V1OperationReceiptService,
    { provide: V1_OPERATION_RECEIPT_REPOSITORY, useClass: V1OperationReceiptPrismaRepository },
  ],
  exports: [V1OperationReceiptService],
})
export class V1OperationReceiptModule {}
