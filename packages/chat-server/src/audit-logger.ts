import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

export interface AuditData {
    userId?: string;
    threadId?: string;
    messageId?: string;
    invitedUserId?: string;
    targetUserId?: string;
    newRole?: string;
    error?: string;
    memberCount?: number | undefined;
    shouldRespond?: boolean | undefined;
    reason?: string | undefined;
    messageCount?: number | undefined;
    compactedCount?: number | undefined;
    eventName?: string | undefined;
    assistantTextLength?: number | undefined;
    assistantVisibleLength?: number | undefined;
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
    audit(level: "debug" | "info" | "error", op: string, data: AuditData): void {
        const entry = { audit: true, op, ...data };
        if (level === "error") {
            this.logger.error(entry, op);
        } else if (level === "debug") {
            this.logger.debug(entry, op);
        } else {
            this.logger.info(entry, op);
        }
    }
}
