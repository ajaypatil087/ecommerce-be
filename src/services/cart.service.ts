import type { Request, Response } from "express";
import cartSchema from "../dto/cartSchema";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { PRODUCTS_TABLE, CART_ORDERS_TABLE, dynamoDbClient } from "../db/dynamoDB";
import { getAuthenticatedUserId } from "../util/common";

export class CartValidationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly details: Record<string, string | number> = {},
  ) {
    super(message);
  }
}

export const resolveCartProducts = async (products: Array<{ productId: string; quantity: number }>) => {
  if (!PRODUCTS_TABLE) {
    throw new CartValidationError("Product storage is not configured", 500);
  }

  // Aggregate duplicate product lines so splitting a requested quantity across
  // multiple entries cannot bypass the stock check.
  const quantitiesByProduct = new Map<string, number>();
  for (const product of products) {
    quantitiesByProduct.set(product.productId, (quantitiesByProduct.get(product.productId) ?? 0) + product.quantity);
  }

  const catalogById = new Map<string, { price: number }>();

  await Promise.all(
    [...quantitiesByProduct].map(async ([productId, requestedQuantity]) => {
      const productResult = await dynamoDbClient.send(
        new QueryCommand({
          TableName: PRODUCTS_TABLE,
          KeyConditionExpression: "id = :id",
          ExpressionAttributeValues: { ":id": productId },
        }),
      );
      const storedProduct = productResult.Items?.[0];

      if (!storedProduct) {
        throw new CartValidationError(`Product with ID ${productId} does not exist`, 404);
      }

      if (typeof storedProduct.stock !== "number") {
        throw new CartValidationError(`Stock is not configured for product ${productId}`, 409);
      }

      if (typeof storedProduct.price !== "number" || !Number.isFinite(storedProduct.price)) {
        throw new CartValidationError(`Price is not configured for product ${productId}`, 409);
      }

      if (storedProduct.stock <= 0) {
        throw new CartValidationError(`Product ${productId} is out of stock`, 409, {
          code: "OUT_OF_STOCK",
          productId,
          availableStock: 0,
        });
      }

      if (requestedQuantity > storedProduct.stock) {
        throw new CartValidationError(
          `Requested quantity (${requestedQuantity}) exceeds available stock (${storedProduct.stock}) for product ${productId}`,
          409,
          {
            code: "INSUFFICIENT_STOCK",
            productId,
            requestedQuantity,
            availableStock: storedProduct.stock,
          },
        );
      }

      catalogById.set(productId, { price: storedProduct.price });
    }),
  );

  return products.map((product) => ({
    productId: product.productId,
    quantity: product.quantity,
    price: catalogById.get(product.productId)!.price,
  }));
};

export const validateProductQuantities = async (products: Array<{ productId: string; quantity: number }>) => {
  await resolveCartProducts(products);
  return products;
};

const sendCartError = (res: Response, error: unknown) => {
  if (error instanceof CartValidationError) {
    return res.status(error.statusCode).json({ error: error.message, ...error.details });
  }

  console.error("Cart operation failed:", error);
  return res.status(500).json({ error: "Internal server error" });
};

const findUserCart = async (userId: string) => {
  if (!CART_ORDERS_TABLE) return undefined;

  const activeCart = await dynamoDbClient.send(
    new GetCommand({
      TableName: CART_ORDERS_TABLE,
      Key: { PK: `USER#${userId}`, SK: "CART#ACTIVE" },
    }),
  );
  if (activeCart.Item) return activeCart.Item;

  // Compatibility for carts written before the app switched to CART#ACTIVE.
  const legacyCarts = await dynamoDbClient.send(
    new QueryCommand({
      TableName: CART_ORDERS_TABLE,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :cartPrefix)",
      ExpressionAttributeValues: {
        ":pk": `USER#${userId}`,
        ":cartPrefix": "CART#",
      },
      Limit: 1,
      ScanIndexForward: false,
    }),
  );

  return legacyCarts.Items?.[0];
};

export const createCart = async (req: Request, res: Response) => {
  const parsedBody = cartSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: parsedBody.error.message });
  }
  const { products } = parsedBody.data;
  const userId = getAuthenticatedUserId(req);

  if (!userId) {
    return res.status(401).json({ error: "User not authenticated" });
  }

  if (!CART_ORDERS_TABLE) {
    return res.status(500).json({ error: "Cart storage is not configured" });
  }

  try {
    const validateProducts = await validateProductQuantities(products);

    if (await findUserCart(userId)) {
      return res.status(409).json({ error: "An active cart already exists; use PATCH /cart to update it" });
    }

    const cartId = "ACTIVE";
    const cartData = {
      PK: `USER#${userId}`,
      SK: "CART#ACTIVE",
      entityType: "CART",
      id: cartId,
      userId,
      products: validateProducts,
      createdAt: new Date().toISOString(),
    };

    await dynamoDbClient.send(
      new PutCommand({
        TableName: CART_ORDERS_TABLE,
        Item: cartData,
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      }),
    );

    return res.status(201).json({ cart: cartData });
  } catch (error) {
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
      return res.status(409).json({ error: "An active cart already exists; use PATCH /cart to update it" });
    }
    return sendCartError(res, error);
  }
};

export const getCartByUserId = async (req: Request, res: Response) => {
  const userId = getAuthenticatedUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "User not authenticated" });
  }
  if (!CART_ORDERS_TABLE) {
    return res.status(500).json({ error: "Cart storage is not configured" });
  }

  try {
    const cart = await findUserCart(userId);

    if (!cart) {
      return res.status(404).json({ error: "Cart not found for this user" });
    }

    return res.status(200).json(cart);
  } catch (error) {
    console.error("Error retrieving cart:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getAllCarts = async (_req: Request, res: Response) => {
  if (!CART_ORDERS_TABLE) {
    return res.status(500).json({ error: "Cart storage is not configured" });
  }

  try {
    const result = await dynamoDbClient.send(
      new ScanCommand({
        TableName: CART_ORDERS_TABLE,
        FilterExpression: "entityType = :entityType",
        ExpressionAttributeValues: { ":entityType": "CART" },
      }),
    );

    if (!result.Items || result.Items.length === 0) {
      return res.status(404).json({ error: "No carts found" });
    }

    return res.status(200).json(result.Items);
  } catch (error) {
    console.error("Error retrieving all carts:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const updateCart = async (req: Request, res: Response) => {
  const parsedBody = cartSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: parsedBody.error.flatten().fieldErrors });
  }
  const { products } = parsedBody.data;
  const userId = getAuthenticatedUserId(req);

  if (!userId) {
    return res.status(401).json({ error: "User not authenticated" });
  }

  if (!CART_ORDERS_TABLE) {
    return res.status(500).json({ error: "Cart storage is not configured" });
  }

  try {
    const validateProducts = await validateProductQuantities(products);

    const existingCart = await findUserCart(userId);

    if (!existingCart) {
      return res.status(404).json({ error: "Cart not found" });
    }

    const cartData = {
      ...existingCart,
      PK: existingCart.PK ?? `USER#${userId}`,
      SK: existingCart.SK ?? "CART#ACTIVE",
      entityType: "CART",
      id: existingCart.id ?? "ACTIVE",
      userId,
      products: validateProducts,
      updatedAt: new Date().toISOString(),
    };

    await dynamoDbClient.send(
      new PutCommand({
        TableName: CART_ORDERS_TABLE,
        Item: cartData,
        ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
      }),
    );

    return res.status(200).json({ cart: cartData });
  } catch (error) {
    return sendCartError(res, error);
  }
};

export const deleteCart = async (req: Request, res: Response) => {
  const userId = getAuthenticatedUserId(req);

  if (!userId) {
    return res.status(401).json({ error: "User not authenticated" });
  }

  if (!CART_ORDERS_TABLE) {
    return res.status(500).json({ error: "Cart storage is not configured" });
  }

  try {
    const existingCart = await findUserCart(userId);
    if (!existingCart) {
      return res.status(404).json({ error: "Cart not found for this user" });
    }

    await dynamoDbClient.send(
      new DeleteCommand({
        TableName: CART_ORDERS_TABLE,
        Key: {
          PK: existingCart.PK ?? `USER#${userId}`,
          SK: existingCart.SK ?? "CART#ACTIVE",
        },
        ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
      }),
    );

    return res.status(200).json({ message: "Deleted cart" });
  } catch (error) {
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
      return res.status(404).json({ error: "Cart not found for this user" });
    }
    return sendCartError(res, error);
  }
};
