import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodTypeAny } from "zod";
import { ZodError } from "zod";

interface ValidationSchema {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export function validate(schema: ValidationSchema): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schema.body) {
        req.body = schema.body.parse(req.body);
      }
      if (schema.query) {
        // 回写校验/强制转换后的结果，使 z.coerce.*/transform 真正生效；
        // 保留 schema 之外的原始 query 键，避免影响仍直接读取 req.query 的代码。
        const parsedQuery = schema.query.parse(req.query) as Record<string, unknown>;
        Object.defineProperty(req, "query", {
          value: { ...req.query, ...parsedQuery },
          configurable: true,
          writable: true,
        });
      }
      if (schema.params) {
        // 回写校验/强制转换后的结果，使 z.coerce.* 真正生效
        // （req.params 为只读字典引用，用 Object.assign 原地更新而非替换引用）
        Object.assign(req.params, schema.params.parse(req.params) as Record<string, unknown>);
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(error);
        return;
      }
      next(new Error("请求参数校验失败。"));
    }
  };
}
