import { Router } from "express";
import { createProduct, deleteProduct, getProductById, getProducts, searchProducts, updateProduct } from "../services";
import { traceRoute } from "../middlewares/request-trace.middleware";
import { authMiddleware } from "../middlewares/auth.middleware";

const productsRouter = Router();

productsRouter.get("/search", [traceRoute("product.search"), authMiddleware], searchProducts);
productsRouter.patch("/:id", [traceRoute("product.update"), authMiddleware], updateProduct);
productsRouter.get("/:id", [traceRoute("product.get_by_id"), authMiddleware], getProductById);
productsRouter.get("/", [traceRoute("product.list"), authMiddleware], getProducts);
productsRouter.post("/", [traceRoute("product.create"), authMiddleware], createProduct);
productsRouter.delete("/:id", [traceRoute("product.delete"), authMiddleware], deleteProduct);

export default productsRouter;
