import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

export interface AuditData {
    userId?: string;
    threadId?: string;
    messageId?: string;
    invitedUserId?: string;
    error?: string;
}

/**
 * Thin wrapper around {@link PinoLogger} for structured audit logging.
 *
 * Every log line is tagged with `audit: true` so audit events can be filtered
 * from regular application logs.
 */
@Injectable()
export class AuditLogger {
    private readonly logger: PinoLogger;

    constructor(logger: PinoLogger) {
        this.logger = logger;
        this.logger.setContext("audit");
    }

    /** Emit a structured audit log entry. */
    audit(level: "info" | "error", op: string, data: AuditData): void {
        const entry = { audit: true, op, ...data };
        if (level === "error") {
            this.logger.error(entry, op);
        } else {
            this.logger.info(entry, op);
        }
    }
}
