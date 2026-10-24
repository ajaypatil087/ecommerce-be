import express from "express";
import { createOrder, getAllOrders, getOrderById, getOrdersByUserId, updateOrderStatus } from "../services/order.service";
import { authMiddleware } from "../middlewares/auth.middleware";

const orderRouter = express.Router();

orderRouter.post("/", [authMiddleware], createOrder);
orderRouter.get("/", [authMiddleware], getOrdersByUserId);
orderRouter.get("/all", [authMiddleware], getAllOrders);
orderRouter.get("/:id", [authMiddleware], getOrderById);
orderRouter.patch("/:id", [authMiddleware], updateOrderStatus);

export default orderRouter;
