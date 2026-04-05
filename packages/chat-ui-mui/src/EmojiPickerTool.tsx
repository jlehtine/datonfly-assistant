import EmojiPicker, { type EmojiClickData } from "emoji-picker-react";
import type { ReactElement } from "react";

import type { InputTool, InputToolContext, InputToolResult } from "./InputTool.js";

function EmojiIcon(): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
        </svg>
    );
}

function EmojiPickerPanel({
    ctx,
    done,
}: {
    ctx: InputToolContext;
    done: (result: InputToolResult | null) => void;
}): ReactElement {
    const handleEmojiClick = (emojiData: EmojiClickData): void => {
        const before = ctx.text.slice(0, ctx.selectionStart);
        const after = ctx.text.slice(ctx.selectionEnd);
        const newText = before + emojiData.emoji + after;
        const newCursor = ctx.selectionStart + emojiData.emoji.length;
        done({ text: newText, selectionStart: newCursor, selectionEnd: newCursor });
    };

    return <EmojiPicker onEmojiClick={handleEmojiClick} />;
}

export const emojiPickerTool: InputTool = {
    name: "emoji",
    icon: <EmojiIcon />,
    onActivate: (ctx, done) => <EmojiPickerPanel ctx={ctx} done={done} />,
};
