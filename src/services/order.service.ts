import { Request, Response } from "express";
import { getAuthenticatedUserId } from "../util/common";
import { dynamoDbClient, CART_ORDERS_TABLE } from "../db/dynamoDB";
import { GetCommand, PutCommand, ScanCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import orderSchema from "../dto/orderSchema";
import { CartValidationError, resolveCartProducts } from "./cart.service";

export const createOrder = async (req: Request, res: Response) => {
  const userId = getAuthenticatedUserId(req);
  const order = orderSchema.safeParse(req.body);
  if (!order.success) {
    return res.status(400).json({ error: order.error.flatten().fieldErrors });
  }
  if (!userId) {
    return res.status(401).json({ error: "User not authenticated" });
  }

  if (!CART_ORDERS_TABLE) {
    return res.status(500).json({ error: "Cart storage is not configured" });
  }

  try {
    const cart = await dynamoDbClient.send(
      new GetCommand({
        TableName: CART_ORDERS_TABLE,
        Key: { PK: `USER#${userId}`, SK: "CART#ACTIVE" },
      }),
    );

    if (!cart.Item) {
      return res.status(404).json({ error: "No active cart found for the user" });
    }

    const pricedProducts = await resolveCartProducts(cart.Item.products ?? []);
    const totalAmount = pricedProducts.reduce((sum, product) => sum + product.quantity * product.price, 0);

    const orderId = `ORDER#${new Date().toISOString()}#${userId}`;
    const orderData = {
      PK: `USER#${userId}`,
      SK: orderId,
      entityType: "ORDER",
      id: orderId,
      userId,
      address: order.data.address,
      products: pricedProducts,
      totalAmount,
      status: "PENDING",
      paymentStatus: "UNPAID",
      paymentMethod: order.data.paymentMethod,
      createdAt: new Date().toISOString(),
    };
    await dynamoDbClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: CART_ORDERS_TABLE,
              Item: orderData,
              ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
            },
          },
          {
            Delete: {
              TableName: CART_ORDERS_TABLE,
              Key: { PK: `USER#${userId}`, SK: "CART#ACTIVE" },
              ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
            },
          },
        ],
      }),
    );
    return res.status(201).json({ order: orderData });
  } catch (error) {
    if (error instanceof CartValidationError) {
      return res.status(error.statusCode).json({ error: error.message, ...error.details });
    }
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
      return res.status(409).json({ error: "An order with this ID already exists" });
    }
    console.error("Error creating order:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getOrdersByUserId = async (req: Request, res: Response) => {
  const userId = getAuthenticatedUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "User not authenticated" });
  }
  if (!CART_ORDERS_TABLE) {
    return res.status(500).json({ error: "Order storage is not configured" });
  }

  try {
    const orders = await dynamoDbClient.send(
      new GetCommand({
        TableName: CART_ORDERS_TABLE,
        Key: { PK: `USER#${userId}`, SK: "ORDER#*" },
      }),
    );

    if (!orders.Item) {
      return res.status(404).json({ error: "No orders found for this user" });
    }

    return res.status(200).json(orders.Item);
  } catch (error) {
    console.error("Error retrieving orders:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getOrderById = async (req: Request, res: Response) => {
  const userId = getAuthenticatedUserId(req);
  const { orderId } = req.params;
  if (!userId) {
    return res.status(401).json({ error: "User not authenticated" });
  }
  if (!CART_ORDERS_TABLE) {
    return res.status(500).json({ error: "Order storage is not configured" });
  }

  try {
    const order = await dynamoDbClient.send(
      new GetCommand({
        TableName: CART_ORDERS_TABLE,
        Key: { PK: `USER#${userId}`, SK: orderId },
      }),
    );

    if (!order.Item) {
      return res.status(404).json({ error: "Order not found for this user" });
    }

    return res.status(200).json(order.Item);
  } catch (error) {
    console.error("Error retrieving order:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const updateOrderStatus = async (req: Request, res: Response) => {
  const userId = getAuthenticatedUserId(req);
  const { orderId } = req.params;
  const { status } = req.body;

  if (!userId) {
    return res.status(401).json({ error: "User not authenticated" });
  }
  if (!CART_ORDERS_TABLE) {
    return res.status(500).json({ error: "Order storage is not configured" });
  }

  try {
    const order = await dynamoDbClient.send(
      new GetCommand({
        TableName: CART_ORDERS_TABLE,
        Key: { PK: `USER#${userId}`, SK: orderId },
      }),
    );

    if (!order.Item) {
      return res.status(404).json({ error: "Order not found for this user" });
    }

    await dynamoDbClient.send(
      new PutCommand({
        TableName: CART_ORDERS_TABLE,
        Item: {
          ...order.Item,
          status,
          updatedAt: new Date().toISOString(),
        },
        ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
      }),
    );

    return res.status(200).json({ message: "Order status updated successfully" });
  } catch (error) {
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
      return res.status(404).json({ error: "Order not found for this user" });
    }
    console.error("Error updating order status:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getAllOrders = async (_req: Request, res: Response) => {
  if (!CART_ORDERS_TABLE) {
    return res.status(500).json({ error: "Order storage is not configured" });
  }

  try {
    const orders: Record<string, unknown>[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const result = await dynamoDbClient.send(
        new ScanCommand({
          TableName: CART_ORDERS_TABLE,
          FilterExpression: "entityType = :entityType",
          ExpressionAttributeValues: { ":entityType": "ORDER" },
          ExclusiveStartKey: lastEvaluatedKey,
        }),
      );

      orders.push(...((result.Items ?? []) as Record<string, unknown>[]));
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    if (orders.length === 0) {
      return res.status(404).json({ error: "No orders found" });
    }

    return res.status(200).json(orders);
  } catch (error) {
    console.error("Error retrieving all orders:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};
