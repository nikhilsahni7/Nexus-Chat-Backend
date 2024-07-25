import type { Request } from "express";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    username: string;
    email: string;
    profileImage: string;
  };
}
