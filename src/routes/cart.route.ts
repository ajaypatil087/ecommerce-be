import express from "express";
import { createCart, deleteCart, getAllCarts, getCartByUserId, updateCart } from "../services/cart.service";
import { authMiddleware } from "../middlewares/auth.middleware";

const cartRouter = express.Router();

cartRouter.post("/", [authMiddleware], createCart);
cartRouter.get("/", [authMiddleware], getCartByUserId);
cartRouter.get("/all", [authMiddleware], getAllCarts);
cartRouter.patch("/", [authMiddleware], updateCart);
cartRouter.delete("/", [authMiddleware], deleteCart);

export default cartRouter;
