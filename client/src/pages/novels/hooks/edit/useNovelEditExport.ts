import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import type { NovelExportFormat, NovelExportScope } from "@write-now/shared/types/novelExport";
import { downloadNovelExport } from "@/api/novel";
import { toast } from "@/components/ui/toast";
import { createDownload, resolveNovelExportFlags } from "../../novelEditPageHelpers";
import { isNovelWorkspaceFlowTab } from "../../novelWorkspaceNavigation";

export interface UseNovelEditExportInput {
  id: string;
  activeTab: string;
  basicTitle?: string;
  novelDetailTitle?: string;
}

export function useNovelEditExport(input: UseNovelEditExportInput) {
  const { id, activeTab, basicTitle = "", novelDetailTitle = "" } = input;

  const exportNovelMutation = useMutation({
    mutationFn: async (mutationInput: {
      format: NovelExportFormat;
      scope: NovelExportScope;
      novelTitle: string;
    }) => {
      const exported = await downloadNovelExport(id, mutationInput.format, mutationInput.scope, mutationInput.novelTitle);
      return {
        ...exported,
        scope: mutationInput.scope,
        format: mutationInput.format,
      };
    },
    onSuccess: ({ blob, fileName, scope }) => {
      createDownload(blob, fileName);
      toast.success(scope === "full" ? "整本书导出已开始。" : "当前步骤导出已开始。");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "导出失败。");
    },
  });

  const exportNovelTitle = useMemo(
    () => basicTitle.trim() || novelDetailTitle.trim() || id,
    [basicTitle, novelDetailTitle, id],
  );

  const currentExportScope = isNovelWorkspaceFlowTab(activeTab) && activeTab !== "world" ? activeTab : null;

  const {
    isExportingCurrentMarkdown,
    isExportingCurrentJson,
    isExportingFullMarkdown,
    isExportingFullJson,
    isExportingFullTxt,
  } = resolveNovelExportFlags({
    isPending: exportNovelMutation.isPending,
    variables: exportNovelMutation.variables,
    currentScope: currentExportScope,
  });

  const exportControls = useMemo(
    () => ({
      canExportCurrentStep: Boolean(currentExportScope),
      isExportingCurrentMarkdown,
      isExportingCurrentJson,
      isExportingFullMarkdown,
      isExportingFullJson,
      isExportingFullTxt,
      onExportCurrent: (format: NovelExportFormat) => {
        if (!currentExportScope) {
          return;
        }
        exportNovelMutation.mutate({
          format,
          scope: currentExportScope,
          novelTitle: exportNovelTitle,
        });
      },
      onExportFull: (format: NovelExportFormat) => {
        exportNovelMutation.mutate({
          format,
          scope: "full",
          novelTitle: exportNovelTitle,
        });
      },
    }),
    [
      currentExportScope,
      exportNovelMutation,
      exportNovelTitle,
      isExportingCurrentJson,
      isExportingCurrentMarkdown,
      isExportingFullJson,
      isExportingFullMarkdown,
      isExportingFullTxt,
    ],
  );

  return {
    exportControls,
    exportNovelMutation,
    exportNovelTitle,
    currentExportScope,
  };
}
