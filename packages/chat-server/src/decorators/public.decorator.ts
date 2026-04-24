import { SetMetadata } from "@nestjs/common";

const IS_PUBLIC_KEY = "isPublic";

export const Public = (): ReturnType<typeof SetMetadata> => SetMetadata(IS_PUBLIC_KEY, true);