import type { NextFunction, Request, Response } from "express";
import type { ApiResponse } from "@write-now/shared/types/api";
import { SITE_AUTH_UNAUTHENTICATED, SITE_AUTH_UNCONFIGURED } from "@write-now/shared/types/api";
import { resolveSiteAuthConfig } from "../platform/auth/siteAuthConfig";
import { isSiteAuthPublicPath } from "../platform/auth/siteAuthPaths";
import { readValidSessionToken, SITE_AUTH_OPERATOR_ID } from "../platform/auth/siteAuthSession";

function sendGateResponse(
  res: Response,
  statusCode: number,
  error: string,
  code: string,
): void {
  const response: ApiResponse<null> = {
    success: false,
    error,
    message: code,
  };
  res.status(statusCode).json(response);
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const originalUrl = req.originalUrl || req.url || "";
  if (isSiteAuthPublicPath(originalUrl)) {
    next();
    return;
  }

  const config = resolveSiteAuthConfig();
  if (!config.required) {
    next();
    return;
  }
  if (!config.configured) {
    sendGateResponse(
      res,
      503,
      "站点尚未配置访问口令，请先在部署环境中设置账号和密码。",
      SITE_AUTH_UNCONFIGURED,
    );
    return;
  }
  if (!readValidSessionToken(req, config.secret)) {
    sendGateResponse(res, 401, "请先登录后再使用。", SITE_AUTH_UNAUTHENTICATED);
    return;
  }
  req.user = {
    id: SITE_AUTH_OPERATOR_ID,
    role: "operator",
  };
  next();
}
