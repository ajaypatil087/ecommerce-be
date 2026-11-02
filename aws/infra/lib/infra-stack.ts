import * as cdk from "aws-cdk-lib/core";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as eventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
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

    if (process.env.DEPLOY_API_TO_ECS === "true") {
      const requiredEcsConfig = ["API_OPENSEARCH_ENDPOINT", "API_DOMAIN_NAME", "API_CERTIFICATE_ARN"] as const;
      const missingEcsConfig = requiredEcsConfig.filter((name) => !process.env[name]);
      if (missingEcsConfig.length > 0) {
        throw new Error(`DEPLOY_API_TO_ECS=true requires: ${missingEcsConfig.join(", ")}`);
      }

      const vpc = new ec2.Vpc(this, "ApiVpc", {
        maxAzs: 2,
        natGateways: 0,
        subnetConfiguration: [{ name: "Public", subnetType: ec2.SubnetType.PUBLIC }],
      });
      const cluster = new ecs.Cluster(this, "ApiCluster", { vpc });
      const apiLogGroup = new logs.LogGroup(this, "ApiLogGroup", {
        logGroupName: "/ecommerce/api",
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      });
      const jwtSecret = new secretsmanager.Secret(this, "ApiJwtSecret", {
        description: "JWT signing key used by the ecommerce Express API",
        generateSecretString: {
          secretStringTemplate: "{}",
          generateStringKey: "JWT_SECRET",
          passwordLength: 64,
          excludePunctuation: true,
        },
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      });

      const image = new ecrAssets.DockerImageAsset(this, "ApiImage", {
        directory: path.resolve(__dirname, "../../.."),
        file: "Dockerfile",
        platform: ecrAssets.Platform.LINUX_AMD64,
      });
      const certificate = acm.Certificate.fromCertificateArn(this, "ApiCertificate", process.env.API_CERTIFICATE_ARN!);
      const apiService = new ecsPatterns.ApplicationLoadBalancedFargateService(this, "ApiService", {
        cluster,
        serviceName: "ecommerce-api",
        publicLoadBalancer: true,
        assignPublicIp: true,
        desiredCount: 1,
        circuitBreaker: { rollback: true },
        minHealthyPercent: 100,
        cpu: 512,
        memoryLimitMiB: 1024,
        taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
        certificate,
        redirectHTTP: true,
        healthCheckGracePeriod: cdk.Duration.seconds(60),
        taskImageOptions: {
          image: ecs.ContainerImage.fromDockerImageAsset(image),
          containerPort: 8080,
          environment: {
            NODE_ENV: "production",
            LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
            USERS_TABLE: usersTable.tableName,
            PRODUCTS_TABLE: productsTable.tableName,
            CART_ORDERS_TABLE: cartOrderTable.tableName,
            AWS_REGION: cdk.Stack.of(this).region,
            OPENSEARCH_API_ENDPOINT: process.env.API_OPENSEARCH_ENDPOINT!,
            ...(process.env.OPENSEARCH_AWS_REGION ? { OPENSEARCH_AWS_REGION: process.env.OPENSEARCH_AWS_REGION } : {}),
          },
          secrets: { JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret, "JWT_SECRET") },
          logDriver: ecs.LogDrivers.awsLogs({
            logGroup: apiLogGroup,
            streamPrefix: "api",
          }),
        },
      });

      apiService.targetGroup.configureHealthCheck({
        path: "/health",
        healthyHttpCodes: "200",
      });

      usersTable.grantReadWriteData(apiService.taskDefinition.taskRole);
      productsTable.grantReadWriteData(apiService.taskDefinition.taskRole);
      cartOrderTable.grantReadWriteData(apiService.taskDefinition.taskRole);

      if (process.env.OPENSEARCH_AWS_REGION && process.env.OPENSEARCH_DOMAIN_ARN) {
        apiService.taskDefinition.taskRole.addToPrincipalPolicy(
          new iam.PolicyStatement({
            actions: ["es:ESHttpGet", "es:ESHttpHead", "es:ESHttpPost", "es:ESHttpPut", "es:ESHttpDelete"],
            resources: [`${process.env.OPENSEARCH_DOMAIN_ARN}/*`],
          }),
        );
      }

      new cdk.CfnOutput(this, "ApiUrl", { value: `https://${process.env.API_DOMAIN_NAME}` });
      new cdk.CfnOutput(this, "ApiLoadBalancerDnsName", {
        value: apiService.loadBalancer.loadBalancerDnsName,
      });
      new cdk.CfnOutput(this, "ApiLogGroupName", { value: apiLogGroup.logGroupName });
      new cdk.CfnOutput(this, "ApiJwtSecretArn", { value: jwtSecret.secretArn });
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
