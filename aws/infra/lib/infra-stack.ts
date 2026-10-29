import * as cdk from "aws-cdk-lib/core";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as eventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as logs from "aws-cdk-lib/aws-logs";
import * as path from "node:path";
import { Construct } from "constructs";
import { createCartOrderTable } from "./tables/cart-order-table";
import { createProductsTable } from "./tables/products-table";
import { createUsersTable } from "./tables/users-table";

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const usersTable = createUsersTable(this);
    const productsTable = createProductsTable(this);
    const cartOrderTable = createCartOrderTable(this);

    const usersIndexerLogGroup = new logs.LogGroup(this, "UsersIndexerLogGroup", {
      logGroupName: "/ecommerce/index-users",
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const productsIndexerLogGroup = new logs.LogGroup(this, "ProductsIndexerLogGroup", {
      logGroupName: "/ecommerce/index-products",
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const indexUsersFunction = new lambdaNodejs.NodejsFunction(this, "IndexUsersFunction", {
      entry: path.join(__dirname, "../lambda/user-indexer.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logGroup: usersIndexerLogGroup,
      loggingFormat: lambda.LoggingFormat.JSON,
      applicationLogLevelV2: lambda.ApplicationLogLevel.INFO,
      systemLogLevelV2: lambda.SystemLogLevel.INFO,
      environment: {
        OPENSEARCH_ENDPOINT: process.env.OPENSEARCH_ENDPOINT ?? "http://opensearch:9200",
        OPENSEARCH_INDEX: "users",
        ...(process.env.OPENSEARCH_AWS_REGION ? { OPENSEARCH_AWS_REGION: process.env.OPENSEARCH_AWS_REGION } : {}),
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    indexUsersFunction.addEventSource(
      new eventSources.DynamoEventSource(usersTable, {
        startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        batchSize: 10,
        retryAttempts: 3,
        bisectBatchOnError: true,
        reportBatchItemFailures: true,
      }),
    );
    usersTable.grantStreamRead(indexUsersFunction);

    const indexProductsFunction = new lambdaNodejs.NodejsFunction(this, "IndexProductsFunction", {
      entry: path.join(__dirname, "../lambda/product-indexer.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logGroup: productsIndexerLogGroup,
      loggingFormat: lambda.LoggingFormat.JSON,
      applicationLogLevelV2: lambda.ApplicationLogLevel.INFO,
      systemLogLevelV2: lambda.SystemLogLevel.INFO,
      environment: {
        OPENSEARCH_ENDPOINT: process.env.OPENSEARCH_ENDPOINT ?? "http://opensearch:9200",
        OPENSEARCH_INDEX: "products",
        ...(process.env.OPENSEARCH_AWS_REGION ? { OPENSEARCH_AWS_REGION: process.env.OPENSEARCH_AWS_REGION } : {}),
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    indexProductsFunction.addEventSource(
      new eventSources.DynamoEventSource(productsTable, {
        startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        batchSize: 10,
        retryAttempts: 3,
        bisectBatchOnError: true,
        reportBatchItemFailures: true,
      }),
    );
    productsTable.grantStreamRead(indexProductsFunction);

    if (process.env.OPENSEARCH_AWS_REGION && process.env.OPENSEARCH_DOMAIN_ARN) {
      const openSearchWritePolicy = new iam.PolicyStatement({
        actions: ["es:ESHttpPut", "es:ESHttpPost", "es:ESHttpDelete"],
        resources: [`${process.env.OPENSEARCH_DOMAIN_ARN}/*`],
      });
      indexUsersFunction.addToRolePolicy(openSearchWritePolicy);
      indexProductsFunction.addToRolePolicy(openSearchWritePolicy);
    }

    new cdk.CfnOutput(this, "UsersTableName", { value: usersTable.tableName });
    new cdk.CfnOutput(this, "ProductsTableName", { value: productsTable.tableName });
    new cdk.CfnOutput(this, "CartOrderTableName", { value: cartOrderTable.tableName });
    if (usersTable.tableStreamArn) {
      new cdk.CfnOutput(this, "UsersTableStreamArn", { value: usersTable.tableStreamArn });
    }
    new cdk.CfnOutput(this, "IndexerLambdaName", { value: indexUsersFunction.functionName });
    new cdk.CfnOutput(this, "ProductIndexerLambdaName", { value: indexProductsFunction.functionName });
  }
}
