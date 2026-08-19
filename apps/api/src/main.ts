import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { setupOpenApi } from "./config/openapi.js";
import { ProblemExceptionFilter } from "./filters/problem-exception.filter.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Every endpoint is versioned (ADR-010).
  app.setGlobalPrefix("api/v1");

  // Named origins only, never `*` (.cursor/rules/security.mdc).
  app.enableCors({
    origin: [process.env.WEB_URL ?? "http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: false,
    // The exports are downloaded by `fetch` from the web origin, and CORS hides every
    // non-simple response header from JavaScript by default. Without this the browser can
    // read the file but not the filename the API chose for it, so a download lands as a
    // raw UUID instead of `convorecall-<call>.md`.
    exposedHeaders: ["content-disposition"],
  });
  // Every error leaves as problem+json, including ones we did not anticipate.
  app.useGlobalFilters(new ProblemExceptionFilter());
  app.enableShutdownHooks();

  // Interactive reference at /api/v1/docs, generated from the running app.
  setupOpenApi(app);

  const port = Number(process.env.PORT ?? 3001);

  try {
    await app.listen(port);
  } catch (error) {
    // `bufferLogs` holds every log line until listen() succeeds. When it throws, the
    // buffer is discarded and the real reason never prints — the operator sees only
    // "Failed running", which is how a busy port looked like a mystery crash.
    app.flushLogs();
    throw describeListenFailure(error, port);
  }

  Logger.log(
    `ConvoRecall API listening on http://localhost:${port}/api/v1`,
    "Bootstrap",
  );
}

/** Turns the common startup faults into something actionable. */
function describeListenFailure(error: unknown, port: number): Error {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";

  if (code === "EADDRINUSE") {
    return new Error(
      `Port ${port} is already in use — another instance is still running.\n` +
        `  Find it:  lsof -nP -iTCP:${port} -sTCP:LISTEN\n` +
        `  Stop it:  lsof -tnP -iTCP:${port} -sTCP:LISTEN | xargs kill\n` +
        `  Or run this one elsewhere:  PORT=3002 pnpm dev`,
    );
  }
  if (code === "EACCES") {
    return new Error(`Port ${port} needs elevated privileges. Use a port above 1024.`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

bootstrap().catch((error: unknown) => {
  // Written straight to stderr rather than through the Nest logger: at this point the
  // logger may never have been flushed, which is exactly how the cause got lost.
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\nAPI failed to start.\n\n${message}\n\n`);
  if (error instanceof Error && error.stack && !/Port \d+ is already/.test(message)) {
    process.stderr.write(`${error.stack}\n\n`);
  }
  process.exit(1);
});
