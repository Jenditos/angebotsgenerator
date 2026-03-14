declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: {
  <T = unknown>(actual: T): {
    toBe: (expected: unknown) => void;
    toEqual: (expected: unknown) => void;
  };
};
