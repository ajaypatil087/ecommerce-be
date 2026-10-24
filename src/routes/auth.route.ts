import express from "express";
import { authService } from "../services/auth.service";

const authRouter = express.Router();

authRouter.post("/", authService);

export default authRouter;
