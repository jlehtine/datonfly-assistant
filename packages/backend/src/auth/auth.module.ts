import { Module } from "@nestjs/common";

import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";

@Module({
    controllers: [AuthController],
    providers: [AuthService],
    exports: [AuthService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AuthModule {
    static create(authService: AuthService): typeof AuthModule {
        return {
            module: AuthModule,
            providers: [{ provide: AuthService, useValue: authService }],
            exports: [AuthService],
            controllers: [AuthController],
        } as unknown as typeof AuthModule;
    }
}
