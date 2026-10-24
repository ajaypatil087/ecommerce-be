import { z } from "zod";

const userSchema = z.object({
  firstName: z.string().trim().min(1, { message: "First name is required" }),
  lastName: z.string().trim().min(1, { message: "Last name is required" }),
  email: z.email({ message: "Invalid email address" }),
  password: z.string().trim().min(3, { message: "Password must be at least 6 characters long" }),
  phoneNumber: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{7,15}$/, "Invalid phone number"),
  username: z.string().trim().min(3).max(30),
  zipcode: z.string().trim().min(3).max(10),
});

export default userSchema;
