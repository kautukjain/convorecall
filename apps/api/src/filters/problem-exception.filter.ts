import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";
import { ProblemException, type ProblemBody } from "../common/problem.js";

/**
 * Every error leaves as problem+json. Nothing internal escapes: stack traces, SQL,
 * filesystem paths, and provider errors are logged and dropped, never serialized
 * (docs/API.md).
 */
@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ProblemException) {
      if (exception.operatorDetail) {
        this.logger.warn(`${exception.code}: ${exception.operatorDetail}`);
      }
      this.send(response, exception.toBody());
      return;
    }

    // Multer enforces the byte ceiling before we ever see the body.
    if (
      exception instanceof Error &&
      "code" in exception &&
      exception.code === "LIMIT_FILE_SIZE"
    ) {
      const problem = new ProblemException(
        "upload_too_large",
        "File exceeds the configured upload limit.",
      );
      this.send(response, problem.toBody());
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();

      // The throttler guard raises a bare 429; docs/API.md promises `rate_limited`
      // with a Retry-After, so translate rather than letting it leak as a generic error.
      if (status === 429) {
        response.setHeader("retry-after", "60");
        this.send(
          response,
          new ProblemException(
            "rate_limited",
            "Too many requests. Try again shortly.",
          ).toBody(),
        );
        return;
      }

      const code = status === 404 ? "call_not_found" : "invalid_request";
      const problem = new ProblemException(code, exception.message);
      this.send(response, { ...problem.toBody(), status });
      return;
    }

    this.logger.error(
      exception instanceof Error ? exception.message : String(exception),
      exception instanceof Error ? exception.stack : undefined,
    );
    this.send(
      response,
      new ProblemException(
        "internal_error",
        "Something went wrong. The failure has been logged.",
      ).toBody(),
    );
  }

  private send(response: Response, body: ProblemBody): void {
    response
      .status(body.status)
      .type("application/problem+json")
      .json(body);
  }
}
