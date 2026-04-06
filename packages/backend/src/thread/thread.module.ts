import type { DynamicModule } from "@nestjs/common";
import { Module } from "@nestjs/common";

import type { IPersistenceProvider } from "@datonfly-assistant/core";

import { PERSISTENCE_PROVIDER } from "./constants.js";
import { ThreadController } from "./thread.controller.js";

@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class ThreadModule {
    static create(persistence: IPersistenceProvider): DynamicModule {
        return {
            module: ThreadModule,
            controllers: [ThreadController],
            providers: [{ provide: PERSISTENCE_PROVIDER, useValue: persistence }],
            exports: [PERSISTENCE_PROVIDER],
        };
    }
}
