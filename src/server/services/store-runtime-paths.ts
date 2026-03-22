import path from "node:path";

const SERVERLESS_DATA_DIR = "/tmp/visioro-data";

function isReadonlyServerlessRuntime(): boolean {
  return (
    process.env.VERCEL === "1" ||
    Boolean(process.env.LAMBDA_TASK_ROOT) ||
    process.cwd().startsWith("/var/task")
  );
}

export function resolveRuntimeDataDir(): string {
  const configuredDataDir = process.env.DATA_DIR?.trim();
  if (configuredDataDir) {
    return configuredDataDir;
  }

  if (isReadonlyServerlessRuntime()) {
    return SERVERLESS_DATA_DIR;
  }

  return path.join(process.cwd(), "data");
}
