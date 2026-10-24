import express from "express";
import { createUser, getUserById, getUsers, searchUsers } from "../services/users.service";
const userRoute = express.Router();

userRoute.get("/search", searchUsers);
userRoute.get("/:id", getUserById);
userRoute.get("/", getUsers);
userRoute.post("/", createUser);

export default userRoute;
