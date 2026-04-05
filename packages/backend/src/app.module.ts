import type { DynamicModule, Type } from "@nestjs/common";
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";

import { JwtAuthGuard } from "./guards/jwt-auth.guard.js";

@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AppModule {
    static register(authModule: Type, extraModules: DynamicModule[] = []): DynamicModule {
        return {
            module: AppModule,
            imports: [ConfigModule.forRoot(), authModule, ...extraModules],
            providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
        };
    }
}
