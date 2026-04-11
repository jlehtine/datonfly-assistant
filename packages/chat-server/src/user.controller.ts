import { Body, Controller, Get, Inject, Patch, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";

import type { IPersistenceProvider, User } from "@datonfly-assistant/core";
import { updateUserRequestSchema } from "@datonfly-assistant/core";

import { PERSISTENCE_PROVIDER } from "./constants.js";
import { ResolvedUser } from "./decorators/user.decorator.js";
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

interface UserProfile {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | undefined;
    agentAlias: string | undefined;
}

@Controller("datonfly-assistant/users")
@UseGuards(RequireUserGuard)
export class UserController {
    constructor(@Inject(PERSISTENCE_PROVIDER) private readonly persistence: IPersistenceProvider) {}

    @Get("me")
    getMe(@ResolvedUser() user: User): UserProfile {
        return {
            id: user.id,
            email: user.email,
            name: user.name,
            avatarUrl: user.avatarUrl,
            agentAlias: user.agentAlias,
        };
    }

    @Patch("me")
    async updateMe(
        @ResolvedUser() user: User,
        @Body(new ZodValidationPipe(updateUserRequestSchema)) body: z.infer<typeof updateUserRequestSchema>,
    ): Promise<UserProfile> {
        const updated = await this.persistence.updateUser(user.id, {
            agentAlias: body.agentAlias ?? undefined,
        });
        return {
            id: updated.id,
            email: updated.email,
            name: updated.name,
            avatarUrl: updated.avatarUrl,
            agentAlias: updated.agentAlias,
        };
    }

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
