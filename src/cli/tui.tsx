import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import path from "node:path";
import { executeTask } from "./run-task.js";
import { loadConfig, saveProjectConfig } from "../config/loader.js";
import type { AlexusConfig } from "../config/schema.js";
import type { AlexusEvent, EventSink } from "../protocol/events.js";
import type {
  ApprovalPrompt,
  ApprovalRequest,
  ApprovalResponse,
} from "../security/approval-manager.js";
import { SessionStore } from "../sessions/sqlite-store.js";
import { PACKAGE_VERSION } from "../utils/version.js";

interface ToolView {
  id: string;
  name: string;
  status: "requested" | "running" | "completed" | "failed" | "reused";
  durationMs?: number;
  arguments?: unknown;
  error?: string;
}

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (response: ApprovalResponse) => void;
}

interface ComposerProps {
  active: boolean;
  onSubmit: (value: string) => void;
}

function Composer({ active, onSubmit }: ComposerProps): React.ReactElement {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);

  useInput(
    (input, key) => {
      if (key.return) {
        if (key.shift) {
          setValue((current) => `${current.slice(0, cursor)}\n${current.slice(cursor)}`);
          setCursor((current) => current + 1);
        } else if (value.trim()) {
          onSubmit(value.trim());
          setValue("");
          setCursor(0);
        }
        return;
      }
      if (key.backspace || key.delete) {
        if (cursor > 0) {
          setValue((current) => current.slice(0, cursor - 1) + current.slice(cursor));
          setCursor((current) => current - 1);
        }
        return;
      }
      if (key.leftArrow) return setCursor((current) => Math.max(0, current - 1));
      if (key.rightArrow) return setCursor((current) => Math.min(value.length, current + 1));
      if (key.ctrl && input === "a") return setCursor(0);
      if (key.ctrl && input === "e") return setCursor(value.length);
      if (input && !key.ctrl && !key.meta) {
        setValue((current) => current.slice(0, cursor) + input + current.slice(cursor));
        setCursor((current) => current + input.length);
      }
    },
    { isActive: active },
  );

  const before = value.slice(0, cursor);
  const current = value[cursor] ?? " ";
  const after = value.slice(cursor + (cursor < value.length ? 1 : 0));
  return (
    <Box borderStyle="round" borderColor={active ? "cyan" : "gray"} paddingX={1}>
      <Text color="cyan">› </Text>
      <Text>{before}</Text>
      <Text inverse={active}>{current === "\n" ? "↵" : current}</Text>
      <Text>{after}</Text>
    </Box>
  );
}

function updateTool(tools: ToolView[], id: string, patch: Partial<ToolView>): ToolView[] {
  return tools.map((tool) => (tool.id === id ? { ...tool, ...patch } : tool));
}

function AlexusTui({ workspaceRoot }: { workspaceRoot: string }): React.ReactElement {
  const { exit } = useApp();
  const [config, setConfig] = useState<AlexusConfig>();
  const [busy, setBusy] = useState(false);
  const [assistant, setAssistant] = useState("");
  const [tools, setTools] = useState<ToolView[]>([]);
  const [notice, setNotice] = useState("Pronto. /help mostra i comandi disponibili.");
  const [verification, setVerification] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  const [approval, setApproval] = useState<PendingApproval>();
  const abortRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    void loadConfig(workspaceRoot)
      .then(setConfig)
      .catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : String(error));
      });
  }, [workspaceRoot]);

  const eventSink: EventSink = useCallback((value: AlexusEvent) => {
    if (value.type === "assistant.delta" && typeof value.text === "string") {
      const delta = value.text;
      setAssistant((current) => `${current}${delta}`);
    }
    if (value.type === "tool.requested")
      setTools((current) => [
        ...current,
        {
          id: String(value.toolCallId),
          name: String(value.tool),
          status: "requested",
          arguments: value.arguments,
        },
      ]);
    if (value.type === "tool.started")
      setTools((current) => updateTool(current, String(value.toolCallId), { status: "running" }));
    if (value.type === "tool.completed")
      setTools((current) =>
        updateTool(current, String(value.toolCallId), {
          status: value.success ? "completed" : "failed",
          durationMs: Number(value.durationMs ?? 0),
          ...(typeof value.error === "string" ? { error: value.error } : {}),
        }),
      );
    if (value.type === "tool.reused")
      setTools((current) => updateTool(current, String(value.toolCallId), { status: "reused" }));
    if (
      value.type === "session.completed" &&
      (value.verification === "verified" ||
        value.verification === "partial" ||
        value.verification === "unverified")
    )
      setVerification(value.verification);
  }, []);

  const approvalPrompt: ApprovalPrompt = useCallback(
    (request) => new Promise((resolve) => setApproval({ request, resolve })),
    [],
  );

  const answerApproval = useCallback(
    (response: ApprovalResponse) => {
      approval?.resolve(response);
      setApproval(undefined);
    },
    [approval],
  );

  useInput((input, key) => {
    if (approval) {
      if (input === "y") answerApproval("once");
      if (input === "a") answerApproval("session");
      if (input === "n" || key.escape || (key.ctrl && input === "c")) answerApproval("deny");
      return;
    }
    if (key.ctrl && input === "o") setExpanded((current) => !current);
    if (key.ctrl && input === "c") {
      if (busy) abortRef.current?.abort();
      else exit();
    }
  });

  const showDiff = useCallback(async () => {
    const store = new SessionStore(workspaceRoot);
    try {
      const session = store.latest();
      setNotice(
        session ? (await store.diff(session.id)) || "Nessuna modifica." : "Nessuna sessione.",
      );
    } finally {
      store.close();
    }
  }, [workspaceRoot]);

  const runSlashCommand = useCallback(
    async (input: string): Promise<boolean> => {
      const [command, ...parts] = input.split(/\s+/);
      if (command === "/exit" || command === "/quit") {
        exit();
        return true;
      }
      if (command === "/clear") {
        setAssistant("");
        setTools([]);
        setNotice("Schermata pulita.");
        return true;
      }
      if (command === "/help") {
        setNotice(
          "/status  /model  /permissions <mode>  /diff  /undo  /sessions  /plan <task>  /goal <task>  /clear  /exit\nCtrl+O dettagli tool · Ctrl+C annulla/esce · Shift+Enter nuova riga",
        );
        return true;
      }
      if (command === "/status" || command === "/model") {
        const current = await loadConfig(workspaceRoot);
        setConfig(current);
        setNotice(
          `Model: ${current.model}\nMode: ${current.approvalMode}\nMax steps: ${current.maxSteps}`,
        );
        return true;
      }
      if (command === "/permissions") {
        const mode = parts[0];
        if (mode !== "readonly" && mode !== "workspace" && mode !== "full-access") {
          setNotice("Uso: /permissions readonly|workspace|full-access");
          return true;
        }
        const current = await loadConfig(workspaceRoot);
        const updated: AlexusConfig = { ...current, approvalMode: mode };
        await saveProjectConfig(workspaceRoot, updated);
        setConfig(updated);
        setNotice(`Permessi impostati su ${mode}.`);
        return true;
      }
      if (command === "/diff") {
        await showDiff();
        return true;
      }
      if (command === "/sessions") {
        const store = new SessionStore(workspaceRoot);
        try {
          setNotice(
            store
              .list()
              .slice(0, 10)
              .map((session) => `${session.id}  ${session.status}  ${session.task}`)
              .join("\n") || "Nessuna sessione.",
          );
        } finally {
          store.close();
        }
        return true;
      }
      if (command === "/undo") {
        const store = new SessionStore(workspaceRoot);
        try {
          const session = store.latest();
          setNotice(
            session
              ? `Ripristinati: ${(await store.undo(session.id)).join(", ") || "nessun file"}`
              : "Nessuna sessione.",
          );
        } finally {
          store.close();
        }
        return true;
      }
      return false;
    },
    [exit, showDiff, workspaceRoot],
  );

  const submit = useCallback(
    async (rawInput: string) => {
      if (busy) return;
      try {
        if (rawInput.startsWith("/") && (await runSlashCommand(rawInput))) return;
        const isPlan = rawInput.startsWith("/plan ");
        const isGoal = rawInput.startsWith("/goal ");
        const task = isPlan
          ? `Crea soltanto un piano dettagliato senza modificare file: ${rawInput.slice(6)}`
          : isGoal
            ? `Completa autonomamente questo obiettivo e verificane i criteri di riuscita: ${rawInput.slice(6)}`
            : rawInput;
        setBusy(true);
        setAssistant("");
        setTools([]);
        setVerification(undefined);
        setNotice(
          isPlan ? "Pianificazione in corso…" : isGoal ? "Obiettivo in corso…" : "Task in corso…",
        );
        const controller = new AbortController();
        abortRef.current = controller;
        const result = await executeTask(workspaceRoot, task, {
          embedded: true,
          eventSink,
          approvalPrompt,
          signal: controller.signal,
          ...(isPlan ? { approvalMode: "readonly" as const } : {}),
        });
        setNotice(`Sessione ${result.sessionId} completata in ${result.steps} step.`);
        setVerification(result.verification);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        abortRef.current = undefined;
        setBusy(false);
      }
    },
    [approvalPrompt, busy, eventSink, runSlashCommand, workspaceRoot],
  );

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          Alexus CLI v{PACKAGE_VERSION}
        </Text>
        <Text dimColor>{config?.model ?? "caricamento…"}</Text>
      </Box>
      <Text dimColor>
        {path.basename(workspaceRoot)} · {config?.approvalMode ?? "…"}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {assistant ? <Text>{assistant.slice(-5000)}</Text> : null}
        {tools.map((tool) => (
          <Box key={tool.id} flexDirection="column">
            <Text
              color={
                tool.status === "failed"
                  ? "red"
                  : tool.status === "completed" || tool.status === "reused"
                    ? "green"
                    : "yellow"
              }
            >
              {tool.status === "running" ? (
                <Spinner type="dots" />
              ) : tool.status === "failed" ? (
                "✗"
              ) : tool.status === "completed" || tool.status === "reused" ? (
                "✓"
              ) : (
                "→"
              )}{" "}
              {tool.name} {tool.durationMs !== undefined ? `${tool.durationMs} ms` : ""}
            </Text>
            {expanded ? (
              <Text dimColor>
                {JSON.stringify(tool.arguments, null, 2)}
                {tool.error ? `\n${tool.error}` : ""}
              </Text>
            ) : null}
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        {busy ? (
          <Text color="yellow">
            <Spinner type="dots" /> Alexus sta lavorando
          </Text>
        ) : null}
        {verification ? (
          <Text color={verification === "verified" ? "green" : "yellow"}>
            {" "}
            {verification.toUpperCase()}
          </Text>
        ) : null}
      </Box>
      <Box marginY={1}>
        <Text dimColor>{notice}</Text>
      </Box>
      {approval ? (
        <Box borderStyle="double" borderColor="yellow" paddingX={1} flexDirection="column">
          <Text bold>
            Approvazione richiesta: {approval.request.command} {approval.request.args.join(" ")}
          </Text>
          <Text>
            {approval.request.reason} · rischio {approval.request.risk}
          </Text>
          <Text>[y] una volta [a] sessione [n] rifiuta</Text>
        </Box>
      ) : (
        <Composer active={!busy} onSubmit={(value) => void submit(value)} />
      )}
    </Box>
  );
}

export async function startTui(workspaceRoot: string): Promise<void> {
  const instance = render(<AlexusTui workspaceRoot={workspaceRoot} />);
  await instance.waitUntilExit();
}
