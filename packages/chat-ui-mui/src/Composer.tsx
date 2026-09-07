import AttachFileIcon from "@mui/icons-material/AttachFile";
import CloseIcon from "@mui/icons-material/Close";
import DescriptionIcon from "@mui/icons-material/Description";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import SendIcon from "@mui/icons-material/Send";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Popover from "@mui/material/Popover";
import TextField from "@mui/material/TextField";
import useMediaQuery from "@mui/material/useMediaQuery";
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type ClipboardEvent,
    type ComponentType,
    type DragEvent,
    type KeyboardEvent,
    type ReactElement,
} from "react";
import { useTranslation } from "react-i18next";

import { deleteAttachment, uploadAttachment } from "@datonfly-assistant/chat-client";
import { useChatClient, useComposer } from "@datonfly-assistant/chat-client/react";
import {
    classifyAttachmentMimeType,
    type AttachmentContentPart,
    type AttachmentLimits,
} from "@datonfly-assistant/core";

import { AdornmentToolButton } from "./AdornmentToolButton.js";
import { orderAdornmentTools, type InputTool, type InputToolContext, type InputToolResult } from "./InputTool.js";

function ToolPopoverContent({
    tool,
    ctx,
    onDone,
}: {
    tool: InputTool;
    ctx: InputToolContext;
    onDone: (result: InputToolResult | null) => void;
}): ReactElement {
    return <>{tool.onActivate?.(ctx, onDone)}</>;
}

function RenderButtonSlot({
    render,
    getContext,
    done,
    disabled,
}: {
    render: NonNullable<InputTool["renderButton"]>;
    getContext: () => InputToolContext;
    done: (result: InputToolResult | null) => void;
    disabled: boolean;
}): ReactElement {
    return render({ getContext, done, disabled });
}

/** Props passed to a custom composer input component. */
export interface ComposerInputProps {
    /** Current text value. */
    value: string;
    /** Callback to update the text value. */
    onChange: (value: string) => void;
    /** Keyboard event handler (used to detect Enter-to-send). */
    onKeyDown: (e: KeyboardEvent) => void;
    /** Placeholder text shown when the input is empty. */
    placeholder: string;
    /** Whether the input should be non-interactive. */
    disabled: boolean;
    /** Whether the input should receive focus on mount. */
    autoFocus: boolean;
    /** Optional input tools (e.g. emoji picker) to render alongside the input. */
    inputTools?: InputTool[] | undefined;
    /** Maximum number of visible rows before the textarea scrolls. */
    maxRows?: number | undefined;
    /** Submit the given text directly (used by tools that auto-send, e.g. audio input). */
    onSubmitText?: ((text: string) => void) | undefined;
}

/** Props for the {@link Composer} component. */
export interface ComposerProps {
    /** Callback invoked with the trimmed message text and any attachments when the user submits. */
    onSend: (text: string, attachments?: AttachmentContentPart[]) => void;
    /** When `true`, the send button and input are disabled. */
    disabled?: boolean | undefined;
    /** Override the built-in plain-text input with a custom component. */
    inputComponent?: ComponentType<ComposerInputProps> | undefined;
    /** Optional input tools (e.g. emoji picker) to attach to the default input. */
    inputTools?: InputTool[] | undefined;
    /** Maximum number of visible rows in the textarea before it scrolls. */
    maxRows?: number | undefined;
    /** When set, enables file/image context-input attachments with the given limits. */
    fileInputLimits?: AttachmentLimits | undefined;
}

/** A locally-tracked attachment being uploaded or ready to send. */
interface PendingAttachment {
    /** Stable local identifier for list tracking. */
    localId: string;
    /** Original file name. */
    name: string;
    /** MIME type of the file. */
    mimeType: string;
    /** Size of the file in bytes. */
    size: number;
    /** Upload status. */
    status: "uploading" | "ready" | "error";
    /** Server-assigned attachment ID, set once uploaded. */
    id?: string | undefined;
    /** Object URL for image previews. */
    previewUrl?: string | undefined;
    /** Error message when `status` is `"error"`. */
    error?: string | undefined;
}

function DefaultInput({
    value,
    onChange,
    onKeyDown,
    placeholder,
    disabled,
    autoFocus,
    inputTools,
    maxRows,
    onSubmitText,
}: ComposerInputProps): ReactElement {
    const { t } = useTranslation();
    const inputRef = useRef<HTMLInputElement>(null);
    const selectionRef = useRef({ start: 0, end: 0 });
    const [activeTool, setActiveTool] = useState<InputTool | null>(null);
    const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
    const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
    const [toolCtx, setToolCtx] = useState({ text: "", selectionStart: 0, selectionEnd: 0 });

    useEffect(() => {
        if (!autoFocus) return;
        inputRef.current?.focus();
    }, [autoFocus]);

    const handleDone = (result: InputToolResult | null): void => {
        if (result) {
            if (result.submit && onSubmitText) {
                onSubmitText(result.text);
            } else {
                onChange(result.text);
                setTimeout(() => {
                    const input = inputRef.current;
                    if (input) {
                        input.setSelectionRange(result.selectionStart, result.selectionEnd);
                        input.focus();
                    }
                }, 0);
            }
        }
        setActiveTool(null);
    };

    const snapshotToolCtx = (): void => {
        setToolCtx({
            text: value,
            selectionStart: selectionRef.current.start,
            selectionEnd: selectionRef.current.end,
        });
    };

    const getToolContext = (): InputToolContext => ({
        text: value,
        selectionStart: selectionRef.current.start,
        selectionEnd: selectionRef.current.end,
    });

    const leftTools = (inputTools ?? []).filter(
        (tool) => tool.placement !== "input-end" && tool.placement !== "action",
    );
    const adornmentTools = orderAdornmentTools(
        (inputTools ?? []).filter((tool) => tool.placement === "input-end" || tool.placement === "action"),
    );
    const hasMultipleTools = leftTools.length > 1;

    return (
        <Box sx={{ display: "flex", alignItems: "flex-end", gap: 0.5 }}>
            {hasMultipleTools ? (
                <IconButton
                    size="small"
                    aria-label={t("tools")}
                    onClick={(e) => {
                        setMenuAnchor(e.currentTarget);
                        setToolsMenuOpen(true);
                    }}
                    sx={{ mb: 0.5 }}
                >
                    <ExpandLessIcon sx={{ fontSize: 20 }} />
                </IconButton>
            ) : (
                leftTools.map((tool) => (
                    <IconButton
                        key={tool.name}
                        size="small"
                        aria-label={tool.name}
                        onClick={(e) => {
                            setAnchorEl(e.currentTarget);
                            snapshotToolCtx();
                            setActiveTool(tool);
                        }}
                        sx={{ mb: 0.5 }}
                    >
                        {tool.icon}
                    </IconButton>
                ))
            )}
            <TextField
                inputRef={inputRef}
                multiline
                maxRows={maxRows ?? 4}
                placeholder={placeholder}
                value={value}
                onChange={(e) => {
                    onChange(e.target.value);
                }}
                onKeyDown={onKeyDown}
                onSelect={(e) => {
                    const target = e.target as HTMLTextAreaElement;
                    selectionRef.current = { start: target.selectionStart, end: target.selectionEnd };
                }}
                disabled={disabled}
                size="small"
                className="datonfly-composer-input"
                sx={{ flex: 1 }}
                slotProps={
                    adornmentTools.length > 0
                        ? {
                              input: {
                                  endAdornment: (
                                      <InputAdornment position="end" sx={{ alignSelf: "flex-end", mb: 0.5 }}>
                                          {adornmentTools.map((tool) =>
                                              tool.renderButton ? (
                                                  <Box key={tool.name} sx={{ display: "inline-flex" }}>
                                                      <RenderButtonSlot
                                                          render={tool.renderButton}
                                                          getContext={getToolContext}
                                                          done={handleDone}
                                                          disabled={disabled}
                                                      />
                                                  </Box>
                                              ) : (
                                                  <AdornmentToolButton
                                                      key={tool.name}
                                                      tool={tool}
                                                      disabled={disabled}
                                                      onActivate={(anchor) => {
                                                          setAnchorEl(anchor);
                                                          snapshotToolCtx();
                                                          setActiveTool(tool);
                                                      }}
                                                  />
                                              ),
                                          )}
                                      </InputAdornment>
                                  ),
                              },
                          }
                        : undefined
                }
            />
            {hasMultipleTools && menuAnchor && (
                <Popover
                    open={toolsMenuOpen}
                    anchorEl={menuAnchor}
                    onClose={() => {
                        setToolsMenuOpen(false);
                    }}
                    anchorOrigin={{ vertical: "top", horizontal: "left" }}
                    transformOrigin={{ vertical: "bottom", horizontal: "left" }}
                >
                    <Box sx={{ display: "flex", gap: 0.5, p: 0.5 }}>
                        {leftTools.map((tool) => (
                            <IconButton
                                key={tool.name}
                                size="small"
                                aria-label={tool.name}
                                onClick={(e) => {
                                    setToolsMenuOpen(false);
                                    setAnchorEl(e.currentTarget);
                                    snapshotToolCtx();
                                    setActiveTool(tool);
                                }}
                            >
                                {tool.icon}
                            </IconButton>
                        ))}
                    </Box>
                </Popover>
            )}
            {activeTool && anchorEl && (
                <Popover
                    open
                    anchorEl={anchorEl}
                    onClose={() => {
                        setActiveTool(null);
                    }}
                    anchorOrigin={{ vertical: "top", horizontal: "left" }}
                    transformOrigin={{ vertical: "bottom", horizontal: "left" }}
                >
                    <ToolPopoverContent tool={activeTool} ctx={toolCtx} onDone={handleDone} />
                </Popover>
            )}
        </Box>
    );
}

/**
 * Activation panel for the attachment tool. Opening the native file picker is
 * the entire interaction, so this renders nothing visible: on mount it triggers
 * the hidden file input and immediately dismisses the tool popover.
 */
function AttachmentTrigger({
    onTrigger,
    done,
}: {
    onTrigger: () => void;
    done: (result: InputToolResult | null) => void;
}): null {
    const firedRef = useRef(false);
    useEffect(() => {
        if (firedRef.current) return;
        firedRef.current = true;
        onTrigger();
        done(null);
    }, [onTrigger, done]);
    return null;
}

/** Format a byte count as a short human-readable size string. */
function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${String(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Message input bar with a send button.
 *
 * Delegates text state management to {@link useComposer} and supports an
 * optional custom input component for rich-text editing. When `fileInputLimits`
 * is provided, a "+" button, clipboard paste, and drag-and-drop allow attaching
 * files/images as model context input.
 */
export function Composer({
    onSend,
    disabled,
    inputComponent: InputComponent,
    inputTools,
    maxRows,
    fileInputLimits,
}: ComposerProps): ReactElement {
    const { t } = useTranslation();
    const client = useChatClient();
    const { text, setText } = useComposer(onSend);
    const [pending, setPending] = useState<PendingAttachment[]>([]);
    const [dragActive, setDragActive] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isDisabled = disabled ?? false;
    const fileInputEnabled = fileInputLimits !== undefined;
    // On touch-primary devices the on-screen keyboard's Enter key is the only way
    // to insert a line break, so it must not send; the send button submits there.
    const touchPrimary = useMediaQuery("(pointer: coarse)");

    // Revoke object URLs on unmount to avoid leaks. The ref mirrors the latest
    // pending list so the unmount cleanup and event callbacks see current data.
    const pendingRef = useRef(pending);
    useEffect(() => {
        pendingRef.current = pending;
    }, [pending]);
    useEffect(() => {
        return () => {
            for (const p of pendingRef.current) {
                if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
            }
        };
    }, []);

    const uploading = pending.some((p) => p.status === "uploading");
    const readyAttachments = pending.filter((p) => p.status === "ready" && p.id !== undefined);
    const canSend = !isDisabled && !uploading && (text.trim().length > 0 || readyAttachments.length > 0);

    const addFiles = useCallback(
        (files: File[]): void => {
            if (!fileInputLimits) return;
            for (const file of files) {
                const localId = crypto.randomUUID();
                const tooMany = pendingRef.current.length >= fileInputLimits.maxPerMessage;
                const tooLarge = file.size > fileInputLimits.maxFileBytes;
                const kind = classifyAttachmentMimeType(file.type);
                const unsupported = kind === "unsupported" && !file.type.startsWith("text/");
                const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
                const base: PendingAttachment = {
                    localId,
                    name: file.name,
                    mimeType: file.type,
                    size: file.size,
                    status: "uploading",
                    previewUrl,
                };

                if (tooMany) {
                    setPending((prev) => [...prev, { ...base, status: "error", error: t("attachmentTooMany") }]);
                    continue;
                }
                // A picked entry the platform could only partially materialize yields
                // plausible metadata but no bytes; uploading it would store an empty file.
                if (file.size === 0) {
                    setPending((prev) => [...prev, { ...base, status: "error", error: t("attachmentNotReadable") }]);
                    continue;
                }
                if (tooLarge) {
                    setPending((prev) => [...prev, { ...base, status: "error", error: t("attachmentTooLarge") }]);
                    continue;
                }
                if (unsupported) {
                    setPending((prev) => [...prev, { ...base, status: "error", error: t("attachmentUnsupported") }]);
                    continue;
                }

                setPending((prev) => [...prev, base]);
                void (async () => {
                    try {
                        const info = await uploadAttachment(client, file);
                        setPending((prev) =>
                            prev.map((p) =>
                                p.localId === localId
                                    ? { ...p, status: "ready", id: info.id, mimeType: info.mimeType, size: info.size }
                                    : p,
                            ),
                        );
                    } catch (error) {
                        const detail = error instanceof Error ? error.message : String(error);
                        setPending((prev) =>
                            prev.map((p) =>
                                p.localId === localId
                                    ? { ...p, status: "error", error: `${t("attachmentUploadFailed")}: ${detail}` }
                                    : p,
                            ),
                        );
                    }
                })();
            }
        },
        [client, fileInputLimits, t],
    );

    // Chrome on Android fires `change` with an empty list when it cannot resolve the
    // picked entry (e.g. a cloud-backed gallery item) into readable bytes. A cancelled
    // picker fires the separate `cancel` event instead, so this is always a real failure.
    const addUnreadableFileError = useCallback((): void => {
        setPending((prev) => [
            ...prev,
            {
                localId: crypto.randomUUID(),
                name: "",
                mimeType: "",
                size: 0,
                status: "error",
                error: t("attachmentNotReadable"),
            },
        ]);
    }, [t]);

    const removeAttachment = useCallback(
        (localId: string): void => {
            setPending((prev) => {
                const target = prev.find((p) => p.localId === localId);
                if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
                if (target?.id) void deleteAttachment(client, target.id).catch(() => undefined);
                return prev.filter((p) => p.localId !== localId);
            });
        },
        [client],
    );

    const handleSend = useCallback(
        (value: string): void => {
            const trimmed = value.trim();
            const ready = pendingRef.current.filter((p) => p.status === "ready" && p.id !== undefined);
            if (uploading) return;
            if (!trimmed && ready.length === 0) return;
            const attachments: AttachmentContentPart[] = ready.flatMap((p) =>
                p.id === undefined
                    ? []
                    : [
                          {
                              type: "attachment" as const,
                              attachmentId: p.id,
                              name: p.name,
                              mimeType: p.mimeType,
                              size: p.size,
                          },
                      ],
            );
            onSend(trimmed, attachments);
            setText("");
            // Attachments are now associated server-side; drop them locally
            // without issuing delete calls.
            setPending((prev) => {
                for (const p of prev) {
                    if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
                }
                return [];
            });
        },
        [onSend, setText, uploading],
    );

    const handleKeyDown = (e: KeyboardEvent): void => {
        if (touchPrimary) return;
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend(text);
        }
    };

    const handlePaste = (e: ClipboardEvent): void => {
        if (!fileInputEnabled) return;
        const files = Array.from(e.clipboardData.files);
        if (files.length > 0) {
            e.preventDefault();
            addFiles(files);
        }
    };

    const handleDrop = (e: DragEvent): void => {
        if (!fileInputEnabled) return;
        e.preventDefault();
        setDragActive(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) addFiles(files);
    };

    // Surface the attachment action as a standard toolbar tool (like the emoji
    // picker): a static icon whose activation opens the native file picker.
    // Placement `"action"` keeps it available in every mode — next to the audio
    // button in the collapsed input-end adornment and in the formatting toolbar
    // when the editor is expanded — so files can be attached without leaving the
    // plain text field.
    const attachmentTool: InputTool = {
        name: "attachment",
        icon: <AttachFileIcon sx={{ fontSize: 16 }} />,
        tooltip: t("addAttachment"),
        placement: "action",
        onActivate: (_ctx, done) => <AttachmentTrigger onTrigger={() => fileInputRef.current?.click()} done={done} />,
    };

    const mergedInputTools = fileInputEnabled ? [...(inputTools ?? []), attachmentTool] : inputTools;

    const inputProps: ComposerInputProps = {
        value: text,
        onChange: setText,
        onKeyDown: handleKeyDown,
        placeholder: t("typeAMessage"),
        disabled: isDisabled,
        autoFocus: !isDisabled,
        inputTools: mergedInputTools,
        maxRows,
        onSubmitText: handleSend,
    };

    const ActiveInput = InputComponent ?? DefaultInput;

    return (
        <Box
            className="datonfly-composer"
            onPaste={handlePaste}
            onDragOver={
                fileInputEnabled
                    ? (e) => {
                          e.preventDefault();
                          setDragActive(true);
                      }
                    : undefined
            }
            onDragLeave={
                fileInputEnabled
                    ? () => {
                          setDragActive(false);
                      }
                    : undefined
            }
            onDrop={fileInputEnabled ? handleDrop : undefined}
            sx={{
                p: 2,
                borderTop: 1,
                borderColor: "divider",
                ...(dragActive ? { bgcolor: "action.hover", outline: "2px dashed", outlineColor: "primary.main" } : {}),
            }}
        >
            {pending.length > 0 && (
                <Box className="datonfly-attachment-previews" sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 1 }}>
                    {pending.map((p) => (
                        <AttachmentPreview key={p.localId} attachment={p} onRemove={removeAttachment} />
                    ))}
                </Box>
            )}
            <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end" }}>
                {fileInputEnabled && (
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        hidden
                        className="datonfly-attachment-input"
                        onChange={(e) => {
                            const files = Array.from(e.target.files ?? []);
                            if (files.length > 0) addFiles(files);
                            else addUnreadableFileError();
                            e.target.value = "";
                        }}
                    />
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <ActiveInput {...inputProps} />
                </Box>
                <IconButton
                    className="datonfly-send-button"
                    onClick={() => {
                        handleSend(text);
                    }}
                    disabled={!canSend}
                    color="primary"
                    aria-label={t("send")}
                    sx={{ mb: 0.5 }}
                >
                    <SendIcon />
                </IconButton>
            </Box>
        </Box>
    );
}

/** Render a single pending attachment as a thumbnail (images) or chip (other files). */
function AttachmentPreview({
    attachment,
    onRemove,
}: {
    attachment: PendingAttachment;
    onRemove: (localId: string) => void;
}): ReactElement {
    const { t } = useTranslation();
    const isImage = attachment.previewUrl !== undefined && attachment.status !== "error";

    if (isImage) {
        return (
            <Box
                className="datonfly-attachment-preview"
                data-attachment-status={attachment.status}
                sx={{ position: "relative", width: 64, height: 64 }}
            >
                <Box
                    component="img"
                    src={attachment.previewUrl}
                    alt={attachment.name}
                    sx={{
                        width: 64,
                        height: 64,
                        objectFit: "cover",
                        borderRadius: 1,
                        border: 1,
                        borderColor: "divider",
                        opacity: attachment.status === "uploading" ? 0.5 : 1,
                    }}
                />
                {attachment.status === "uploading" && (
                    <CircularProgress
                        size={20}
                        sx={{ position: "absolute", top: "calc(50% - 10px)", left: "calc(50% - 10px)" }}
                    />
                )}
                <IconButton
                    className="datonfly-remove-attachment-button"
                    aria-label={t("removeAttachment")}
                    size="small"
                    onClick={() => {
                        onRemove(attachment.localId);
                    }}
                    sx={{
                        position: "absolute",
                        top: -8,
                        right: -8,
                        bgcolor: "background.paper",
                        border: 1,
                        borderColor: "divider",
                        "&:hover": { bgcolor: "action.hover" },
                    }}
                >
                    <CloseIcon sx={{ fontSize: 14 }} />
                </IconButton>
            </Box>
        );
    }

    return (
        <Chip
            className="datonfly-attachment-preview"
            data-attachment-status={attachment.status}
            icon={
                attachment.status === "uploading" ? (
                    <CircularProgress size={14} />
                ) : (
                    <DescriptionIcon fontSize="small" />
                )
            }
            label={
                attachment.status === "error"
                    ? (attachment.error ?? attachment.name)
                    : `${attachment.name} (${formatBytes(attachment.size)})`
            }
            color={attachment.status === "error" ? "error" : "default"}
            variant="outlined"
            onDelete={() => {
                onRemove(attachment.localId);
            }}
            deleteIcon={<CloseIcon className="datonfly-remove-attachment-button" aria-label={t("removeAttachment")} />}
        />
    );
}
