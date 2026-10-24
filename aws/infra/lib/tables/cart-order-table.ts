import * as cdk from "aws-cdk-lib/core";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import type { Construct } from "constructs";

export const createCartOrderTable = (scope: Construct): dynamodb.Table =>
  new dynamodb.Table(scope, "CartOrderTable", {
    tableName: process.env.CART_ORDER_TABLE || "cart-order",
    partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
    sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    removalPolicy: cdk.RemovalPolicy.DESTROY, // Suitable for local development only.
  });
