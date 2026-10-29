import { Request, Response } from "express";
import { dynamoDbClient, USERS_TABLE } from "../db/dynamoDB";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import bcrypt from "bcryptjs";
import authSchema from "../dto/authSchema";
import jwt from "jsonwebtoken";
import logger from "../util/logger";

export const authService = async (req: Request, res: Response) => {
  try {
    const body = authSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: body.error.flatten().fieldErrors });
    }
    const { email, password } = body.data;

    // Fetch the user from DynamoDB based on the provided email
    const existingUser = await dynamoDbClient.send(
      new QueryCommand({
        TableName: USERS_TABLE,
        IndexName: "email-index",
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: {
          ":email": email,
        },
        Limit: 1,
      }),
    );
    if (!existingUser.Items || existingUser.Items.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const user = existingUser.Items[0];

    // Compare the provided password with the stored password hash
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // If authentication is successful, return the user data (excluding the password hash)
    const { passwordHash, ...userWithoutPassword } = user;
    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET || "default_secret", { expiresIn: "7d" });
    return res.status(200).json({ user: userWithoutPassword, token });
  } catch (error) {
    logger.error({ err: error }, "Authentication service failed");
    return res.status(500).json({ error: "Internal server error" });
  }
};
