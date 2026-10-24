import "dotenv/config";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
  endpoint: process.env.AWS_ENDPOINT_URL || process.env.DYNAMODB_ENDPOINT,
});
export const dynamoDbClient = DynamoDBDocumentClient.from(client);
export const USERS_TABLE = process.env.USERS_TABLE;
export const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE;
export const CART_ORDERS_TABLE = process.env.CART_ORDERS_TABLE;
