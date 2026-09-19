import { describe, expect, it } from "vitest";
import {
  ACCESS_LINK_SECTION_KEYS,
  accessLinkSectionBadge,
  accessLinkSectionRequest,
  accessLinkSectionStudentCopy,
  accessLinkSectionsChanged,
  selectedAccessLinkSections,
} from "../accessLinks";

describe("Student Access section scope", () => {
  it("treats an absent, null, empty, or unreadable scope as every section", () => {
    for (const scope of [undefined, null, [], ["science"]]) {
      expect(selectedAccessLinkSections(scope)).toEqual([...ACCESS_LINK_SECTION_KEYS]);
    }
  });

  it("keeps a degenerate repeated key narrow rather than widening it to every section", () => {
    expect(selectedAccessLinkSections(["reading-writing", "reading-writing"])).toEqual([
      "reading-writing",
    ]);
  });

  it("opens a scoped link on its stored subset in canonical order", () => {
    expect(selectedAccessLinkSections(["math"])).toEqual(["math"]);
    expect(selectedAccessLinkSections(["math", "reading-writing"])).toEqual([
      "reading-writing",
      "math",
    ]);
  });

  it("stores all-sections as null and a narrowed selection as its canonical subset", () => {
    expect(accessLinkSectionRequest([...ACCESS_LINK_SECTION_KEYS])).toBeNull();
    expect(accessLinkSectionRequest(["reading-writing"])).toEqual(["reading-writing"]);
    expect(accessLinkSectionRequest([])).toEqual([]);
  });

  it("reports a change only when the scope actually differs", () => {
    // An untouched editor must never send a scope: an omitted field keeps the
    // stored one, so a full-scope edit of a link with participation stays legal.
    expect(accessLinkSectionsChanged(null, [...ACCESS_LINK_SECTION_KEYS])).toBe(false);
    expect(accessLinkSectionsChanged(["reading-writing", "math"], [...ACCESS_LINK_SECTION_KEYS])).toBe(false);
    expect(accessLinkSectionsChanged(["reading-writing"], ["reading-writing"])).toBe(false);
    expect(accessLinkSectionsChanged(null, ["reading-writing"])).toBe(true);
    expect(accessLinkSectionsChanged(["reading-writing"], [...ACCESS_LINK_SECTION_KEYS])).toBe(true);
  });

  it("badges only a narrowed link, and pays the word count for it", () => {
    expect(accessLinkSectionBadge(null)).toBeNull();
    expect(accessLinkSectionBadge([])).toBeNull();
    expect(accessLinkSectionBadge(["reading-writing", "math"])).toBeNull();
    expect(accessLinkSectionBadge(["reading-writing"])).toBe("Verbal only");
    expect(accessLinkSectionBadge(["math"])).toBe("Math only");
  });

  it("gives the student the scope and the ending, or nothing for a full link", () => {
    expect(accessLinkSectionStudentCopy(null)).toBeNull();
    expect(accessLinkSectionStudentCopy(["reading-writing", "math"])).toBeNull();
    expect(accessLinkSectionStudentCopy(["math"])).toBe(
      "You'll take Math only. The exam ends after that section.",
    );
  });
});
