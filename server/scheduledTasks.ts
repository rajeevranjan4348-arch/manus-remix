/**
 * Scheduled task intent parsing and time validation for Manus.
 *
 * This module deliberately does not create timers in a serverless process:
 * callers must persist accepted tasks and deliver them through a durable
 * scheduler/notification provider. All timestamps are ISO strings and timezone
 * handling is explicit so a request like "remind me at 10 AM" is never silently
 * interpreted in UTC.
 */

export type ScheduledTaskIntent = {
  kind: "reminder";
  title: string;
  message: string;
  dueAt: string;
  timeZone: string;
  recurrence: "once" | "daily" | "weekly" | "monthly";
};

export type ParseReminderOptions = {
  now?: Date;
  timeZone: string;
};

const TIME_PATTERN = /\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i;

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function offsetAt(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
  );
  return asUtc - date.getTime();
}

/** Convert a local wall-clock date/time to a UTC instant using an IANA zone. */
function localDateTimeToIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): string {
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let instant = new Date(wallClockAsUtc);
  // Two passes handle ordinary DST transitions without a third-party library.
  instant = new Date(wallClockAsUtc - offsetAt(instant, timeZone));
  instant = new Date(wallClockAsUtc - offsetAt(instant, timeZone));
  return instant.toISOString();
}

/**
 * Recognizes common single-reminder commands such as:
 * "remind me at 10 am to study", "inform me tomorrow at 9:30 PM about class",
 * "remind me in 20 minutes to drink water".
 *
 * Returns null when the request is ambiguous or unsupported; the UI should ask
 * a clarification question rather than claiming that a task has been scheduled.
 */
export function parseReminderIntent(
  input: string,
  options: ParseReminderOptions,
): ScheduledTaskIntent | null {
  const text = input.trim();
  if (!/\b(remind me|reminder|inform me|notify me|alert me|schedule a reminder)\b/i.test(text)) {
    return null;
  }

  const now = options.now ?? new Date();
  const timeZone = options.timeZone;
  try {
    // Validate the IANA timezone early.
    new Intl.DateTimeFormat("en", { timeZone }).format(now);
  } catch {
    return null;
  }

  const recurrence: ScheduledTaskIntent["recurrence"] =
    /\bevery day|daily\b/i.test(text) ? "daily" :
    /\bevery week|weekly\b/i.test(text) ? "weekly" :
    /\bevery month|monthly\b/i.test(text) ? "monthly" : "once";

  let dueAt: string;
  const relative = text.match(/\bin\s+(\d+)\s*(minute|minutes|min|hour|hours|day|days)\b/i);
  if (relative) {
    const amount = Number(relative[1]);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const unit = relative[2].toLowerCase();
    const ms = unit.startsWith("min") ? amount * 60_000
      : unit.startsWith("hour") ? amount * 3_600_000
      : amount * 86_400_000;
    dueAt = new Date(now.getTime() + ms).toISOString();
  } else {
    const match = text.match(TIME_PATTERN);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2] ?? "0");
    const meridiem = match[3].replace(/\./g, "").toLowerCase();
    if (hour < 1 || hour > 12 || minute > 59) return null;
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);

    const parts = zonedParts(now, timeZone);
    const dayOffset = /\btomorrow\b/i.test(text) ? 1 : 0;
    const localDate = new Date(Date.UTC(
      Number(parts.year), Number(parts.month) - 1,
      Number(parts.day) + dayOffset,
    ));
    dueAt = localDateTimeToIso(
      localDate.getUTCFullYear(), localDate.getUTCMonth() + 1,
      localDate.getUTCDate(), hour, minute, timeZone,
    );
    if (new Date(dueAt).getTime() <= now.getTime()) {
      if (dayOffset === 1 || recurrence !== "once") {
        // Tomorrow was explicitly requested or recurrence starts on the next day.
      } else {
        const nextDay = new Date(Date.UTC(
          localDate.getUTCFullYear(), localDate.getUTCMonth(), localDate.getUTCDate() + 1,
        ));
        dueAt = localDateTimeToIso(
          nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1,
          nextDay.getUTCDate(), hour, minute, timeZone,
        );
      }
    }
  }

  const message = text
    .replace(/\b(remind me|reminder|inform me|notify me|alert me|schedule a reminder)\b/ig, "")
    .replace(/\b(tomorrow|today|daily|weekly|monthly|every day|every week|every month)\b/ig, "")
    .replace(TIME_PATTERN, "")
    .replace(/\bin\s+\d+\s*(minute|minutes|min|hour|hours|day|days)\b/i, "")
    .replace(/\b(to|about|that)\b/i, "")
    .replace(/[,.!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!message) return null;
  return {
    kind: "reminder",
    title: message.length > 48 ? message.slice(0, 45).trimEnd() + "..." : message,
    message,
    dueAt,
    timeZone,
    recurrence,
  };
}
