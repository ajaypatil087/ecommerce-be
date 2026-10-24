import { z } from "zod";

const authSchema = z.object({
  email: z.email({ message: "Invalid email address" }),
  password: z.string().trim().min(3, { message: "Password must be at least 6 characters long" }),
});

export default authSchema;
