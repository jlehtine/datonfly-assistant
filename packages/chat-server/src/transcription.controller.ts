import {
    BadRequestException,
    Controller,
    Inject,
    Optional,
    Post,
    ServiceUnavailableException,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";

import type { TranscriptionResponse, User } from "@datonfly-assistant/core";

import { AuditLogger } from "./audit-logger.js";
import { TRANSCRIBE_FN } from "./constants.js";
import { ResolvedUser } from "./decorators/user.decorator.js";
import { RequireUserGuard } from "./guards/require-user.guard.js";

/**
 * Callback that transcribes audio bytes to text.
 *
 * Implementations receive the raw audio buffer along with its MIME type and
 * original file name (useful for providers that infer the format from the
 * extension). The audio is never persisted; only the returned text is.
 */
export type TranscribeFn = (audio: Buffer, mimeType: string, fileName: string) => Promise<string>;

/** Maximum accepted audio upload size in bytes (25 MB, the OpenAI transcription limit). */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Subset of the multer file object consumed by this controller. */
interface UploadedAudio {
    buffer: Buffer;
    mimetype: string;
    size: number;
    originalname: string;
}

/**
 * HTTP endpoint that transcribes uploaded audio to text.
 *
 * The audio is held in memory only for the duration of the transcription call
 * and is never stored. Clients send the returned text as a normal chat message.
 */
@Controller("datonfly-assistant/transcribe")
@UseGuards(RequireUserGuard)
export class TranscriptionController {
    constructor(
        @Optional() @Inject(TRANSCRIBE_FN) private readonly transcribeFn: TranscribeFn | null,
        private readonly auditLogger: AuditLogger,
    ) {}

    @Post()
    @UseInterceptors(FileInterceptor("audio", { limits: { fileSize: MAX_AUDIO_BYTES } }))
    async transcribe(
        @ResolvedUser() user: User,
        @UploadedFile() file: UploadedAudio | undefined,
    ): Promise<TranscriptionResponse> {
        if (!this.transcribeFn) {
            throw new ServiceUnavailableException("Audio transcription is not configured");
        }
        if (!file) {
            throw new BadRequestException("No audio file provided");
        }
        if (!file.mimetype.startsWith("audio/")) {
            throw new BadRequestException("Uploaded file must be audio");
        }

        const text = await this.transcribeFn(file.buffer, file.mimetype, file.originalname);
        this.auditLogger.audit("info", "transcribe.audio", { userId: user.id, bytes: file.size });
        return { text };
    }
}
