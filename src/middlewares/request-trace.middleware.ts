import type { RequestHandler } from "express";

export const traceRoute = (operation: string): RequestHandler => (req, res, next) => {
  const startedAt = Date.now();

  req.log.info({ event: "step.started", operation }, "Request step started");
  res.once("finish", () => {
    req.log.info(
      {
        event: "step.completed",
        operation,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      },
      "Request step completed",
    );
  });

  next();
};