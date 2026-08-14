import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import { AppModule } from "./app.module.js";
import { PrismaService } from "./database/prisma.service.js";
import { CallsController } from "./modules/calls/calls.controller.js";
import { CallsRepository } from "./modules/calls/calls.repository.js";
import { CallsService } from "./modules/calls/calls.service.js";
import { StorageService } from "./modules/calls/storage.service.js";

/**
 * Wiring test. Unit tests construct these classes by hand and therefore prove nothing
 * about dependency injection — a missing constructor type left the app unable to boot
 * while every unit test stayed green. `compile()` instantiates the graph without
 * running lifecycle hooks, so no database connection is needed.
 */
describe("AppModule dependency graph", () => {
  it("resolves every provider with its dependencies injected", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // PrismaService is the one provider that would open a socket on init.
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    const storage = moduleRef.get(StorageService);
    const service = moduleRef.get(CallsService);
    const repository = moduleRef.get(CallsRepository);
    const controller = moduleRef.get(CallsController);

    expect(storage).toBeInstanceOf(StorageService);
    expect(service).toBeInstanceOf(CallsService);
    expect(repository).toBeInstanceOf(CallsRepository);
    expect(controller).toBeInstanceOf(CallsController);

    // The failure mode this test exists for: a constructor parameter arriving undefined.
    expect(moduleRef.get(ConfigService)).toBeDefined();
    expect(storage.pathFor("11111111-1111-4111-8111-111111111111.mp3")).toContain(
      "11111111-1111-4111-8111-111111111111.mp3",
    );

    await moduleRef.close();
  });
});
