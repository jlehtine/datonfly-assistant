import MicIcon from "@mui/icons-material/Mic";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Snackbar from "@mui/material/Snackbar";
import Tooltip from "@mui/material/Tooltip";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";

import { transcribeAudio } from "@datonfly-assistant/chat-client";
import { useChatClient } from "@datonfly-assistant/chat-client/react";

import type { InputTool, InputToolButtonProps } from "./InputTool.js";

type RecorderState = "idle" | "recording" | "transcribing";

/** How long (ms) the button stays disabled after a click to absorb accidental double-clicks. */
const CLICK_COOLDOWN_MS = 500;

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
function AudioInputButton({ getContext, done, disabled }: InputToolButtonProps): ReactElement {
    const { t } = useTranslation();
    const client = useChatClient();
    const [state, setState] = useState<RecorderState>("idle");
    const [cooldown, setCooldown] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const recorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const getContextRef = useRef(getContext);
    const doneRef = useRef(done);
    const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cancelledRef = useRef(false);

    // Keep the latest callbacks without re-subscribing recorder listeners.
    useEffect(() => {
        getContextRef.current = getContext;
        doneRef.current = done;
    });

    const stopStream = useCallback(() => {
        for (const track of streamRef.current?.getTracks() ?? []) {
            track.stop();
        }
        streamRef.current = null;
    }, []);

    useEffect(() => {
        cancelledRef.current = false;
        return () => {
            cancelledRef.current = true;
            if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
            const recorder = recorderRef.current;
            if (recorder && recorder.state !== "inactive") {
                recorder.stop();
            }
            stopStream();
        };
    }, [stopStream]);

    const triggerCooldown = useCallback(() => {
        setCooldown(true);
        if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
        cooldownTimerRef.current = setTimeout(() => {
            setCooldown(false);
        }, CLICK_COOLDOWN_MS);
    }, []);

    const transcribe = useCallback(
        async (mimeType: string): Promise<void> => {
            const blob = new Blob(chunksRef.current, { type: mimeType });
            try {
                const transcript = await transcribeAudio(client, blob, fileNameForMime(mimeType));
                if (cancelledRef.current) return;
                const trimmed = transcript.trim();
                if (!trimmed) {
                    setState("idle");
                    setErrorMsg(t("transcriptionFailed"));
                    return;
                }
                const text = combineText(getContextRef.current().text, trimmed);
                setState("idle");
                doneRef.current({ text, selectionStart: text.length, selectionEnd: text.length, submit: true });
            } catch {
                if (cancelledRef.current) return;
                setState("idle");
                setErrorMsg(t("transcriptionFailed"));
            }
        },
        [client, t],
    );

    const startRecording = useCallback(async (): Promise<void> => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (cancelledRef.current) {
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
                if (cancelledRef.current) return;
                setState("transcribing");
                void transcribe(recorder.mimeType);
            });
            recorder.start();
            setState("recording");
        } catch {
            if (cancelledRef.current) return;
            setState("idle");
            setErrorMsg(t("microphoneError"));
        }
    }, [stopStream, transcribe, t]);

    const stopRecording = useCallback(() => {
        const recorder = recorderRef.current;
        if (recorder && recorder.state !== "inactive") {
            recorder.stop();
        }
    }, []);

    const handleClick = useCallback(() => {
        triggerCooldown();
        if (state === "idle") {
            void startRecording();
        } else if (state === "recording") {
            stopRecording();
        }
    }, [state, triggerCooldown, startRecording, stopRecording]);

    const isRecording = state === "recording";
    const isTranscribing = state === "transcribing";
    const buttonDisabled = disabled || isTranscribing || cooldown;
    const label = isRecording ? t("stopRecording") : t("recordAudio");

    return (
        <>
            <Tooltip title={isTranscribing ? t("transcribing") : label}>
                {/* span keeps the tooltip working while the button is disabled */}
                <span>
                    <IconButton
                        size="small"
                        edge="end"
                        aria-label={label}
                        aria-pressed={isRecording}
                        disabled={buttonDisabled}
                        onClick={handleClick}
                        color={isRecording ? "error" : "default"}
                    >
                        <Box
                            sx={{
                                position: "relative",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >
                            {(isRecording || isTranscribing) && (
                                <CircularProgress
                                    size={28}
                                    color={isRecording ? "error" : "primary"}
                                    sx={{ position: "absolute" }}
                                />
                            )}
                            <MicIcon
                                sx={{
                                    fontSize: 16,
                                    opacity: isTranscribing ? 0.4 : 1,
                                    ...(isRecording
                                        ? {
                                              animation: "datonfly-mic-pulse 1.2s ease-in-out infinite",
                                              "@keyframes datonfly-mic-pulse": {
                                                  "0%, 100%": { opacity: 1 },
                                                  "50%": { opacity: 0.4 },
                                              },
                                          }
                                        : {}),
                                }}
                            />
                        </Box>
                    </IconButton>
                </span>
            </Tooltip>
            <Snackbar
                open={errorMsg !== null}
                autoHideDuration={4000}
                onClose={() => {
                    setErrorMsg(null);
                }}
                anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
            >
                <Alert
                    severity="error"
                    variant="filled"
                    onClose={() => {
                        setErrorMsg(null);
                    }}
                >
                    {errorMsg}
                </Alert>
            </Snackbar>
        </>
    );
}

/**
 * Pre-built {@link InputTool} that records audio, transcribes it server-side,
 * and submits the resulting text as a chat message.
 *
 * Renders its own toggle button: click to start recording (the icon animates
 * with a highlighted progress ring), click again to stop and transcribe.
 * Requires the server to advertise the `audioInput` feature and a
 * {@link ChatClientContext} provider in the React tree.
 */
export const audioInputTool: InputTool = {
    name: "audio",
    icon: <MicIcon sx={{ fontSize: 16 }} />,
    placement: "input-end",
    renderButton: (props) => <AudioInputButton {...props} />,
};
