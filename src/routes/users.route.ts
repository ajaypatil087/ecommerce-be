import express from "express";
import { createUser, getUserById, getUsers, mySelf, searchUsers } from "../services";
import { traceRoute } from "../middlewares/request-trace.middleware";
import { authMiddleware } from "../middlewares/auth.middleware";
const userRoute = express.Router();

userRoute.get("/search", [traceRoute("user.search"), authMiddleware], searchUsers);
userRoute.get("/:id", [traceRoute("user.get_by_id"), authMiddleware], getUserById);
userRoute.get("/myself", [traceRoute("user.self"), authMiddleware], mySelf);
userRoute.get("/", [traceRoute("user.list"), authMiddleware], getUsers);
userRoute.post("/", traceRoute("user.create"), createUser);

export default userRoute;
