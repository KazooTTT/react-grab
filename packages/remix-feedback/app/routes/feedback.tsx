import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  TypedResponse,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Form,
  Link,
  useFetcher,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import type { Feedback, FeedbackStatus } from "@prisma/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactGrabAPI, ReactGrabState } from "react-grab";
import { formatElementInfo, init } from "react-grab";
import { db } from "~/utils/db.server";

const STATUS_ORDER: FeedbackStatus[] = [
  "PENDING",
  "IN_PROGRESS",
  "RESOLVED",
  "INVALID",
];

const STATUS_TEXT: Record<FeedbackStatus, string> = {
  PENDING: "未处理",
  IN_PROGRESS: "处理中",
  RESOLVED: "已处理",
  INVALID: "失效",
};

const STATUS_COLORS: Record<FeedbackStatus, string> = {
  PENDING: "#facc15",
  IN_PROGRESS: "#38bdf8",
  RESOLVED: "#4ade80",
  INVALID: "#94a3b8",
};

const VALID_STATUS = new Set<FeedbackStatus>(STATUS_ORDER);

type StatusFilter = "ALL" | FeedbackStatus;

interface LoaderData {
  feedbacks: Feedback[];
  activeStatus: StatusFilter;
}

interface ActionOk {
  ok: true;
  type: "create" | "update";
  feedback: Feedback;
}

interface ActionError {
  ok: false;
  message: string;
}

type ActionResult = ActionOk | ActionError;

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<TypedResponse<LoaderData>> => {
  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status")?.toUpperCase() as
    | FeedbackStatus
    | undefined;
  const where = statusParam && VALID_STATUS.has(statusParam)
    ? { status: statusParam }
    : undefined;

  const feedbacks = await db.feedback.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  return json({
    feedbacks,
    activeStatus: where ? statusParam! : "ALL",
  });
};

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<TypedResponse<ActionResult>> => {
  const formData = await request.formData();
  const intent = formData.get("_intent");

  if (intent === "create") {
    const requiredFields = [
      "pageUrl",
      "selector",
      "elementLabel",
      "htmlPreview",
      "context",
      "feedbackText",
    ] as const;

    const values = Object.fromEntries(
      requiredFields.map((key) => [key, formData.get(key)?.toString().trim()]),
    ) as Record<(typeof requiredFields)[number], string | undefined>;

    for (const key of requiredFields) {
      if (!values[key]) {
        return json(
          {
            ok: false,
            message: `缺少必要字段：${key}`,
          },
          { status: 400 },
        );
      }
    }

    const componentName = formData.get("componentName")?.toString() || null;
    const tagName = formData.get("tagName")?.toString() ?? "";

    const feedback = await db.feedback.create({
      data: {
        pageUrl: values.pageUrl!,
        selector: values.selector!,
        elementLabel: values.elementLabel!,
        htmlPreview: values.htmlPreview!,
        context: values.context!,
        feedbackText: values.feedbackText!,
        componentName,
        status: "PENDING",
      },
    });

    return json({ ok: true, type: "create", feedback });
  }

  if (intent === "update-status") {
    const id = formData.get("id")?.toString();
    const status = formData.get("status")?.toString().toUpperCase();

    if (!id || !status || !VALID_STATUS.has(status as FeedbackStatus)) {
      return json(
        { ok: false, message: "无效的状态参数" },
        { status: 400 },
      );
    }

    const feedback = await db.feedback.update({
      where: { id },
      data: { status: status as FeedbackStatus },
    });

    return json({ ok: true, type: "update", feedback });
  }

  return json({ ok: false, message: "未知操作" }, { status: 400 });
};

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

const buildSelector = (element: Element): string => {
  const parts: string[] = [];
  let current: Element | null = element;
  let depth = 0;
  while (current && depth < 5) {
    depth += 1;
    const tag = current.tagName?.toLowerCase() ?? "element";
    if (current instanceof HTMLElement) {
      if (current.id) {
        parts.push(`${tag}#${current.id}`);
        break;
      }
      const classes = Array.from(current.classList)
        .filter(Boolean)
        .slice(0, 2)
        .map((className) => `.${className}`);
      const suffix = classes.join("");
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
  const elementLabel = textPreview
    ? `<${tagName}> · ${textPreview}`
    : `<${tagName}>`;

  return {
    selector,
    elementLabel,
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

const formatDateTime = (date: Date | string): string => {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString();
};

const copyToClipboard = async (value: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
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
  }
};

const buildLLMPayload = (record: Feedback): string => {
  return [
    `# 用户反馈`,
    `- 状态：${STATUS_TEXT[record.status]}`,
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

export default function FeedbackPage() {
  const { feedbacks, activeStatus } = useLoaderData<typeof loader>();
  const createFetcher = useFetcher<typeof action>();
  const updateFetcher = useFetcher<typeof action>();
  const navigation = useNavigation();

  const [records, setRecords] = useState(feedbacks);
  const [draft, setDraft] = useState<FeedbackDraft | null>(null);
  const [grabApiReady, setGrabApiReady] = useState(false);
  const [grabState, setGrabState] = useState<ReactGrabState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingStatusId, setPendingStatusId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const apiRef = useRef<ReactGrabAPI | null>(null);
  const contextTokenRef = useRef(0);

  useEffect(() => {
    setRecords(feedbacks);
  }, [feedbacks]);

  useEffect(() => {
    if (toast) {
      const timer = window.setTimeout(() => setToast(null), 2500);
      return () => window.clearTimeout(timer);
    }
  }, [toast]);

  const handleElementSelect = useCallback((element: Element) => {
    const snapshot = createElementSnapshot(element);
    contextTokenRef.current += 1;
    const token = contextTokenRef.current;

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
        if (contextTokenRef.current !== token) return;
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
        if (contextTokenRef.current !== token) return;
        setDraft((previous) => {
          if (!previous || previous.selector !== snapshot.selector) {
            return previous;
          }
          return { ...previous, isContextPending: false };
        });
      });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let disposed = false;
    const api = init({
      maxContextLines: 8,
      onElementSelect: handleElementSelect,
      onStateChange: (state) => setGrabState(state),
    });
    apiRef.current = api;
    setGrabApiReady(true);

    return () => {
      disposed = true;
      apiRef.current = null;
      api.dispose();
    };
  }, [handleElementSelect]);

  useEffect(() => {
    if (createFetcher.state === "idle" && createFetcher.data) {
      const data = createFetcher.data;
      if (data.ok) {
        setToast("反馈提交成功");
        setErrorMessage(null);
        setDraft((previous) =>
          previous ? { ...previous, feedbackText: "" } : previous,
        );
      } else {
        setErrorMessage(data.message);
      }
    }
  }, [createFetcher.state, createFetcher.data]);

  useEffect(() => {
    if (updateFetcher.state === "idle") {
      setPendingStatusId(null);
      if (updateFetcher.data) {
        if (updateFetcher.data.ok) {
          setToast("状态已更新");
          setErrorMessage(null);
        } else {
          setErrorMessage(updateFetcher.data.message);
        }
      }
    }
  }, [updateFetcher.state, updateFetcher.data]);

  const statusCounts = useMemo(() => {
    return records.reduce<Record<StatusFilter, number>>(
      (acc, record) => {
        acc.ALL += 1;
        acc[record.status] += 1;
        return acc;
      },
      {
        ALL: 0,
        PENDING: 0,
        IN_PROGRESS: 0,
        RESOLVED: 0,
        INVALID: 0,
      },
    );
  }, [records]);

  const handleSubmitDraft = () => {
    if (!draft) {
      setErrorMessage("请先选中一个页面元素");
      return;
    }
    if (!draft.feedbackText.trim()) {
      setErrorMessage("请填写反馈内容");
      return;
    }

    const formData = new FormData();
    formData.append("_intent", "create");
    formData.append("pageUrl", draft.pageUrl);
    formData.append("selector", draft.selector);
    formData.append("elementLabel", draft.elementLabel);
    formData.append("htmlPreview", draft.htmlPreview);
    formData.append("context", draft.context);
    formData.append("feedbackText", draft.feedbackText.trim());
    formData.append("componentName", draft.componentName ?? "");
    formData.append("tagName", draft.tagName);

    createFetcher.submit(formData, { method: "post" });
  };

  const handleStatusChange = (id: string, status: FeedbackStatus) => {
    setPendingStatusId(id);
    const formData = new FormData();
    formData.append("_intent", "update-status");
    formData.append("id", id);
    formData.append("status", status);
    updateFetcher.submit(formData, { method: "post" });
  };

  const handleCopyRecord = async (record: Feedback) => {
    const payload = buildLLMPayload(record);
    const ok = await copyToClipboard(payload);
    setToast(ok ? "内容已复制" : "复制失败");
  };

  const filteredRecords =
    activeStatus === "ALL"
      ? records
      : records.filter((record) => record.status === activeStatus);

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <p className="eyebrow">React Grab</p>
          <h1>反馈面板（Remix + SQLite）</h1>
          <p className="subtext">
            选中页面元素，补充描述并落库，支持四种状态与 LLM 快速复制。
          </p>
        </div>
        <div className="header__actions">
          <button
            type="button"
            disabled={!grabApiReady}
            className="button button--primary"
            onClick={() => apiRef.current?.activate()}
          >
            {grabApiReady ? "激活拾取 (⌘ + Ctrl)" : "初始化中..."}
          </button>
          <Form method="post" action="/feedback?refresh=1" reloadDocument>
            <button type="submit" className="button button--ghost">
              刷新页面
            </button>
          </Form>
        </div>
      </header>

      <section className="panel">
        <div className="panel__header">
          <div>
            <p className="eyebrow">当前选中</p>
            <h2>{draft ? draft.elementLabel : "等待拾取元素"}</h2>
          </div>
          {draft && (
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setDraft(null)}
            >
              清空
            </button>
          )}
        </div>
        {draft ? (
          <div className="draft-grid">
            <div className="info-card">
              <span className="info-card__label">页面位置</span>
              <code className="info-card__content">{draft.selector}</code>
            </div>
            <div className="info-card">
              <span className="info-card__label">推测组件</span>
              <span className="info-card__content">
                {draft.componentName ?? "未识别"}
              </span>
            </div>
            <div className="info-card info-card--wide">
              <span className="info-card__label">
                元素上下文 {draft.isContextPending && "(解析中...)"}
              </span>
              <pre className="info-card__pre">{draft.context}</pre>
            </div>
            <div className="info-card info-card--wide">
              <span className="info-card__label">反馈内容</span>
              <textarea
                value={draft.feedbackText}
                onChange={(event) =>
                  setDraft((previous) =>
                    previous
                      ? { ...previous, feedbackText: event.target.value }
                      : previous,
                  )
                }
                rows={5}
                className="textarea"
                placeholder="描述问题、预期或其他上下文..."
              />
            </div>
            <div className="draft-actions">
              <button
                type="button"
                className="button button--primary"
                onClick={handleSubmitDraft}
                disabled={createFetcher.state !== "idle"}
              >
                {createFetcher.state === "submitting" ? "提交中..." : "提交反馈"}
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setDraft(null)}
              >
                放弃
              </button>
              <div className="draft-actions__status">
                {grabState?.isActive
                  ? "React Grab 已激活"
                  : "按住 ⌘ + Ctrl 进入拾取模式"}
              </div>
            </div>
          </div>
        ) : (
          <div className="placeholder">
            激活 React Grab 选择元素后，这里会展示上下文与输入框。
          </div>
        )}
        {errorMessage && <p className="error">{errorMessage}</p>}
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <p className="eyebrow">反馈列表</p>
            <h2>状态管理</h2>
          </div>
          <div className="filters">
            {(["ALL", ...STATUS_ORDER] as StatusFilter[]).map((filter) => (
              <Link
                key={filter}
                to={filter === "ALL" ? "/feedback" : `/feedback?status=${filter}`}
                className={`filter-button${
                  activeStatus === filter ? " filter-button--active" : ""
                }`}
              >
                {filter === "ALL" ? "全部" : STATUS_TEXT[filter]}
                <span className="filter-button__count">
                  {statusCounts[filter]}
                </span>
              </Link>
            ))}
          </div>
        </div>

        {filteredRecords.length === 0 ? (
          <div className="placeholder">暂无记录，提交后即可在此查看。</div>
        ) : (
          <div className="records">
            {filteredRecords.map((record) => (
              <article key={record.id} className="record">
                <header className="record__header">
                  <div>
                    <p className="record__label">{record.elementLabel}</p>
                    <h3 className="record__title">
                      {record.feedbackText.length > 60
                        ? `${record.feedbackText.slice(0, 60)}...`
                        : record.feedbackText}
                    </h3>
                  </div>
                  <span
                    className="status-pill"
                    style={{ color: STATUS_COLORS[record.status] }}
                  >
                    {STATUS_TEXT[record.status]}
                  </span>
                </header>
                <div className="record__meta">
                  <div>
                    <span>组件</span>
                    <strong>{record.componentName ?? "未识别"}</strong>
                  </div>
                  <div>
                    <span>页面</span>
                    <strong>{record.pageUrl}</strong>
                  </div>
                  <div>
                    <span>选择器</span>
                    <code>{record.selector}</code>
                  </div>
                  <div>
                    <span>更新时间</span>
                    <strong>{formatDateTime(record.updatedAt)}</strong>
                  </div>
                </div>
                <details className="record__context">
                  <summary>展开元素上下文</summary>
                  <pre>{record.context}</pre>
                </details>
                <div className="record__actions">
                  <label>
                    <span>状态切换</span>
                    <select
                      value={record.status}
                      onChange={(event) =>
                        handleStatusChange(
                          record.id,
                          event.target.value as FeedbackStatus,
                        )
                      }
                      disabled={
                        updateFetcher.state !== "idle" &&
                        pendingStatusId === record.id
                      }
                    >
                      {STATUS_ORDER.map((status) => (
                        <option key={status} value={status}>
                          {STATUS_TEXT[status]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => handleCopyRecord(record)}
                  >
                    复制给大模型
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {toast && <div className="toast">{toast}</div>}
      {navigation.state !== "idle" && (
        <div className="revalidating">数据刷新中…</div>
      )}
    </div>
  );
}
