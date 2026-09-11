import { useMemo } from "react";
import type {
  DirectorPolicyMode,
  DirectorRuntimeSnapshot,
} from "@write-now/shared/types/directorRuntime";
import { Badge } from "@/components/ui/badge";

interface TaskCenterRuntimePolicyCardProps {
  taskId: string;
  snapshot: DirectorRuntimeSnapshot | null | undefined;
}

const POLICY_OPTIONS: Array<{ value: DirectorPolicyMode; label: string; description: string }> = [
  {
    value: "suggest_only",
    label: "只给建议",
    description: "只分析和给出建议，不自动写入规划或正文。",
  },
  {
    value: "run_next_step",
    label: "推进下一步",
    description: "只执行当前最小步骤，完成后停下来让你检查。",
  },
  {
    value: "run_until_gate",
    label: "推进到检查点",
    description: "连续推进到下一个需要确认的节点。",
  },
  {
    value: "auto_safe_scope",
    label: "安全范围自动推进",
    description: "仅在系统判断风险较低的范围内继续自动处理。",
  },
];

function formatPolicyMode(mode: DirectorPolicyMode): string {
  return POLICY_OPTIONS.find((item) => item.value === mode)?.label ?? mode;
}

export default function TaskCenterRuntimePolicyCard({
  snapshot,
}: TaskCenterRuntimePolicyCardProps) {
  const currentMode = snapshot?.policy.mode ?? "run_until_gate";
  const selectedOption = useMemo(
    () => POLICY_OPTIONS.find((item) => item.value === currentMode) ?? POLICY_OPTIONS[2],
    [currentMode],
  );

  if (!snapshot) {
    return null;
  }

  const allowExpensiveReview = Boolean(snapshot.policy.allowExpensiveReview);
  const mayOverwriteUserContent = Boolean(snapshot.policy.mayOverwriteUserContent);

  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-medium">导演推进方式</div>
          <div className="mt-1 text-sm leading-6 text-muted-foreground">
            {selectedOption.description}
          </div>
        </div>
        <Badge variant="outline">{formatPolicyMode(snapshot.policy.mode)}</Badge>
      </div>

      <div className="mt-3 space-y-2 rounded-md border bg-background/70 p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">执行完整审校</span>
          <Badge variant={allowExpensiveReview ? "default" : "secondary"}>
            {allowExpensiveReview ? "允许" : "未开启"}
          </Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">改写受保护内容</span>
          <Badge variant={mayOverwriteUserContent ? "default" : "secondary"}>
            {mayOverwriteUserContent ? "允许" : "未开启"}
          </Badge>
        </div>
      </div>
      <div className="mt-2 text-xs leading-5 text-muted-foreground">
        推进方式由工作台启动时配置；如需调整请在小说来源工作台重新设置。
      </div>
    </div>
  );
}
