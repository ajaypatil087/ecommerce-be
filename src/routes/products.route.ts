import { Router } from "express";
import {
  createProduct,
  deleteProduct,
  getProductById,
  getProducts,
  searchProducts,
  updateProduct,
} from "../services/product.service";

const productsRouter = Router();

productsRouter.get("/search", searchProducts);
productsRouter.patch("/:id", updateProduct);
productsRouter.get("/:id", getProductById);
productsRouter.get("/", getProducts);
productsRouter.post("/", createProduct);
productsRouter.delete("/:id", deleteProduct);

export default productsRouter;
