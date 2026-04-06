const ONE_MINUTE_MS = 60_000;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

/**
 * Format a timestamp into a human-friendly display string with tiered logic:
 *
 * - < 1 minute ago → "Just now"
 * - < 1 hour ago → relative, e.g. "5 minutes ago"
 * - Today, ≥ 1 hour ago → time only, e.g. "14:30"
 * - Yesterday → "Yesterday, 14:30"
 * - Past 6 days → weekday + time, e.g. "Monday, 14:30"
 * - This year → short date + time, e.g. "Apr 3, 14:30"
 * - Older → full date + time, e.g. "Apr 3, 2025, 14:30"
 *
 * Uses `Intl.DateTimeFormat` and `Intl.RelativeTimeFormat` for locale-aware
 * output. The optional `locale` parameter defaults to the browser locale;
 * pass an explicit locale string when i18n is introduced.
 *
 * @param date - The timestamp to format.
 * @param now - Reference "now" timestamp (defaults to `new Date()`). Useful for testing.
 * @param locale - BCP 47 locale string, e.g. `"en-US"`. Defaults to browser locale.
 */
export function formatTimestamp(date: Date, now: Date = new Date(), locale?: string): string {
    const diffMs = now.getTime() - date.getTime();

    if (diffMs < ONE_MINUTE_MS) {
        return "Just now";
    }

    if (diffMs < ONE_HOUR_MS) {
        const minutes = Math.floor(diffMs / ONE_MINUTE_MS);
        const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
        return rtf.format(-minutes, "minute");
    }

    const timeFmt = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });
    const timeStr = timeFmt.format(date);

    // Check if same calendar day
    if (isSameDay(date, now)) {
        return timeStr;
    }

    // Check if yesterday
    const yesterday = new Date(now.getTime() - ONE_DAY_MS);
    if (isSameDay(date, yesterday)) {
        return `Yesterday, ${timeStr}`;
    }

    // Check if within the past 6 days (same week-ish)
    if (diffMs < 6 * ONE_DAY_MS) {
        const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: "long" });
        return `${weekdayFmt.format(date)}, ${timeStr}`;
    }

    // Same year
    if (date.getFullYear() === now.getFullYear()) {
        const dateFmt = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
        return `${dateFmt.format(date)}, ${timeStr}`;
    }

    // Different year
    const fullDateFmt = new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" });
    return `${fullDateFmt.format(date)}, ${timeStr}`;
}

/**
 * Format a timestamp as a complete absolute datetime string suitable for
 * tooltips. Always includes full weekday, date, and time with seconds.
 *
 * Example: "Sunday, April 6, 2026, 14:30:45"
 *
 * @param date - The timestamp to format.
 * @param locale - BCP 47 locale string. Defaults to browser locale.
 */
export function formatTimestampFull(date: Date, locale?: string): string {
    const fmt = new Intl.DateTimeFormat(locale, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
    });
    return fmt.format(date);
}

/**
 * Determine whether a timestamp divider should be shown between two
 * consecutive messages.
 *
 * Rules:
 * - Always before the first message (`prevCreatedAt` is `undefined`).
 * - Always when the calendar date changes between two messages.
 * - When the gap is ≥ 1 hour on the same calendar day.
 * - Never when the current message lacks a `createdAt`.
 *
 * This function is pure and stateless — it re-evaluates on every render, so
 * lazy-loaded history prepends work automatically without special-casing.
 *
 * @param prevCreatedAt - `createdAt` of the previous message, or `undefined` for the first message.
 * @param currentCreatedAt - `createdAt` of the current message.
 */
export function shouldShowTimestamp(prevCreatedAt: Date | undefined, currentCreatedAt: Date | undefined): boolean {
    if (!currentCreatedAt) return false;
    if (!prevCreatedAt) return true;

    // Different calendar day → always show
    if (!isSameDay(prevCreatedAt, currentCreatedAt)) return true;

    // Same day, check if gap ≥ 1 hour
    return currentCreatedAt.getTime() - prevCreatedAt.getTime() >= ONE_HOUR_MS;
}

function isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
