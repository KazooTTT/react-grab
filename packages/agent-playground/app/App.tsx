import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  formatElementInfo,
  type ReactGrabAPI,
  type ReactGrabState,
} from "react-grab";
import {
  feedbackService,
  type FeedbackRecord,
  type FeedbackStatus,
} from "./lib/feedback-service";

declare global {
  interface Window {
    __REACT_GRAB__?: ReactGrabAPI;
  }
}

interface ElementSnapshot {
  selector: string;
  elementLabel: string;
  tagName: string;
  textPreview: string;
  htmlPreview: string;
  pageUrl: string;
}

interface FeedbackDraft extends ElementSnapshot {
  context: string;
  componentName?: string | null;
  feedbackText: string;
  isContextPending: boolean;
}

type StatusFilter = FeedbackStatus | "all";

const STATUS_META: Record<
  FeedbackStatus,
  { label: string; badgeClass: string; dotClass: string }
> = {
  pending: {
    label: "未处理",
    badgeClass: "bg-amber-500/20 text-amber-200 border border-amber-400/40",
    dotClass: "bg-amber-400",
  },
  in_progress: {
    label: "处理中",
    badgeClass: "bg-sky-500/20 text-sky-200 border border-sky-400/40",
    dotClass: "bg-sky-400",
  },
  resolved: {
    label: "已处理",
    badgeClass: "bg-emerald-500/20 text-emerald-200 border border-emerald-400/40",
    dotClass: "bg-emerald-400",
  },
  invalid: {
    label: "已失效",
    badgeClass: "bg-slate-600/30 text-slate-200 border border-slate-500/40",
    dotClass: "bg-slate-300",
  },
};

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "pending", label: STATUS_META.pending.label },
  { value: "in_progress", label: STATUS_META.in_progress.label },
  { value: "resolved", label: STATUS_META.resolved.label },
  { value: "invalid", label: STATUS_META.invalid.label },
];

const formatDateTime = (iso: string): string => {
  const date = new Date(iso);
  return date.toLocaleString();
};

const buildSelector = (element: Element): string => {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && parts.length < 5) {
    const tag = current.tagName?.toLowerCase() ?? "";
    if (current instanceof HTMLElement) {
      if (current.id) {
        parts.push(`${tag}#${current.id}`);
        break;
      }
      const classes = Array.from(current.classList)
        .filter(Boolean)
        .slice(0, 2)
        .map((className) => `.${className}`);
      const suffix = classes.length > 0 ? classes.join("") : "";
      parts.push(`${tag}${suffix}`);
    } else {
      parts.push(tag);
    }
    current = current.parentElement;
  }
  return parts.reverse().join(" > ");
};

const createElementSnapshot = (element: Element): ElementSnapshot => {
  const tagName = element.tagName?.toLowerCase() ?? "unknown";
  const selector = buildSelector(element);
  const htmlPreview =
    element instanceof HTMLElement && element.outerHTML
      ? element.outerHTML.length > 400
        ? `${element.outerHTML.slice(0, 400)}...`
        : element.outerHTML
      : `<${tagName} />`;
  const textContent =
    element.textContent?.trim().replace(/\s+/g, " ") ?? "";
  const textPreview =
    textContent.length > 120 ? `${textContent.slice(0, 120)}...` : textContent;
  const labelPieces = [`<${tagName}>`];
  if (textPreview) {
    labelPieces.push(textPreview);
  }
  return {
    selector,
    elementLabel: labelPieces.join(" · "),
    tagName,
    textPreview,
    htmlPreview,
    pageUrl: window.location.href,
  };
};

const extractComponentName = (context: string): string | null => {
  const match = context.match(/\bin\s+([A-Z][\w.]*)/);
  if (!match) return null;
  const candidate = match[1];
  if (
    !candidate ||
    candidate === "<anonymous>" ||
    candidate.toLowerCase() === "server"
  ) {
    return null;
  }
  return candidate;
};

const copyToClipboard = async (value: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {}
  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    return true;
  } catch {
    return false;
  }
};

const buildLLMPayload = (record: FeedbackRecord): string => {
  return [
    `# 用户反馈`,
    `- 状态：${STATUS_META[record.status].label}`,
    `- 页面：${record.pageUrl}`,
    `- 元素：${record.elementLabel}`,
    `- 选择器：${record.selector}`,
    `- 组件：${record.componentName ?? "未识别"}`,
    "",
    "## 反馈正文",
    record.feedbackText.trim(),
    "",
    "## 元素上下文",
    record.context,
  ].join("\n");
};

const ReactGrabLogo = ({ size = 24 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 294 294"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <g clipPath="url(#clip0_0_3)">
      <mask
        id="mask0_0_3"
        style={{ maskType: "luminance" }}
        maskUnits="userSpaceOnUse"
        x="0"
        y="0"
        width="294"
        height="294"
      >
        <path d="M294 0H0V294H294V0Z" fill="white" />
      </mask>
      <g mask="url(#mask0_0_3)">
        <path
          d="M144.599 47.4924C169.712 27.3959 194.548 20.0265 212.132 30.1797C227.847 39.2555 234.881 60.3243 231.926 89.516C231.677 92.0069 231.328 94.5423 230.94 97.1058L228.526 110.14C228.517 110.136 228.505 110.132 228.495 110.127C228.486 110.165 228.479 110.203 228.468 110.24L216.255 105.741C216.256 105.736 216.248 105.728 216.248 105.723C207.915 103.125 199.421 101.075 190.82 99.5888L190.696 99.5588L173.526 97.2648L173.511 97.2631C173.492 97.236 173.467 97.2176 173.447 97.1905C163.862 96.2064 154.233 95.7166 144.599 95.7223C134.943 95.7162 125.295 96.219 115.693 97.2286C110.075 105.033 104.859 113.118 100.063 121.453C95.2426 129.798 90.8624 138.391 86.939 147.193C90.8624 155.996 95.2426 164.588 100.063 172.933C104.866 181.302 110.099 189.417 115.741 197.245C115.749 197.245 115.758 197.246 115.766 197.247L115.752 197.27L115.745 197.283L115.754 197.296L126.501 211.013L126.574 211.089C132.136 217.767 138.126 224.075 144.507 229.974L144.609 230.082L154.572 238.287C154.539 238.319 154.506 238.35 154.472 238.38C154.485 238.392 154.499 238.402 154.513 238.412L143.846 247.482L143.827 247.497C126.56 261.128 109.472 268.745 94.8019 268.745C88.5916 268.837 82.4687 267.272 77.0657 264.208C61.3496 255.132 54.3164 234.062 57.2707 204.871C57.528 202.307 57.8806 199.694 58.2904 197.054C28.3363 185.327 9.52301 167.51 9.52301 147.193C9.52301 129.042 24.2476 112.396 50.9901 100.375C53.3443 99.3163 55.7938 98.3058 58.2904 97.3526C57.8806 94.7023 57.528 92.0803 57.2707 89.516C54.3164 60.3243 61.3496 39.2555 77.0657 30.1797C94.6494 20.0265 119.486 27.3959 144.599 47.4924ZM70.6423 201.315C70.423 202.955 70.2229 204.566 70.0704 206.168C67.6686 229.567 72.5478 246.628 83.3615 252.988L83.5176 253.062C95.0399 259.717 114.015 254.426 134.782 238.38C125.298 229.45 116.594 219.725 108.764 209.314C95.8516 207.742 83.0977 205.066 70.6423 201.315ZM80.3534 163.438C77.34 171.677 74.8666 180.104 72.9484 188.664C81.1787 191.224 89.5657 193.247 98.0572 194.724L98.4618 194.813C95.2115 189.865 92.0191 184.66 88.9311 179.378C85.8433 174.097 83.003 168.768 80.3534 163.438ZM60.759 110.203C59.234 110.839 57.7378 111.475 56.27 112.11C34.7788 121.806 22.3891 134.591 22.3891 147.193C22.3891 160.493 36.4657 174.297 60.7494 184.26C63.7439 171.581 67.8124 159.182 72.9104 147.193C67.822 135.23 63.7566 122.855 60.759 110.203ZM98.4137 99.6404C89.8078 101.145 81.3075 103.206 72.9676 105.809C74.854 114.203 77.2741 122.468 80.2132 130.554L80.3059 130.939C82.9938 125.6 85.8049 120.338 88.8834 115.008C91.9618 109.679 95.1544 104.569 98.4137 99.6404ZM94.9258 38.5215C90.9331 38.4284 86.9866 39.3955 83.4891 41.3243C72.6291 47.6015 67.6975 64.5954 70.0424 87.9446L70.0416 88.2194C70.194 89.8208 70.3941 91.4325 70.6134 93.0624C83.0737 89.3364 95.8263 86.6703 108.736 85.0924C116.57 74.6779 125.28 64.9532 134.773 56.0249C119.877 44.5087 105.895 38.5215 94.9258 38.5215ZM205.737 41.3148C202.268 39.398 198.355 38.4308 194.394 38.5099L194.291 38.512C183.321 38.512 169.34 44.4991 154.443 56.0153C163.929 64.9374 172.634 74.6557 180.462 85.064C193.374 86.6345 206.129 89.3102 218.584 93.0624C218.813 91.4325 219.003 89.8118 219.166 88.2098C221.548 64.7099 216.65 47.6164 205.737 41.3148ZM144.551 64.3097C138.103 70.2614 132.055 76.6306 126.443 83.3765C132.389 82.995 138.427 82.8046 144.551 82.8046C150.727 82.8046 156.779 83.0143 162.707 83.3765C157.079 76.6293 151.015 70.2596 144.551 64.3097Z"
          fill="white"
        />
        <path
          d="M144.598 47.4924C169.712 27.3959 194.547 20.0265 212.131 30.1797C227.847 39.2555 234.88 60.3243 231.926 89.516C231.677 92.0069 231.327 94.5423 230.941 97.1058L228.526 110.14L228.496 110.127C228.487 110.165 228.478 110.203 228.469 110.24L216.255 105.741L216.249 105.723C207.916 103.125 199.42 101.075 190.82 99.5888L190.696 99.5588L173.525 97.2648L173.511 97.263C173.492 97.236 173.468 97.2176 173.447 97.1905C163.863 96.2064 154.234 95.7166 144.598 95.7223C134.943 95.7162 125.295 96.219 115.693 97.2286C110.075 105.033 104.859 113.118 100.063 121.453C95.2426 129.798 90.8622 138.391 86.939 147.193C90.8622 155.996 95.2426 164.588 100.063 172.933C104.866 181.302 110.099 189.417 115.741 197.245L115.766 197.247L115.752 197.27L115.745 197.283L115.754 197.296L126.501 211.013L126.574 211.089C132.136 217.767 138.126 224.075 144.506 229.974L144.61 230.082L154.572 238.287C154.539 238.319 154.506 238.35 154.473 238.38L154.512 238.412L143.847 247.482L143.827 247.497C126.56 261.13 109.472 268.745 94.8018 268.745C88.5915 268.837 82.4687 267.272 77.0657 264.208C61.3496 255.132 54.3162 234.062 57.2707 204.871C57.528 202.307 57.8806 199.694 58.2904 197.054C28.3362 185.327 9.52298 167.51 9.52298 147.193C9.52298 129.042 24.2476 112.396 50.9901 100.375C53.3443 99.3163 55.7938 98.3058 58.2904 97.3526C57.8806 94.7023 57.528 92.0803 57.2707 89.516C54.3162 60.3243 61.3496 39.2555 77.0657 30.1797C94.6493 20.0265 119.486 27.3959 144.598 47.4924ZM70.6422 201.315C70.423 202.955 70.2229 204.566 70.0704 206.168C67.6686 229.567 72.5478 246.628 83.3615 252.988L83.5175 253.062C95.0399 259.717 114.015 254.426 134.782 238.38C125.298 229.45 116.594 219.725 108.764 209.314C95.8515 207.742 83.0977 205.066 70.6422 201.315ZM80.3534 163.438C77.34 171.677 74.8666 180.104 72.9484 188.664C81.1786 191.224 89.5657 193.247 98.0572 194.724L98.4618 194.813C95.2115 189.865 92.0191 184.66 88.931 179.378C85.8433 174.097 83.003 168.768 80.3534 163.438ZM60.7589 110.203C59.234 110.839 57.7378 111.475 56.2699 112.11C34.7788 121.806 22.3891 134.591 22.3891 147.193C22.3891 160.493 36.4657 174.297 60.7494 184.26C63.7439 171.581 67.8124 159.182 72.9103 147.193C67.822 135.23 63.7566 122.855 60.7589 110.203ZM98.4137 99.6404C89.8078 101.145 81.3075 103.206 72.9676 105.809C74.8539 114.203 77.2741 122.468 80.2132 130.554L80.3059 130.939C82.9938 125.6 85.8049 120.338 88.8834 115.008C91.9618 109.679 95.1544 104.569 98.4137 99.6404ZM94.9258 38.5215C90.9331 38.4284 86.9866 39.3955 83.4891 41.3243C72.629 47.6015 67.6975 64.5954 70.0424 87.9446L70.0415 88.2194C70.194 89.8208 70.3941 91.4325 70.6134 93.0624C83.0737 89.3364 95.8262 86.6703 108.736 85.0924C116.57 74.6779 125.28 64.9532 134.772 56.0249C119.877 44.5087 105.895 38.5215 94.9258 38.5215ZM205.737 41.3148C202.268 39.398 198.355 38.4308 194.394 38.5099L194.291 38.512C183.321 38.512 169.34 44.4991 154.443 56.0153C163.929 64.9374 172.634 74.6557 180.462 85.064C193.374 86.6345 206.129 89.3102 218.584 93.0624C218.813 91.4325 219.003 89.8118 219.166 88.2098C221.548 64.7099 216.65 47.6164 205.737 41.3148ZM144.551 64.3097C138.103 70.2614 132.055 76.6306 126.443 83.3765C132.389 82.995 138.427 82.8046 144.551 82.8046C150.727 82.8046 156.779 83.0143 162.707 83.3765C157.079 76.6293 151.015 70.2596 144.551 64.3097Z"
          fill="#fc4efd"
        />
      </g>
      <mask
        id="mask1_0_3"
        style={{ maskType: "luminance" }}
        maskUnits="userSpaceOnUse"
        x="102"
        y="84"
        width="161"
        height="162"
      >
        <path
          d="M235.282 84.827L102.261 112.259L129.693 245.28L262.714 217.848L235.282 84.827Z"
          fill="white"
        />
      </mask>
      <g mask="url(#mask1_0_3)">
        <path
          d="M136.863 129.916L213.258 141.224C220.669 142.322 222.495 152.179 215.967 155.856L187.592 171.843L184.135 204.227C183.339 211.678 173.564 213.901 169.624 207.526L129.021 141.831C125.503 136.14 130.245 128.936 136.863 129.916Z"
          fill="#fc4efd"
          stroke="#fc4efd"
          strokeWidth="0.817337"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </g>
    <defs>
      <clipPath id="clip0_0_3">
        <rect width="294" height="294" fill="white" />
      </clipPath>
    </defs>
  </svg>
);

export const App = () => {
  const [logs, setLogs] = useState<
    Array<{ type: string; message: string; time: Date }>
  >([]);
  const [draft, setDraft] = useState<FeedbackDraft | null>(null);
  const [records, setRecords] = useState<FeedbackRecord[]>([]);
  const [grabState, setGrabState] = useState<ReactGrabState | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingRecords, setIsLoadingRecords] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [updatingRecordIds, setUpdatingRecordIds] = useState<Set<string>>(
    () => new Set(),
  );
  const didInitAgent = useRef(false);
  const contextTokenRef = useRef(0);

  const addLog = useCallback((type: string, message: string) => {
    setLogs((prev) => [...prev, { type, message, time: new Date() }]);
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
  }, []);

  useEffect(() => {
    let isMounted = true;
    feedbackService
      .list()
      .then((list) => {
        if (!isMounted) return;
        setRecords(list);
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingRecords(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (didInitAgent.current) return;

    const initAgent = () => {
      if (didInitAgent.current) return;
      const api = window.__REACT_GRAB__;
      if (!api) {
        addLog("error", "React Grab 未初始化");
        return;
      }
      didInitAgent.current = true;
      api.setAgent({
        storage: sessionStorage,
        onStart: (session) => addLog("start", session.id),
        onStatus: (status) => addLog("status", status),
        onComplete: () => addLog("done", "Complete"),
        onError: (error) => addLog("error", error.message),
        onResume: (session) => addLog("resume", session.id),
      });
      addLog("info", "Agent Ready");
    };

    if (window.__REACT_GRAB__) {
      initAgent();
      return;
    }

    const listener = () => {
      initAgent();
    };
    window.addEventListener("react-grab:init", listener, { once: true });
    return () => {
      window.removeEventListener("react-grab:init", listener);
    };
  }, [addLog]);

  useEffect(() => {
    const applyOptions = (api: ReactGrabAPI) => {
      api.updateOptions({
        maxContextLines: 8,
        onElementSelect: (element) => {
          const snapshot = createElementSnapshot(element);
          contextTokenRef.current += 1;
          const currentToken = contextTokenRef.current;
          setDraft((previous) => {
            const preserved =
              previous && previous.selector === snapshot.selector
                ? previous.feedbackText
                : "";
            return {
              ...snapshot,
              context: snapshot.htmlPreview,
              componentName: previous?.componentName ?? null,
              feedbackText: preserved,
              isContextPending: true,
            };
          });
          void formatElementInfo(element, { maxLines: 8 })
            .then((contextText) => {
              if (contextTokenRef.current !== currentToken) return;
              const componentName = extractComponentName(contextText);
              setDraft((previous) => {
                if (!previous || previous.selector !== snapshot.selector) {
                  return previous;
                }
                return {
                  ...previous,
                  context: contextText,
                  componentName,
                  isContextPending: false,
                };
              });
            })
            .catch(() => {
              if (contextTokenRef.current !== currentToken) return;
              setDraft((previous) => {
                if (!previous || previous.selector !== snapshot.selector) {
                  return previous;
                }
                return { ...previous, isContextPending: false };
              });
            });
        },
        onStateChange: (state) => setGrabState(state),
      });
    };

    const handleInit = (event?: Event) => {
      const api =
        (event as CustomEvent<ReactGrabAPI> | undefined)?.detail ??
        window.__REACT_GRAB__;
      if (api) {
        applyOptions(api);
      }
    };

    if (window.__REACT_GRAB__) {
      handleInit();
    }

    const listener = (event: Event) => handleInit(event);
    window.addEventListener("react-grab:init", listener);
    return () => {
      window.removeEventListener("react-grab:init", listener);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timerId = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(timerId);
  }, [toast]);

  const statusCounts = useMemo<Record<FeedbackStatus, number>>(() => {
    return records.reduce<Record<FeedbackStatus, number>>(
      (accumulator, record) => {
        accumulator[record.status] += 1;
        return accumulator;
      },
      {
        pending: 0,
        in_progress: 0,
        resolved: 0,
        invalid: 0,
      },
    );
  }, [records]);

  const filteredRecords = useMemo(() => {
    if (statusFilter === "all") return records;
    return records.filter((record) => record.status === statusFilter);
  }, [records, statusFilter]);

  const toggleUpdatingRecord = (id: string, isUpdating: boolean) => {
    setUpdatingRecordIds((previous) => {
      const next = new Set(previous);
      if (isUpdating) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const handleSubmitDraft = async () => {
    if (!draft) return;
    const trimmed = draft.feedbackText.trim();
    if (!trimmed) {
      showToast("请先输入反馈内容");
      return;
    }
    setIsSubmitting(true);
    try {
      const record = await feedbackService.create({
        elementLabel: draft.elementLabel,
        selector: draft.selector,
        tagName: draft.tagName,
        textPreview: draft.textPreview,
        context: draft.context,
        pageUrl: draft.pageUrl,
        htmlPreview: draft.htmlPreview,
        feedbackText: trimmed,
        componentName: draft.componentName,
      });
      setRecords((previous) => [record, ...previous]);
      addLog("feedback", `新建反馈 ${record.id}`);
      showToast("反馈已提交并存储");
      setDraft((previous) =>
        previous
          ? {
              ...previous,
              feedbackText: "",
            }
          : previous,
      );
    } catch {
      showToast("提交失败，请重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusChange = async (
    record: FeedbackRecord,
    status: FeedbackStatus,
  ) => {
    if (record.status === status) return;
    toggleUpdatingRecord(record.id, true);
    try {
      const updated = await feedbackService.updateStatus(record.id, status);
      if (!updated) {
        showToast("记录不存在");
        return;
      }
      setRecords((previous) =>
        previous.map((item) => (item.id === updated.id ? updated : item)),
      );
      addLog("update", `${record.id} → ${STATUS_META[status].label}`);
      showToast("状态已更新");
    } catch {
      showToast("状态更新失败");
    } finally {
      toggleUpdatingRecord(record.id, false);
    }
  };

  const handleCopyRecord = async (record: FeedbackRecord) => {
    const didCopy = await copyToClipboard(buildLLMPayload(record));
    showToast(didCopy ? "已复制到剪贴板" : "复制失败");
  };

  const handleResetDraft = () => {
    setDraft(null);
  };

  const summarizeFeedback = (text: string): string => {
    const trimmed = text.trim();
    if (!trimmed) return "(暂无正文)";
    return trimmed.length > 60 ? `${trimmed.slice(0, 60)}...` : trimmed;
  };

  const renderLogBadge = (type: string) => {
    const typeStyles: Record<
      string,
      { bg: string; text: string; icon: string }
    > = {
      info: { bg: "bg-blue-500/20", text: "text-blue-300", icon: "◆" },
      start: { bg: "bg-green-500/20", text: "text-green-300", icon: "▶" },
      status: { bg: "bg-cyan-500/20", text: "text-cyan-300", icon: "◉" },
      done: { bg: "bg-emerald-500/20", text: "text-emerald-300", icon: "✓" },
      error: { bg: "bg-red-500/20", text: "text-red-300", icon: "!" },
      resume: { bg: "bg-purple-500/20", text: "text-purple-300", icon: "↻" },
      feedback: { bg: "bg-amber-500/20", text: "text-amber-200", icon: "✎" },
      update: { bg: "bg-pink-500/20", text: "text-pink-200", icon: "⇄" },
    };
    const style = typeStyles[type] || typeStyles.info;
    return (
      <span
        className={`${style.bg} ${style.text} px-2 py-1 rounded text-xs font-medium w-12 flex items-center gap-1`}
      >
        <span>{style.icon}</span>
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-black text-white px-4 py-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <ReactGrabLogo size={32} />
            <div>
              <h1 className="text-xl font-semibold">React Grab 反馈演示</h1>
              <p className="text-sm text-white/50">
                选中任意元素，沉淀反馈并复制上下文给大模型
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="flex flex-col gap-6 rounded-2xl bg-white/5 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-white/40">
                  React Grab
                </p>
                <p className="text-sm text-white/90">
                  按住 Command + Ctrl 激活拾取
                </p>
              </div>
              <button
                onClick={() => window.__REACT_GRAB__?.activate()}
                className="rounded border border-white/40 px-3 py-1 text-sm text-white hover:border-white"
              >
                立即激活
              </button>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/40 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-white/60">当前状态</span>
                <span
                  className={
                    grabState?.isActive ? "text-emerald-300" : "text-white/40"
                  }
                >
                  {grabState?.isActive ? "已激活" : "待命"}
                </span>
              </div>
              <div className="mt-2 text-xs text-white/45">
                {grabState?.targetElement
                  ? "已捕获元素，输入反馈即可提交"
                  : "选择元素后自动生成上下文"}
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-xs uppercase tracking-wide text-white/50">
                测试用元素
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="rounded border border-white/20 bg-white/10 px-3 py-1.5 text-sm text-white/80 hover:border-white/40">
                  Primary CTA
                </button>
                <button className="rounded border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/70">
                  Ghost Button
                </button>
              </div>
              <div className="rounded border border-white/10 bg-white/5 p-3 text-sm">
                <div className="font-medium text-white/90">User Card</div>
                <div className="mt-1 text-xs italic text-white/50">
                  john@example.com
                </div>
              </div>
              <input
                type="text"
                placeholder="Search placeholder"
                className="w-full rounded border border-white/10 bg-white/5 px-3 py-1.5 text-sm placeholder:text-white/30 focus:border-white/30 focus:outline-none"
              />
            </div>

            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-white/50">
                Activity
              </div>
              <div className="min-h-[160px] rounded border border-white/10 bg-black/40 p-3 font-mono text-xs">
                {logs.length === 0 ? (
                  <span className="text-white/30">等待事件...</span>
                ) : (
                  logs.map((log, index) => (
                    <div
                      key={`${log.time.getTime()}-${index}`}
                      className="flex items-center gap-3 rounded px-2 py-1.5 hover:bg-white/5"
                    >
                      {renderLogBadge(log.type)}
                      <span className="flex-1 text-white/70">{log.message}</span>
                      <span className="text-white/30">
                        {log.time.toLocaleTimeString()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>

          <main className="flex flex-col gap-6">
            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-white/40">
                    当前选中
                  </p>
                  <h2 className="text-lg font-semibold">
                    {draft ? draft.elementLabel : "等待选择元素"}
                  </h2>
                </div>
                {draft && (
                  <button
                    onClick={handleResetDraft}
                    className="text-sm text-white/60 underline-offset-4 hover:underline"
                  >
                    清除
                  </button>
                )}
              </div>
              {draft ? (
                <div className="mt-4 space-y-3 text-sm text-white/80">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded border border-white/10 bg-black/40 p-3">
                      <div className="text-xs text-white/45">选择器</div>
                      <div className="mt-1 font-mono text-xs">{draft.selector}</div>
                    </div>
                    <div className="rounded border border-white/10 bg-black/40 p-3">
                      <div className="text-xs text-white/45">推测组件</div>
                      <div className="mt-1">
                        {draft.componentName ?? "未识别组件"}
                      </div>
                    </div>
                  </div>
                  <div className="rounded border border-white/10 bg-black/60 p-3">
                    <div className="flex items-center justify-between text-xs text-white/50">
                      <span>上下文</span>
                      {draft.isContextPending && (
                        <span className="text-amber-300">解析中...</span>
                      )}
                    </div>
                    <pre className="mt-2 max-h-48 overflow-auto text-xs text-white/80">
                      {draft.context}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded border border-dashed border-white/20 p-4 text-sm text-white/50">
                  激活 React Grab，选中元素后即可预览上下文并填写反馈。
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-white/40">
                    反馈内容
                  </p>
                  <h2 className="text-lg font-semibold">快速录入</h2>
                </div>
              </div>
              <textarea
                value={draft?.feedbackText ?? ""}
                disabled={!draft}
                onChange={(event) =>
                  setDraft((previous) =>
                    previous
                      ? { ...previous, feedbackText: event.target.value }
                      : previous,
                  )
                }
                placeholder={
                  draft ? "描述问题、期望或上下文..." : "先选中元素再开始输入"
                }
                className="mt-4 min-h-[120px] w-full rounded border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none disabled:cursor-not-allowed disabled:text-white/30"
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  onClick={handleSubmitDraft}
                  disabled={isSubmitting || !draft}
                  className="rounded bg-white px-4 py-2 text-sm font-semibold text-black transition disabled:cursor-not-allowed disabled:bg-white/30"
                >
                  {isSubmitting ? "提交中..." : "提交并落库"}
                </button>
                <button
                  onClick={handleResetDraft}
                  disabled={!draft}
                  className="rounded border border-white/30 px-3 py-2 text-sm text-white/80 transition hover:border-white disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/30"
                >
                  重置
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-white/40">
                    反馈列表
                  </p>
                  <h2 className="text-lg font-semibold">状态管理</h2>
                </div>
                <div className="flex items-center gap-2">
                  {STATUS_FILTERS.map((filter) => {
                    const count =
                      filter.value === "all"
                        ? records.length
                        : statusCounts[filter.value as FeedbackStatus];
                    const active = statusFilter === filter.value;
                    return (
                      <button
                        key={filter.value}
                        onClick={() => setStatusFilter(filter.value)}
                        className={`rounded-full px-3 py-1 text-xs ${
                          active
                            ? "bg-white text-black"
                            : "bg-white/10 text-white/60"
                        }`}
                      >
                        {filter.label}
                        <span className="ml-1 text-white/60">({count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mt-4 space-y-4">
                {isLoadingRecords ? (
                  <div className="rounded border border-white/10 bg-black/40 p-4 text-white/50">
                    正在加载历史反馈...
                  </div>
                ) : filteredRecords.length === 0 ? (
                  <div className="rounded border border-white/10 bg-black/40 p-4 text-white/50">
                    暂无记录，提交后将在此处显示。
                  </div>
                ) : (
                  filteredRecords.map((record) => {
                    const isUpdating = updatingRecordIds.has(record.id);
                    return (
                      <div
                        key={record.id}
                        className="space-y-3 rounded-xl border border-white/10 bg-black/40 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-sm text-white/60">
                              {record.elementLabel}
                            </div>
                            <div className="text-base font-semibold text-white">
                              {summarizeFeedback(record.feedbackText)}
                            </div>
                          </div>
                          <span
                            className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs ${STATUS_META[record.status].badgeClass}`}
                          >
                            <span
                              className={`h-2 w-2 rounded-full ${STATUS_META[record.status].dotClass}`}
                            />
                            {STATUS_META[record.status].label}
                          </span>
                        </div>
                        <div className="grid gap-3 text-xs text-white/60 md:grid-cols-2">
                          <div>
                            <div className="text-white/40">组件</div>
                            <div>{record.componentName ?? "未识别组件"}</div>
                          </div>
                          <div>
                            <div className="text-white/40">页面</div>
                            <div className="truncate">{record.pageUrl}</div>
                          </div>
                          <div>
                            <div className="text-white/40">选择器</div>
                            <div className="font-mono text-[11px]">
                              {record.selector}
                            </div>
                          </div>
                          <div>
                            <div className="text-white/40">更新时间</div>
                            <div>{formatDateTime(record.updatedAt)}</div>
                          </div>
                        </div>
                        <div className="rounded border border-white/10 bg-black/60 p-3">
                          <div className="text-xs uppercase tracking-wide text-white/40">
                            元素上下文
                          </div>
                          <pre className="mt-2 max-h-40 overflow-auto text-xs text-white/80">
                            {record.context}
                          </pre>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <select
                            className="rounded border border-white/20 bg-black/60 px-3 py-2 text-sm text-white/80 focus:border-white focus:outline-none"
                            value={record.status}
                            onChange={(event) =>
                              handleStatusChange(
                                record,
                                event.target.value as FeedbackStatus,
                              )
                            }
                            disabled={isUpdating}
                          >
                            {Object.entries(STATUS_META).map(
                              ([value, meta]) => (
                                <option key={value} value={value}>
                                  {meta.label}
                                </option>
                              ),
                            )}
                          </select>
                          <button
                            onClick={() => handleCopyRecord(record)}
                            className="rounded border border-white/30 px-3 py-2 text-sm text-white/80 hover:border-white"
                          >
                            复制给大模型
                          </button>
                          {isUpdating && (
                            <span className="text-xs text-white/50">
                              更新中...
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </main>
        </div>
      </div>
      {toast && (
        <div className="fixed bottom-6 right-6 rounded-lg border border-white/20 bg-black/80 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
};