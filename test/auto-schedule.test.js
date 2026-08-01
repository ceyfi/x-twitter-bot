import test from "node:test";
import assert from "node:assert/strict";
import { getAutoScheduleState, hasRecentPost } from "../lib/auto-schedule.js";

test("runs at 19:00 Belgrade on the configured alternating summer day", () => {
  const now = new Date("2026-08-02T17:45:00Z");
  assert.equal(getAutoScheduleState(now, "0 17 * * *").shouldRun, true);
  assert.equal(getAutoScheduleState(now, "0 18 * * *").shouldRun, false);
});

test("uses the winter UTC offset without changing local post time", () => {
  const now = new Date("2026-12-02T18:30:00Z");
  assert.equal(getAutoScheduleState(now, "0 17 * * *").shouldRun, false);
  assert.equal(getAutoScheduleState(now, "0 18 * * *").shouldRun, true);
});

test("skips the day between automatic fallback days", () => {
  const state = getAutoScheduleState(new Date("2026-08-03T17:00:00Z"), "0 17 * * *");
  assert.equal(state.localHour, 19);
  assert.equal(state.eligibleDay, false);
  assert.equal(state.shouldRun, false);
});

test("uses the scheduled cron time even if GitHub starts the job late", () => {
  const delayedRun = new Date("2026-08-02T20:20:00Z");
  assert.equal(getAutoScheduleState(delayedRun, "0 17 * * *").shouldRun, true);
});

test("detects a post inside the last 24 hours and ignores older or future timestamps", () => {
  const now = Date.parse("2026-08-02T17:00:00Z");
  assert.equal(hasRecentPost([{ created_at: "2026-08-01T17:00:00Z" }], now), true);
  assert.equal(hasRecentPost([{ created_at: "2026-08-01T16:59:59Z" }], now), false);
  assert.equal(hasRecentPost([{ created_at: "2026-08-02T17:02:00Z" }], now), false);
});
