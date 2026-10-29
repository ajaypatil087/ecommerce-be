import express from "express";
import { authService } from "../services";
import { traceRoute } from "../middlewares/request-trace.middleware";

const authRouter = express.Router();

authRouter.post("/", traceRoute("auth.login"), authService);

export default authRouter;
