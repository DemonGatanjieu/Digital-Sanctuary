import { describe, expect, it } from "vitest";
import { parseWorkId, parseWorkIds, parseWorkQuery } from "./library-query.js";

describe("parseWorkQuery", () => {
  it("keeps supported fields and bounds pagination", () => {
    expect(parseWorkQuery({
      search: "  cloud  ",
      workType: "manga",
      sortBy: "title",
      direction: "asc",
      limit: 9_999,
      offset: -10
    })).toEqual({
      search: "cloud",
      workType: "manga",
      sortBy: "title",
      direction: "asc",
      limit: 200,
      offset: 0
    });
  });

  it("drops unsupported renderer input", () => {
    expect(parseWorkQuery({ workType: "anything", sortBy: "sql", direction: "sideways" }))
      .toEqual({ limit: 60, offset: 0 });
    expect(parseWorkId(42)).toBeNull();
    expect(parseWorkId("pixiv:42")).toBe("pixiv:42");
    expect(parseWorkIds(["pixiv:42", "pixiv:42", "local:1"])).toEqual(["pixiv:42", "local:1"]);
    expect(parseWorkIds([])).toBeNull();
  });
});
