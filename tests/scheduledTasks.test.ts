import { describe, expect, it } from "vitest";
import { parseReminderIntent } from "../server/scheduledTasks";

describe("parseReminderIntent", () => {
  const now = new Date("2026-10-15T03:00:00.000Z");

  it("parses relative reminders", () => {
    const result = parseReminderIntent("Remind me in 20 minutes to drink water", {
      now,
      timeZone: "Asia/Kolkata",
    });
    expect(result?.message.toLowerCase()).toContain("drink water");
    expect(result?.dueAt).toBe("2026-10-15T03:20:00.000Z");
    expect(result?.recurrence).toBe("once");
  });

  it("parses a local clock time and tomorrow qualifier", () => {
    const result = parseReminderIntent("Inform me tomorrow at 9:30 PM about class", {
      now,
      timeZone: "Asia/Kolkata",
    });
    expect(result?.timeZone).toBe("Asia/Kolkata");
    expect(result?.message.toLowerCase()).toContain("class");
    expect(result?.dueAt).toBe("2026-10-16T16:00:00.000Z");
  });

  it("returns null for non-reminder messages", () => {
    expect(parseReminderIntent("What time is it?", {
      now,
      timeZone: "Asia/Kolkata",
    })).toBeNull();
  });

  it("returns null when reminder timing is missing", () => {
    expect(parseReminderIntent("Remind me to study", {
      now,
      timeZone: "Asia/Kolkata",
    })).toBeNull();
  });
});
