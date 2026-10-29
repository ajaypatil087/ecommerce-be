import express from "express";
import { createCart, deleteCart, getAllCarts, getCartByUserId, updateCart } from "../services";
import { authMiddleware } from "../middlewares/auth.middleware";
import { traceRoute } from "../middlewares/request-trace.middleware";

const cartRouter = express.Router();

cartRouter.post("/", [traceRoute("cart.create"), authMiddleware], createCart);
cartRouter.get("/", [traceRoute("cart.get_current"), authMiddleware], getCartByUserId);
cartRouter.get("/all", [traceRoute("cart.get_all"), authMiddleware], getAllCarts);
cartRouter.patch("/", [traceRoute("cart.update"), authMiddleware], updateCart);
cartRouter.delete("/", [traceRoute("cart.delete"), authMiddleware], deleteCart);

export default cartRouter;
