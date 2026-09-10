import { Router } from "express";
import { z } from "zod";
import type { ApiResponse, SiteAuthStatus } from "@write-now/shared/types/api";
import { SITE_AUTH_UNCONFIGURED } from "@write-now/shared/types/api";
import { AppError } from "../../../middleware/errorHandler";
import { validate } from "../../../middleware/validate";
import { resolveSiteAuthConfig } from "../siteAuthConfig";
import { consumeLoginAttempt, resetLoginAttempt } from "../siteAuthRateLimit";
import {
  applySessionCookie,
  clearSessionCookie,
  createSessionToken,
  isSecureRequest,
  readValidSessionToken,
  secretsEqual,
} from "../siteAuthSession";

const router = Router();

const loginSchema = z.object({
  username: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(200),
});

function currentStatus(req: import("express").Request): SiteAuthStatus {
  const config = resolveSiteAuthConfig();
  return {
    required: config.required,
    configured: config.configured,
    authenticated: Boolean(config.configured && readValidSessionToken(req, config.secret)),
  };
}

router.get("/status", (req, res) => {
  const response: ApiResponse<SiteAuthStatus> = {
    success: true,
    data: currentStatus(req),
  };
  res.status(200).json(response);
});

router.post("/login", validate({ body: loginSchema }), (req, res, next) => {
  try {
    const config = resolveSiteAuthConfig();
    if (config.required && !config.configured) {
      throw new AppError("站点尚未配置访问口令，请先在部署环境中设置账号和密码。", 503, SITE_AUTH_UNCONFIGURED);
    }
    if (!config.configured) {
      throw new AppError("当前不需要登录。", 400);
    }
    const attemptKey = req.ip || req.socket.remoteAddress || "unknown";
    if (!consumeLoginAttempt(attemptKey)) {
      throw new AppError("尝试次数过多，请稍后再试。", 429);
    }
    const body = req.body as z.infer<typeof loginSchema>;
    if (!secretsEqual(body.username, config.username) || !secretsEqual(body.password, config.password)) {
      throw new AppError("用户名或密码不正确。", 401);
    }
    resetLoginAttempt(attemptKey);
    const token = createSessionToken(config.secret, Date.now(), config.sessionTtlSeconds);
    applySessionCookie(res, token, config.sessionTtlSeconds, isSecureRequest(req));
    const response: ApiResponse<SiteAuthStatus> = {
      success: true,
      data: {
        required: config.required,
        configured: true,
        authenticated: true,
      },
      message: "已进入工作台。",
    };
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
});

router.post("/logout", (req, res) => {
  clearSessionCookie(res, isSecureRequest(req));
  const config = resolveSiteAuthConfig();
  const response: ApiResponse<SiteAuthStatus> = {
    success: true,
    data: {
      required: config.required,
      configured: config.configured,
      authenticated: false,
    },
    message: "已退出登录。",
  };
  res.status(200).json(response);
});

export default router;
