import express from "express";
import { authService } from "../services";

const authRouter = express.Router();

authRouter.post("/", authService);

export default authRouter;
