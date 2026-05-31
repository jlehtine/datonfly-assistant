import MicIcon from "@mui/icons-material/Mic";
import StopIcon from "@mui/icons-material/Stop";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";

import { transcribeAudio } from "@datonfly-assistant/chat-client";
import { useChatClient } from "@datonfly-assistant/chat-client/react";

import type { InputTool, InputToolContext, InputToolResult } from "./InputTool.js";

type PanelState = "recording" | "transcribing" | "error";

/** Map a recorder MIME type to a reasonable upload file name. */
function fileNameForMime(mimeType: string): string {
    if (mimeType.includes("ogg")) return "recording.ogg";
    if (mimeType.includes("mp4") || mimeType.includes("mpeg")) return "recording.mp4";
    if (mimeType.includes("wav")) return "recording.wav";
    return "recording.webm";
}

/** Combine any existing composer text with the new transcript. */
function combineText(existing: string, transcript: string): string {
    const trimmedExisting = existing.trimEnd();
    if (!trimmedExisting) return transcript;
    return `${trimmedExisting} ${transcript}`;
}

// eslint-disable-next-line react-refresh/only-export-components -- private component used only within this module
function AudioInputPanel({
    ctx,
    done,
}: {
    ctx: InputToolContext;
    done: (result: InputToolResult | null) => void;
}): ReactElement {
    const { t } = useTranslation();
    const client = useChatClient();
    const [state, setState] = useState<PanelState>("recording");
    const recorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const chunksRef = useRef<Blob[]>([]);

    const stopStream = useCallback(() => {
        for (const track of streamRef.current?.getTracks() ?? []) {
            track.stop();
        }
        streamRef.current = null;
    }, []);

    useEffect(() => {
        let cancelled = false;

        const transcribe = async (mimeType: string): Promise<void> => {
            const blob = new Blob(chunksRef.current, { type: mimeType });
            try {
                const transcript = await transcribeAudio(client, blob, fileNameForMime(mimeType));
                if (cancelled) return;
                const trimmed = transcript.trim();
                if (!trimmed) {
                    setState("error");
                    return;
                }
                const text = combineText(ctx.text, trimmed);
                done({ text, selectionStart: text.length, selectionEnd: text.length, submit: true });
            } catch {
                if (!cancelled) setState("error");
            }
        };

        const start = async (): Promise<void> => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                if (cancelled) {
                    for (const track of stream.getTracks()) {
                        track.stop();
                    }
                    return;
                }
                streamRef.current = stream;
                const recorder = new MediaRecorder(stream);
                recorderRef.current = recorder;
                chunksRef.current = [];
                recorder.addEventListener("dataavailable", (event) => {
                    if (event.data.size > 0) chunksRef.current.push(event.data);
                });
                recorder.addEventListener("stop", () => {
                    stopStream();
                    setState("transcribing");
                    void transcribe(recorder.mimeType);
                });
                recorder.start();
            } catch {
                if (!cancelled) setState("error");
            }
        };

        void start();

        return () => {
            cancelled = true;
            const recorder = recorderRef.current;
            if (recorder && recorder.state !== "inactive") {
                recorder.stop();
            }
            stopStream();
        };
    }, [client, ctx.text, done, stopStream]);

    const handleStop = useCallback(() => {
        const recorder = recorderRef.current;
        if (recorder && recorder.state !== "inactive") {
            recorder.stop();
        }
    }, []);

    return (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5, p: 2, minWidth: 200 }}>
            {state === "recording" && (
                <>
                    <CircularProgress size={28} color="error" />
                    <Button
                        variant="contained"
                        color="error"
                        size="small"
                        startIcon={<StopIcon />}
                        onClick={handleStop}
                    >
                        {t("stopRecording")}
                    </Button>
                </>
            )}
            {state === "transcribing" && (
                <>
                    <CircularProgress size={28} />
                    <Typography variant="body2">{t("transcribing")}</Typography>
                </>
            )}
            {state === "error" && (
                <Typography variant="body2" color="error">
                    {t("microphoneError")}
                </Typography>
            )}
        </Box>
    );
}

/**
 * Pre-built {@link InputTool} that records audio, transcribes it server-side,
 * and submits the resulting text as a chat message.
 *
 * Requires the server to advertise the `audioInput` feature and a
 * {@link ChatClientContext} provider in the React tree.
 */
export const audioInputTool: InputTool = {
    name: "audio",
    icon: <MicIcon sx={{ fontSize: 16 }} />,
    placement: "input-end",
    onActivate: (ctx, done) => <AudioInputPanel ctx={ctx} done={done} />,
};
