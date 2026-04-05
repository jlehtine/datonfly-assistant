import type { ReactElement } from "react";

export interface InputToolContext {
    text: string;
    selectionStart: number;
    selectionEnd: number;
}

export interface InputToolResult {
    text: string;
    selectionStart: number;
    selectionEnd: number;
}

export interface InputTool {
    name: string;
    icon: ReactElement;
    onActivate: (ctx: InputToolContext, done: (result: InputToolResult | null) => void) => ReactElement;
}
