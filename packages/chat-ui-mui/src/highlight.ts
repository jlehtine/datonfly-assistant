import type { ComponentType } from "react";
import type { Components } from "react-markdown";

import { CodeHighlighter, type CodeProps } from "./CodeHighlighter.js";

/**
 * A `react-markdown` `components` map that enables syntax highlighting for
 * fenced code blocks.  Import from `@datonfly-assistant/chat-ui-mui/highlight`
 * and pass to {@link MessageBubble} via its `components` prop.
 *
 * `react-syntax-highlighter` must be installed as a peer dependency when
 * using this export.
 *
 * @example
 * ```tsx
 * import { MessageBubble } from "@datonfly-assistant/chat-ui-mui";
 * import { highlightComponents } from "@datonfly-assistant/chat-ui-mui/highlight";
 *
 * <MessageBubble message={msg} components={highlightComponents} />
 * ```
 */
export const highlightComponents: Components = {
    code: CodeHighlighter as ComponentType<CodeProps>,
};
