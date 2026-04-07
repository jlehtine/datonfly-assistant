import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";

import type { IPersistenceProvider, User } from "@datonfly-assistant/core";

import { PERSISTENCE_PROVIDER } from "./constants.js";
import { RequireUserGuard } from "./guards/require-user.guard.js";
import { ZodValidationPipe } from "./pipes/zod-validation.pipe.js";

const searchQuerySchema = z.object({
    q: z.string().min(1).max(200),
    limit: z.coerce.number().int().min(1).max(50).optional(),
});

type SearchQuery = z.infer<typeof searchQuerySchema>;

interface UserSearchResult {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | undefined;
}

@Controller("datonfly-assistant/users")
@UseGuards(RequireUserGuard)
export class UserController {
    constructor(@Inject(PERSISTENCE_PROVIDER) private readonly persistence: IPersistenceProvider) {}

    @Get("search")
    async search(@Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQuery): Promise<UserSearchResult[]> {
        const users: User[] = await this.persistence.searchUsers(query.q, query.limit);
        return users.map((u) => ({
            id: u.id,
            email: u.email,
            name: u.name,
            avatarUrl: u.avatarUrl,
        }));
    }
}
