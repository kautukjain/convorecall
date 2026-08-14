import { Controller, Get, Headers, Param, Sse } from "@nestjs/common";
import { Observable, interval } from "rxjs";
import { ProblemException } from "../../common/problem.js";
import { CallIdParamSchema } from "../calls/dto/create-call.dto.js";
import { JobEventsService } from "./job-events.service.js";

type SseMessage = { id?: string; type?: string; data: string };

const TERMINAL_TYPES = new Set(["terminal", "error"]);

@Controller("calls")
export class EventsController {
  constructor(private readonly events: JobEventsService) {}

  /**
   * Server-Sent Events for one call (docs/Jobs.md).
   *
   * Events are replayed from the persisted log, so a client reconnecting with
   * `Last-Event-ID` loses nothing, and one connecting after the job finished is sent
   * the terminal event immediately rather than hanging.
   */
  @Sse(":id/events")
  @Get(":id/events")
  async stream(
    @Param("id") id: string,
    @Headers("last-event-id") lastEventId?: string,
  ): Promise<Observable<SseMessage>> {
    const parsed = CallIdParamSchema.safeParse(id);
    if (!parsed.success) {
      throw new ProblemException("call_not_found", "No call with that id.");
    }

    const jobId = await this.events.findJobIdForCall(parsed.data);
    if (!jobId) {
      throw new ProblemException("call_not_found", "No call with that id.");
    }

    let cursor = this.parseCursor(lastEventId);

    return new Observable<SseMessage>((subscriber) => {
      let closed = false;

      const pump = async (): Promise<void> => {
        if (closed) return;
        try {
          const batch = await this.events.since(jobId, cursor);
          for (const event of batch) {
            cursor = BigInt(event.id);
            subscriber.next({
              id: event.id,
              type: event.type,
              data: JSON.stringify(event.data),
            });
            if (TERMINAL_TYPES.has(event.type)) {
              closed = true;
              subscriber.complete();
              return;
            }
          }
        } catch (error) {
          subscriber.error(error);
        }
      };

      void pump();
      const subscription = interval(1_000).subscribe(() => void pump());

      return () => {
        closed = true;
        subscription.unsubscribe();
      };
    });
  }

  private parseCursor(raw: string | undefined): bigint {
    if (!raw) return 0n;
    try {
      const value = BigInt(raw);
      return value >= 0n ? value : 0n;
    } catch {
      return 0n;
    }
  }
}
