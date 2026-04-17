import { describe, expect, test } from "vitest";

import {
  NavigationMenuContent,
  NavigationMenuLink,
  navigationMenuTriggerStyle,
} from "../navigation-menu";

describe("navigation-menu styling contracts", () => {
  test("uses Base UI trigger selectors for popup state", () => {
    const className = navigationMenuTriggerStyle();

    expect(className).toContain("data-popup-open:bg-muted/50");
    expect(className).not.toContain("data-open:bg-muted/50");
  });

  test("uses Base UI content motion selectors instead of Radix motion attributes", () => {
    const element = NavigationMenuContent({});
    const className = element.props.className;

    expect(className).toContain("data-starting-style:data-[activation-direction=left]:translate-x-[-50%]");
    expect(className).toContain("data-ending-style:data-[activation-direction=right]:translate-x-[-50%]");
    expect(className).not.toContain("data-[motion=");
  });

  test("styles active links using the Base UI presence attribute", () => {
    const element = NavigationMenuLink({});
    const className = element.props.className;

    expect(className).toContain("data-active:bg-muted/50");
    expect(className).not.toContain("data-[active=true]");
  });
});
