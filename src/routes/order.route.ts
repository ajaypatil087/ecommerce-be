import express from "express";
import { createOrder, getAllOrders, getOrderById, getOrdersByUserId, updateOrderStatus } from "../services";
import { authMiddleware } from "../middlewares/auth.middleware";
import { traceRoute } from "../middlewares/request-trace.middleware";

const orderRouter = express.Router();

orderRouter.post("/", [traceRoute("order.create"), authMiddleware], createOrder);
orderRouter.get("/", [traceRoute("order.get_by_user"), authMiddleware], getOrdersByUserId);
orderRouter.get("/all", [traceRoute("order.get_all"), authMiddleware], getAllOrders);
orderRouter.get("/:id", [traceRoute("order.get_by_id"), authMiddleware], getOrderById);
orderRouter.patch("/:id", [traceRoute("order.update_status"), authMiddleware], updateOrderStatus);

export default orderRouter;
