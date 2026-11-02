import { describe, expect, it } from "vitest";
import { buildInsights } from "./insights.js";

describe("buildInsights", () => {
  it("does not warn for an action without a deadline", () => {
    const result = buildInsights([{ required_action: "Submit form", deadline_days: null, effective_deadline_days: null }]);
    expect(result.warnings).toEqual([]);
    expect(result.missingInfo).toEqual([]);
  });

  it("reports overdue and urgent actions", () => {
    const result = buildInsights([
      { required_action: "Late", deadline_days: -3 },
      { required_action: "Soon", effective_deadline_days: 2 },
    ]);
    expect(result.warnings.map((item) => item.reason)).toEqual(["Overdue by 3 days", "Urgent: 2 days remaining"]);
  });

  it("only reports missing appointment time and location", () => {
    const result = buildInsights([
      { required_action: "Visit office", appointment_date: "2026-11-03", deadline_days: 2 },
      { required_action: "Call office", appointment_time: "10:00", office_location: null },
    ]);
    expect(result.missingInfo).toEqual([
      "Visit office: Appointment time not specified",
      "Visit office: Office location not specified",
      "Call office: Office location not specified",
    ]);
  });
});
