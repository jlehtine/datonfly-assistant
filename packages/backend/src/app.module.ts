import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

@Module({
    imports: [ConfigModule.forRoot()],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AppModule {}
