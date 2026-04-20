import {
  classifyUserAccessError,
  isUserAccessSetupError,
  toUserAccessSetupError,
  USER_ACCESS_SETUP_PUBLIC_MESSAGE,
} from "@/lib/access/access-errors";

describe("access-errors", () => {
  it("classifies missing user_access table as setup error", () => {
    const setupError = {
      code: "42P01",
      message: 'relation "public.user_access" does not exist',
    };

    expect(isUserAccessSetupError(setupError)).toBe(true);

    const classified = classifyUserAccessError(
      setupError,
      "Fallback error message",
    );
    expect(classified.status).toBe(503);
    expect(classified.publicMessage).toBe(USER_ACCESS_SETUP_PUBLIC_MESSAGE);
  });

  it("keeps unknown errors as generic 500", () => {
    const unknownError = new Error("network timeout");
    const classified = classifyUserAccessError(
      unknownError,
      "Fallback error message",
    );

    expect(classified.status).toBe(500);
    expect(classified.publicMessage).toBe("Fallback error message");
  });

  it("does not wrap setup errors twice", () => {
    const original = {
      code: "42P01",
      message: 'relation "public.user_access" does not exist',
    };

    const wrapped = toUserAccessSetupError(original);
    const wrappedAgain = toUserAccessSetupError(wrapped);

    expect(wrappedAgain).toBe(wrapped);
  });
});
