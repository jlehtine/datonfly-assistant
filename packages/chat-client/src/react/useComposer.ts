import { useCallback, useState } from "react";

/** Return value of {@link useComposer}. */
export interface UseComposerResult {
    /** Current text content of the composer input. */
    text: string;
    /** Update the text content. */
    setText: (text: string) => void;
    /** Submit the current text via `onSend` and reset the composer. No-op when text is blank. */
    submit: () => void;
    /** Submit the given text directly via `onSend` and reset the composer. No-op when text is blank. */
    submitText: (text: string) => void;
}

/**
 * Manage the state of a message composer input.
 *
 * @param onSend - Callback invoked with the trimmed message text when the user submits.
 */
export function useComposer(onSend: (text: string) => void): UseComposerResult {
    const [text, setText] = useState("");

    const submitText = useCallback(
        (value: string) => {
            const trimmed = value.trim();
            if (!trimmed) return;
            onSend(trimmed);
            setText("");
        },
        [onSend],
    );

    const submit = useCallback(() => {
        submitText(text);
    }, [text, submitText]);

    return { text, setText, submit, submitText };
}
