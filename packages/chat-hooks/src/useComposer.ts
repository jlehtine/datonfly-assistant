import { useCallback, useState } from "react";

export interface UseComposerResult {
    text: string;
    setText: (text: string) => void;
    submit: () => void;
}

export function useComposer(onSend: (text: string) => void): UseComposerResult {
    const [text, setText] = useState("");

    const submit = useCallback(() => {
        const trimmed = text.trim();
        if (!trimmed) return;
        onSend(trimmed);
        setText("");
    }, [text, onSend]);

    return { text, setText, submit };
}
