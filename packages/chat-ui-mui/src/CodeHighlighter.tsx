import Typography from "@mui/material/Typography";
import type { CSSProperties, ReactElement } from "react";
import type { ExtraProps } from "react-markdown";
import SyntaxHighlighter from "react-syntax-highlighter";
import { atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs";

export type CodeProps = React.ClassAttributes<HTMLElement> & React.HTMLAttributes<HTMLElement> & ExtraProps;

// The hljs style objects are typed as Record<string, CSSProperties> at runtime
// but the @types package has a slight mismatch — cast once here.
const highlightStyle = atomOneDark as Record<string, CSSProperties>;

/**
 * A custom `code` renderer for `react-markdown` that applies syntax
 * highlighting to fenced code blocks using `react-syntax-highlighter`.
 *
 * Inline code (not inside a `<pre>`) is rendered as a plain `<code>` element
 * to keep it visually distinct from block code.
 *
 * Only pass this renderer when the message is **not** streaming so that
 * partially-received code blocks are not highlighted prematurely.
 */
export function CodeHighlighter({ children, className, node: _node }: CodeProps): ReactElement {
    // react-markdown sets className="language-<lang>" on fenced blocks
    const match = /language-(\w+)/.exec(className ?? "");
    const language = match?.[1];
    // Code block children from react-markdown are always strings
    const codeText = typeof children === "string" ? children.replace(/\n$/, "") : "";

    if (language !== undefined) {
        // Fenced block with a language hint
        return (
            <SyntaxHighlighter style={highlightStyle} language={language} PreTag="div">
                {codeText}
            </SyntaxHighlighter>
        );
    }

    if (className !== undefined) {
        // Fenced block without a recognised language hint
        return (
            <SyntaxHighlighter style={highlightStyle} PreTag="div">
                {codeText}
            </SyntaxHighlighter>
        );
    }

    // Inline code — no language class present
    return (
        <Typography component="code" className={className}>
            {children}
        </Typography>
    );
}
