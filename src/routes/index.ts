import { Router } from "express";
import usersRouter from "./users.route";
import authRouter from "./auth.route";
import productsRouter from "./products.route";
import cartRouter from "./cart.route";
import orderRouter from "./order.route";
const rootRouter = Router();

rootRouter.use("/user", usersRouter);
rootRouter.use("/auth", authRouter);
rootRouter.use("/product", productsRouter);
rootRouter.use("/cart", cartRouter);
rootRouter.use("/order", orderRouter);

export default rootRouter;
