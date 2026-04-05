import type { DynamicModule, Type } from "@nestjs/common";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AppModule {
    static register(authModule: Type): DynamicModule {
        return {
            module: AppModule,
            imports: [ConfigModule.forRoot(), authModule],
        };
    }
}
