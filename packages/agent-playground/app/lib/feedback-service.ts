const STORAGE_KEY = "react-grab:feedback-records";
const LATENCY_MS = 300;

export type FeedbackStatus =
  | "pending"
  | "in_progress"
  | "resolved"
  | "invalid";

export interface FeedbackRecord {
  id: string;
  status: FeedbackStatus;
  elementLabel: string;
  selector: string;
  tagName: string;
  textPreview: string;
  context: string;
  pageUrl: string;
  htmlPreview: string;
  feedbackText: string;
  componentName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackCreateInput {
  elementLabel: string;
  selector: string;
  tagName: string;
  textPreview: string;
  context: string;
  pageUrl: string;
  htmlPreview: string;
  feedbackText: string;
  componentName?: string | null;
}

const readFromStorage = (): FeedbackRecord[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as FeedbackRecord[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
};

const persist = (records: FeedbackRecord[]): void => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
};

const withLatency = async <T>(payload: T): Promise<T> => {
  await new Promise((resolve) => {
    setTimeout(resolve, LATENCY_MS);
  });
  return payload;
};

const createId = (): string => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `fbk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

export const feedbackService = {
  list: async (): Promise<FeedbackRecord[]> => {
    const records = readFromStorage();
    records.sort(
      (first, second) =>
        new Date(second.createdAt).getTime() -
        new Date(first.createdAt).getTime(),
    );
    return withLatency(records);
  },
  create: async (
    input: FeedbackCreateInput,
  ): Promise<FeedbackRecord> => {
    const timestamp = new Date().toISOString();
    const record: FeedbackRecord = {
      id: createId(),
      status: "pending",
      createdAt: timestamp,
      updatedAt: timestamp,
      ...input,
    };
    const records = readFromStorage();
    persist([record, ...records]);
    return withLatency(record);
  },
  updateStatus: async (
    id: string,
    status: FeedbackStatus,
  ): Promise<FeedbackRecord | null> => {
    const records = readFromStorage();
    const index = records.findIndex((record) => record.id === id);
    if (index === -1) {
      return withLatency(null);
    }
    const updated: FeedbackRecord = {
      ...records[index],
      status,
      updatedAt: new Date().toISOString(),
    };
    records[index] = updated;
    persist(records);
    return withLatency(updated);
  },
};
