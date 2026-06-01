import {
    BadRequestException,
    ConflictException,
    Controller,
    Delete,
    ForbiddenException,
    Get,
    HttpCode,
    Inject,
    NotFoundException,
    Param,
    Post,
    Res,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";

import {
    ATTACHMENT_LIMITS,
    classifyAttachmentMimeType,
    isValidUtf8,
    normalizeMimeType,
    type AttachmentInfoWire,
    type IPersistenceProvider,
    type User,
} from "@datonfly-assistant/core";

import { AuditLogger } from "./audit-logger.js";
import { PERSISTENCE_PROVIDER } from "./constants.js";
import { ResolvedUser } from "./decorators/user.decorator.js";
import { RequireUserGuard } from "./guards/require-user.guard.js";

/** Subset of the multer file object consumed by this controller. */
interface UploadedAttachment {
    buffer: Buffer;
    mimetype: string;
    size: number;
    originalname: string;
}

/**
 * HTTP endpoints for context-input attachments.
 *
 * - `POST /datonfly-assistant/attachments` — upload a file. The uploader owns
 *   the attachment until the referencing message is sent, at which point the
 *   gateway associates it with the thread + message.
 * - `GET /datonfly-assistant/attachments/:id` — download. Before association,
 *   only the uploader may download; after association, any thread member may.
 * - `DELETE /datonfly-assistant/attachments/:id` — remove an unassociated
 *   attachment (uploader only). Returns 409 once associated.
 */
@Controller("datonfly-assistant/attachments")
@UseGuards(RequireUserGuard)
export class AttachmentController {
    constructor(
        @Inject(PERSISTENCE_PROVIDER) private readonly persistence: IPersistenceProvider,
        private readonly auditLogger: AuditLogger,
    ) {}

    @Post()
    @UseInterceptors(FileInterceptor("file", { limits: { fileSize: ATTACHMENT_LIMITS.maxFileBytes } }))
    async upload(
        @ResolvedUser() user: User,
        @UploadedFile() file: UploadedAttachment | undefined,
    ): Promise<AttachmentInfoWire> {
        if (!file) {
            throw new BadRequestException("No file provided");
        }
        if (file.size > ATTACHMENT_LIMITS.maxFileBytes) {
            throw new BadRequestException("Attachment exceeds the maximum allowed size");
        }

        const mimeType = normalizeMimeType(file.mimetype);
        const kind = classifyAttachmentMimeType(mimeType);
        const accepted = kind !== "unsupported" || isValidUtf8(file.buffer);
        if (!accepted) {
            throw new BadRequestException("Unsupported attachment type");
        }

        const record = await this.persistence.saveAttachment({
            uploaderId: user.id,
            name: file.originalname,
            mimeType,
            size: file.size,
            bytes: file.buffer,
        });
        this.auditLogger.audit("info", "attachment.upload", {
            userId: user.id,
            attachmentId: record.id,
            bytes: file.size,
        });
        return { id: record.id, name: record.name, mimeType: record.mimeType, size: record.size };
    }

    @Get(":id")
    async download(@ResolvedUser() user: User, @Param("id") id: string, @Res() res: Response): Promise<void> {
        const record = await this.persistence.getAttachment(id);
        if (!record) {
            throw new NotFoundException("Attachment not found");
        }

        const allowed =
            record.threadId === null
                ? record.uploaderId === user.id
                : await this.persistence.isMember(record.threadId, user.id);
        if (!allowed) {
            throw new ForbiddenException("Not allowed to access this attachment");
        }

        const data = await this.persistence.loadAttachmentData(id);
        if (!data) {
            throw new NotFoundException("Attachment not found");
        }

        res.setHeader("Content-Type", record.mimeType);
        res.setHeader("Content-Length", String(record.size));
        res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(record.name)}`);
        res.send(Buffer.from(data.bytes));
    }

    @Delete(":id")
    @HttpCode(204)
    async remove(@ResolvedUser() user: User, @Param("id") id: string): Promise<void> {
        const record = await this.persistence.getAttachment(id);
        if (!record) {
            throw new NotFoundException("Attachment not found");
        }
        if (record.uploaderId !== user.id) {
            throw new ForbiddenException("Not allowed to delete this attachment");
        }
        if (record.threadId !== null) {
            throw new ConflictException("Attachment is already associated with a message");
        }
        await this.persistence.deleteAttachment(id);
        this.auditLogger.audit("info", "attachment.delete", { userId: user.id, attachmentId: id });
    }
}
