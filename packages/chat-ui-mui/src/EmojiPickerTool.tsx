import EmojiEmotionsIcon from "@mui/icons-material/EmojiEmotions";
import EmojiPicker, { type EmojiClickData } from "emoji-picker-react";
import type { ReactElement } from "react";

import type { InputTool, InputToolContext, InputToolResult } from "./InputTool.js";

// eslint-disable-next-line react-refresh/only-export-components -- private component used only within this module
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

/** Pre-built {@link InputTool} that opens an emoji picker and inserts the chosen emoji at the cursor position. */
export const emojiPickerTool: InputTool = {
    name: "emoji",
    icon: <EmojiEmotionsIcon sx={{ fontSize: 16 }} />,
    onActivate: (ctx, done) => <EmojiPickerPanel ctx={ctx} done={done} />,
};
