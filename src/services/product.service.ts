import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Client } from "@opensearch-project/opensearch";
import { AwsSigv4Signer } from "@opensearch-project/opensearch/aws";
import { PRODUCTS_TABLE, dynamoDbClient } from "../db/dynamoDB";
import { PutCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import productSchema from "../dto/productSchema";

type ProductSearchCursor = { sort: Array<string | number | boolean> };

let productSearchClient: Client | undefined;

const getProductSearchClient = () => {
  if (productSearchClient) return productSearchClient;

  const endpoint = process.env.OPENSEARCH_API_ENDPOINT ?? process.env.OPENSEARCH_ENDPOINT;
  if (!endpoint) throw new Error("OPENSEARCH_ENDPOINT is not configured");

  productSearchClient = new Client({
    node: endpoint,
    ...(process.env.OPENSEARCH_AWS_REGION
      ? AwsSigv4Signer({
          region: process.env.OPENSEARCH_AWS_REGION,
          service: "es",
          getCredentials: async () => {
            const { defaultProvider } = await import("@aws-sdk/credential-provider-node");
            return defaultProvider()();
          },
        })
      : {}),
  });

  return productSearchClient;
};

const parseProductSearchCursor = (value: string): ProductSearchCursor | undefined => {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return undefined;
    const sort = (decoded as { sort?: unknown }).sort;
    if (
      !Array.isArray(sort) ||
      !sort.every((part) => typeof part === "string" || typeof part === "number" || typeof part === "boolean")
    )
      return undefined;
    return { sort };
  } catch {
    return undefined;
  }
};

export const searchProducts = async (req: Request, res: Response) => {
  const rawQuery = req.query.q;
  const rawCategory = req.query.category;
  const rawLimit = req.query.limit;
  const rawCursor = req.query.cursor;

  if (rawQuery !== undefined && typeof rawQuery !== "string") {
    return res.status(400).json({ error: "q must be a single string" });
  }
  if (rawCategory !== undefined && typeof rawCategory !== "string") {
    return res.status(400).json({ error: "category must be a single string" });
  }

  const limit = rawLimit === undefined ? 10 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({ error: "limit must be an integer between 1 and 100" });
  }
  if (rawCursor !== undefined && typeof rawCursor !== "string") {
    return res.status(400).json({ error: "cursor must be a single string" });
  }

  const cursor = rawCursor ? parseProductSearchCursor(rawCursor) : undefined;
  if (rawCursor && !cursor) {
    return res.status(400).json({ error: "Invalid search cursor" });
  }

  try {
    const client = getProductSearchClient();
    const index = process.env.OPENSEARCH_PRODUCTS_INDEX ?? "products";
    const exists = await client.indices.exists({ index });
    if (!exists.body) {
      try {
        await client.indices.create({
          index,
          body: {
            mappings: {
              properties: {
                id: { type: "text", fields: { keyword: { type: "keyword" } } },
                category: { type: "keyword" },
              },
            },
          },
        });
      } catch (error) {
        const existsAfterCreate = await client.indices.exists({ index });
        if (!existsAfterCreate.body) throw error;
      }
    }

    const filters = rawCategory?.trim() ? [{ term: { category: rawCategory.trim() } }] : [];
    const searchResponse = await client.search({
      index,
      body: {
        size: limit + 1,
        ...(cursor ? { search_after: cursor.sort } : {}),
        sort: [{ "id.keyword": { order: "asc" } }],
        track_total_hits: true,
        query: {
          bool: {
            ...(filters.length ? { filter: filters } : {}),
            must: rawQuery?.trim()
              ? [
                  {
                    multi_match: {
                      query: rawQuery.trim(),
                      fields: ["name^3", "description", "category", "tags"],
                      type: "best_fields",
                      operator: "and",
                    },
                  },
                ]
              : [{ match_all: {} }],
          },
        },
      },
    });

    const hits = searchResponse.body.hits.hits;
    const pageHits = hits.slice(0, limit);
    const hasMore = hits.length > limit;
    const lastHit = pageHits.at(-1);
    const nextCursor =
      hasMore && lastHit?.sort ? Buffer.from(JSON.stringify({ sort: lastHit.sort })).toString("base64url") : null;
    const total = searchResponse.body.hits.total;

    return res.status(200).json({
      products: pageHits.map((hit) => hit._source),
      pagination: {
        limit,
        total: typeof total === "number" ? total : (total?.value ?? 0),
        nextCursor,
        hasMore,
      },
    });
  } catch (error) {
    console.error("OpenSearch product search failed:", error);
    return res.status(502).json({ error: "Product search service is unavailable" });
  }
};

export const createProduct = async (req: Request, res: Response) => {
  const parsedBody = productSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: parsedBody.error.message });
  }

  if (!PRODUCTS_TABLE) {
    console.error("PRODUCTS_TABLE is not configured");
    return res.status(500).json({ error: "Product storage is not configured" });
  }

  const { name, brand, description, price, category, stock, tags, status } = parsedBody.data;

  try {
    const existingProducts = await dynamoDbClient.send(
      new QueryCommand({
        TableName: PRODUCTS_TABLE,
        IndexName: "name-category-index",
        KeyConditionExpression: "#name = :name AND category = :category",
        ExpressionAttributeNames: { "#name": "name" },
        ExpressionAttributeValues: {
          ":name": name,
          ":category": category,
        },
        Limit: 1,
      }),
    );

    if (existingProducts.Items?.length) {
      return res.status(409).json({ error: "A product with this name and category already exists" });
    }

    const product = {
      id: `product_${randomUUID()}`,
      name,
      brand,
      description,
      price,
      category,
      stock,
      tags,
      status: status ?? "active",
      createdAt: new Date().toISOString(),
    };

    await dynamoDbClient.send(
      new PutCommand({
        TableName: PRODUCTS_TABLE,
        Item: product,
        ConditionExpression: "attribute_not_exists(id)",
      }),
    );

    return res.status(201).json(product);
  } catch (error) {
    console.error("Failed to create product:", error);
    return res.status(500).json({ error: "Failed to create product" });
  }
};

export const getProducts = async (req: Request, res: Response) => {
  if (!PRODUCTS_TABLE) {
    console.error("PRODUCTS_TABLE is not configured");
    return res.status(500).json({ error: "Product storage is not configured" });
  }

  try {
    const products: Record<string, unknown>[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const result = await dynamoDbClient.send(
        new ScanCommand({
          TableName: PRODUCTS_TABLE,
          ExclusiveStartKey: lastEvaluatedKey,
        }),
      );

      products.push(...((result.Items ?? []) as Record<string, unknown>[]));
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
    console.log(`Retrieved ${products.length} products from DynamoDB`);
    return res.status(200).json({ products, count: products.length });
  } catch (error) {
    console.error("Failed to retrieve products:", error);
    return res.status(500).json({ error: "Failed to retrieve products" });
  }
};

export const getProductById = async (req: Request, res: Response) => {
  if (!PRODUCTS_TABLE) {
    console.error("PRODUCTS_TABLE is not configured");
    return res.status(500).json({ error: "Product storage is not configured" });
  }

  const { id } = req.params;

  try {
    const result = await dynamoDbClient.send(
      new QueryCommand({
        TableName: PRODUCTS_TABLE,
        KeyConditionExpression: "id = :id",
        ExpressionAttributeValues: {
          ":id": id,
        },
      }),
    );

    if (!result.Items || result.Items.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    console.log("Retrieved product by ID:", result.Items[0]);

    return res.status(200).json(result.Items[0]);
  } catch (error) {
    console.error("Failed to retrieve product by ID:", error);
    return res.status(500).json({ error: "Failed to retrieve product" });
  }
};

export const updateProduct = async (req: Request, res: Response) => {
  if (!PRODUCTS_TABLE) {
    console.error("PRODUCTS_TABLE is not configured");
    return res.status(500).json({ error: "Product storage is not configured" });
  }

  const { id } = req.params;
  const parsedBody = productSchema.partial().safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: parsedBody.error.message });
  }

  try {
    const existingProduct = await dynamoDbClient.send(
      new QueryCommand({
        TableName: PRODUCTS_TABLE,
        KeyConditionExpression: "id = :id",
        ExpressionAttributeValues: {
          ":id": id,
        },
      }),
    );

    if (!existingProduct.Items || existingProduct.Items.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    const updatedProduct = { ...existingProduct.Items[0], ...parsedBody.data };

    await dynamoDbClient.send(
      new PutCommand({
        TableName: PRODUCTS_TABLE,
        Item: updatedProduct,
        ConditionExpression: "attribute_exists(id)",
      }),
    );

    return res.status(200).json(updatedProduct);
  } catch (error) {
    console.error("Failed to update product:", error);
    return res.status(500).json({ error: "Failed to update product" });
  }
};

export const deleteProduct = async (req: Request, res: Response) => {
  if (!PRODUCTS_TABLE) {
    console.error("PRODUCTS_TABLE is not configured");
    return res.status(500).json({ error: "Product storage is not configured" });
  }

  const { id } = req.params;

  try {
    const existingProduct = await dynamoDbClient.send(
      new QueryCommand({
        TableName: PRODUCTS_TABLE,
        KeyConditionExpression: "id = :id",
        ExpressionAttributeValues: {
          ":id": id,
        },
      }),
    );

    if (!existingProduct.Items || existingProduct.Items.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    await dynamoDbClient.send(
      new PutCommand({
        TableName: PRODUCTS_TABLE,
        Item: { ...existingProduct.Items[0], status: "deleted" },
        ConditionExpression: "attribute_exists(id)",
      }),
    );

    return res.status(200).json({ message: "Product deleted successfully" });
  } catch (error) {
    console.error("Failed to delete product:", error);
    return res.status(500).json({ error: "Failed to delete product" });
  }
};
