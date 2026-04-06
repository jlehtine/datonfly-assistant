import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { z } from "zod";

/**
 * NestJS pipe that validates and transforms input using a Zod schema.
 *
 * On validation failure a {@link BadRequestException} is thrown with the
 * formatted error details.
 *
 * @example
 * ```ts
 * @Body(new ZodValidationPipe(createThreadRequestSchema)) body: CreateThreadRequest
 * ```
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
    constructor(private readonly schema: z.ZodType<T>) {}

    transform(value: unknown): T {
        const result = this.schema.safeParse(value);
        if (result.success) {
            return result.data;
        }
        throw new BadRequestException(result.error.issues);
    }
}
