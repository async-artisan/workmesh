import { Global, Module } from '@nestjs/common';
import { V1AuthGuard } from './v1-auth.guard';
import { V1AuthPrismaRepository } from './v1-auth.prisma-repository';
import { V1AuthService, V1_AUTH_REPOSITORY } from './v1-auth.service';
import { V1AccountService } from './v1-account.service';
import { V1CliAuthorizationService } from './v1-cli-authorization.service';
import { V1ActionService } from './v1-action.service';
import { V1AuthController } from './v1-auth.controller';
import { V1AuthorizationPrismaRepository } from './v1-authorization.prisma-repository';
import { V1_AUTHORIZATION_REPOSITORY, V1AuthorizationService } from './v1-authorization';
import { V1ConfirmationPrismaRepository } from './v1-confirmation.prisma-repository';
import { V1_CONFIRMATION_REPOSITORY, V1ConfirmationService } from './v1-confirmation';

/**
 * 唯一 AuthModule：WebSession、AgentCredential、服务端授权、确认票据与 CLI 设备授权都只在这里装配。
 * 领域模块不得再声明自己的认证/授权 provider。
 */
@Global()
@Module({
  controllers: [V1AuthController],
  providers: [
    V1AuthService,
    V1AuthGuard,
    V1AccountService,
    V1CliAuthorizationService,
    V1ActionService,
    V1ConfirmationService,
    V1AuthorizationService,
    { provide: V1_AUTH_REPOSITORY, useClass: V1AuthPrismaRepository },
    { provide: V1_AUTHORIZATION_REPOSITORY, useClass: V1AuthorizationPrismaRepository },
    { provide: V1_CONFIRMATION_REPOSITORY, useClass: V1ConfirmationPrismaRepository },
  ],
  exports: [
    V1AuthService,
    V1AuthGuard,
    V1AccountService,
    V1CliAuthorizationService,
    V1ActionService,
    V1ConfirmationService,
    V1AuthorizationService,
    V1_AUTH_REPOSITORY,
    V1_AUTHORIZATION_REPOSITORY,
    V1_CONFIRMATION_REPOSITORY,
  ],
})
export class AuthModule {}
