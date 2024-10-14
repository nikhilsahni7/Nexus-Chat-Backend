import type { Request } from "express";

export interface User {
  id: number;
  username: string;
  email: string;
  profileImage: string | null;
  bio: string | null;
  presenceStatus: string;
  lastLoginAt: Date | null;
  lastLoginIP: string | null;
  totalLoginTime: number;
  loginCount: number;
  lastActiveAt: Date | null;
  createdAt: Date;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    profileImage: string;
    id: number;
    username: string;
  };
}
