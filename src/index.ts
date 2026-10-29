import express, { type Request, type Response } from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import pinoHttp from "pino-http";
import logger from "./util/logger";
import { traceRoute } from "./middlewares/request-trace.middleware";
import rootRouter from "./routes";

const app = express();
const port = Number(process.env.PORT) || 8080;

app.use(
  pinoHttp({
    logger,
    genReqId: (_req, res) => {
      const traceId = randomUUID();
      res.setHeader("X-Trace-Id", traceId);
      return traceId;
    },
    customProps: (req) => ({ traceId: req.id }),
    serializers: {
      req: (req) => ({
        traceId: req.id,
        method: req.method,
        url: req.url?.split("?")[0],
        remoteAddress: req.remoteAddress,
      }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  }),
);
app.use((req, _res, next) => {
  req.log.info({ event: "request.received" }, "Request received");
  next();
});
app.use(cors());
app.use(express.json());
app.use("/api", rootRouter);

app.get("/health", traceRoute("health.check"), (req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.listen(port, () => {
  logger.info({ port }, "Express server listening");
});
