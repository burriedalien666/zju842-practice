import "./updates.css";
import { connectionFeedback } from "./local-connection.js";

const labels = {
  program: "程序更新",
  library: "题库更新",
  answers: "答案更新",
};
const descriptions = {
  program: "功能与修复。安装后自动重启，保留个人资料。",
  library: "试卷、题图和分类。不更改个人答案或公共答案。",
  answers: "作者发布的公共答案。不覆盖你的答案、草稿或复习记录。",
};
// Allow the server's 30-minute download budget plus installation/restart time.
const UPDATE_CONFIRM_TIMEOUT_MS = 32 * 60 * 1000;
export function createUpdateCenter({
  api,
  dialog,
  esc,
  toast,
  requireSaved,
  revision,
  verifyConnection = async () => {},
  reload = () => location.reload(),
  pollInterval = 1000,
}) {
  let state,
    error = "",
    checking = false,
    connectionError = null,
    polling = false;
  function explain(e) {
    const feedback = connectionFeedback(e);
    return feedback ? feedback.title + "。" + feedback.detail : e.message;
  }
  function hint() {
    const button = document.querySelector('[data-action="local-updates"]');
    const count = Object.values(state?.entries || {}).filter(
      (e) => e.available,
    ).length;
    if (button)
      button.textContent = connectionError
        ? "更新中心 · 本地连接待恢复"
        : count
          ? `更新中心 · ${count}项可更新`
          : "更新中心";
  }
  function showNotice(notice) {
    dialog(
      "更新完成 · " + labels[notice.kind],
      `<section id="update-complete"><p>已更新至 ${notice.kind === "program" ? "v" : "r"}${esc(notice.target)}</p><div class="update-notes">${esc(notice.notes)}</div><p class="small muted">个人资料保留，稍后可在更新中心回看。</p><button id="notice-dismiss" class="primary">知道了</button><p id="notice-error" role="alert"></p></section>`,
    );
    const d = document.querySelector("#dialog");
    const acknowledge = () =>
      api("/local/updates/ack", {
        method: "POST",
        body: JSON.stringify({ id: notice.id }),
      });
    const onClose = () => {
      void acknowledge().catch(() =>
        toast("本次说明暂未记为已读，可在更新中心回看"),
      );
    };
    d.addEventListener("close", onClose, { once: true });
    document.querySelector("#notice-dismiss").onclick = async (event) => {
      event.target.disabled = true;
      try {
        state = await acknowledge();
        d.removeEventListener("close", onClose);
        d.close();
      } catch (e) {
        document.querySelector("#notice-error").textContent = e.message;
        event.target.disabled = false;
      }
    };
  }
  function completedMarkup() {
    const current = state?.currentRelease;
    return `${current ? `<details><summary>当前程序 v${esc(current.version)} 更新了什么</summary><div class="update-notes">${esc(current.notes)}</div></details>` : ""}${(state?.notices || []).map((n) => `<details><summary>${esc(labels[n.kind])} ${esc(n.target)} · 最近更新内容</summary><div class="update-notes">${esc(n.notes)}</div></details>`).join("")}`;
  }
  function markup() {
    if (connectionError || !state)
      return `<section id="update-center"><h3>暂时无法打开更新中心</h3><p role="alert">${esc(error || "请重新检查本地连接")}</p><p>尚未确认当前更新进度。不会自动重试安装、刷新页面或清除未保存记录。</p><button id="update-reconnect">重新检查连接</button><button data-action="export">导出本页记录</button><p class="small muted">请保持题库启动窗口运行。离线刷题不需要互联网，但仍需要本机程序运行。</p></section>`;
    const job = state?.job,
      running = job && !["done", "failed"].includes(job.state);
    return `<section id="update-center"><p class="muted">三个版本分别更新，只有点击确认后才下载和安装。</p>
      <div class="update-tools"><label><input id="update-auto" type="checkbox" ${state?.settings.autoCheck ? "checked" : ""} ${running ? "disabled" : ""}> 启动时自动检查（仅提示）</label>
      <button id="update-check" ${checking || running ? "disabled" : ""}>${checking ? "正在检查…" : "检查更新"}</button></div>
      <p class="small muted">${state?.checkedAt ? "上次检查：" + esc(new Date(state.checkedAt).toLocaleString()) : "尚未检查新版"} · 关闭自动检查后仅手动联网</p>
      <p class="small muted">自动检查最多复用 6 小时缓存；上次检查结果不代表当前网络状态。点击“检查更新”会重新联网。</p>
      <div class="update-cards">${Object.entries(labels)
        .map(([kind, name]) => {
          const e = state?.entries[kind];
          return `<article class="update-card"><div><h3>${name}</h3><p>${descriptions[kind]}</p></div>
        <div class="update-version"><span>当前 ${kind === "program" ? "v" : "r"}${esc(e?.current ?? "—")}</span><span>${e?.target != null ? (e.available ? "可更新至 " : "发布版本 ") + (kind === "program" ? "v" : "r") + esc(e.target) : "未检查"}</span></div>
        ${e?.edition ? `<p class="small muted">${esc(e.edition)}</p>` : ""}
        ${e?.reason ? `<p class="small muted">${esc(e.reason)}</p>` : ""}
        <button data-update-kind="${kind}" class="${e?.available ? "primary" : ""}" ${!e?.available || e?.reason || running || checking ? "disabled" : ""}>${e?.available ? "查看并更新" : e?.target != null ? "无需更新" : "请先检查"}</button></article>`;
        })
        .join("")}</div>
      ${job ? `<div class="update-job" role="status"><strong>${esc(labels[job.kind])}：${esc(job.message)}</strong>${running && job.total ? `<progress value="${job.received}" max="${job.total}"></progress><span>${(job.received / 1048576).toFixed(1)} / ${(job.total / 1048576).toFixed(1)} MB</span>` : ""}</div>` : ""}
      <p id="update-error" role="alert">${esc(error)}</p>
      ${completedMarkup()}
      ${state?.lastResult ? `<p class="small muted">上次程序更新：${esc(state.lastResult.message)}</p>` : ""}
      <p class="small muted">下载仍需连接 GitHub；连接失败不影响离线刷题。程序内升级不会自动发布你的个人答案。</p>
      <p class="small"><a href="/api/local/updates/diagnostics" download="842-update-diagnostics.json">导出脱敏更新诊断（仅本地文件）</a></p>
      <details><summary>更新网络与手动恢复</summary><p>默认优先使用环境代理，否则读取 Windows/macOS 静态系统代理。PAC/WPAD、SOCKS 不会被悄悄改为直连。可在当前资料目录的 update-network.json 明确选择模式；请参照源码 docs/update-network.md 和 docs/old-version-recovery.md。不要发送代理密码或在运行中覆盖程序目录。</p></details>
      <a href="https://github.com/burriedalien666/zju842-practice/releases/latest" target="_blank" rel="noopener">备用：手动下载发布包</a></section>`;
  }
  function render(openDialog = false) {
    hint();
    if (
      !openDialog &&
      (!document.querySelector("#dialog")?.open ||
        !document.querySelector("#update-center"))
    )
      return;
    dialog("更新中心", markup(), true);
    const reconnect = document.querySelector("#update-reconnect");
    if (reconnect) {
      reconnect.onclick = async () => {
        reconnect.disabled = true;
        await open();
      };
      return;
    }
    document.querySelector("#update-check").onclick = () => check(false);
    document.querySelector("#update-auto").onchange = async (event) => {
      try {
        state = await api("/local/updates/settings", {
          method: "PUT",
          body: JSON.stringify({ autoCheck: event.target.checked }),
        });
        error = "";
      } catch (e) {
        error = explain(e);
      }
      render();
    };
    for (const button of document.querySelectorAll("[data-update-kind]"))
      button.onclick = () => confirm(button.dataset.updateKind);
  }
  async function check(automatic) {
    if (checking) return;
    checking = true;
    error = "";
    if (!automatic) render();
    try {
      state = await api("/local/updates/check", {
        method: "POST",
        body: JSON.stringify({ automatic }),
      });
      hint();
      if (automatic && Object.values(state.entries).some((e) => e.available))
        toast("发现新版本，可在“更新中心”选择更新");
    } catch (e) {
      error = explain(e);
    } finally {
      checking = false;
      render();
    }
  }
  async function poll(kind, target, started, requestId) {
    if (polling) return;
    polling = true;
    let disconnectedAt = 0;
    try {
      while (true) {
        await new Promise((r) => setTimeout(r, pollInterval));
        try {
          state = await api("/local/updates");
          disconnectedAt = 0;
        } catch {
          disconnectedAt ||= Date.now();
          if (Date.now() - disconnectedAt < 60000) continue;
          throw new Error(
            "暂时无法连接程序。请查看启动窗口；重新启动后会尝试恢复未完成的程序升级。",
          );
        }
        render();
        const ownJob =
          state.job &&
          (requestId
            ? state.job.requestId === requestId
            : state.job.kind === kind && state.job.target === target);
        if (ownJob && state.job.state === "failed") {
          toast(state.job.message);
          break;
        }
        if (
          kind === "program" &&
          state.lastResult?.at >= started &&
          !state.lastResult.ok
        ) {
          toast(state.lastResult.message);
          break;
        }
        if (
          (ownJob && state.job.state === "done") ||
          (kind === "program" && state.entries.program.current === target)
        ) {
          await requireSaved();
          reload();
          break;
        }
        if (Date.now() - started > UPDATE_CONFIRM_TIMEOUT_MS)
          throw new Error(
            "更新进度尚未确认，请重新打开更新中心查看；没有自动重新安装",
          );
        if (state.job && !ownJob && kind !== "program")
          throw new Error("当前显示的是其他更新任务，请重新检查版本");
        if (!state.job && kind !== "program")
          throw new Error("更新进程已结束，请重新检查版本");
        if (!state.job && kind === "program" && Date.now() - started > 120000)
          throw new Error("程序未确认升级完成，请重新检查版本");
      }
    } catch (e) {
      error = explain(e);
      render();
      toast(error);
    } finally {
      polling = false;
    }
  }
  function confirm(kind) {
    const entry = { ...state.entries[kind] };
    const requestId = crypto.randomUUID();
    let submitted = false;
    dialog(
      "确认" + labels[kind],
      `<div id="update-confirm"><p>${esc(descriptions[kind])}</p><p>${esc(entry.current)} → ${esc(entry.target)}</p>
      <p>${kind === "program" ? "请先关闭其他刷题标签页。确认后下载新版，保存备份并自动重启。旧程序和升级前备份会保留。" : "更新完成后将刷新页面；收藏、错题、题单和个人答案保留。"}</p>
      ${entry.notes ? `<details><summary>本次更新说明</summary><div class="update-notes">${esc(entry.notes)}</div></details>` : ""}
      <button id="confirm-update" class="primary">确认下载并${kind === "program" ? "重启" : "更新"}</button><button id="cancel-update">返回</button><p id="confirm-error" role="alert"></p></div>`,
    );
    document.querySelector("#cancel-update").onclick = () => render(true);
    document.querySelector("#confirm-update").onclick = async (event) => {
      event.target.disabled = true;
      let started = Date.now();
      try {
        await requireSaved();
        started = Date.now();
        submitted = true;
        state = await api("/local/updates/install", {
          method: "POST",
          headers: { "If-Match": revision() },
          body: JSON.stringify({ kind, target: entry.target, requestId }),
        });
        error = "";
        render(true);
        void poll(
          kind,
          entry.target,
          state.job?.startedAt || started,
          requestId,
        );
      } catch (e) {
        // An accepted install can outlive a lost HTTP response. Reconcile first;
        // retrying this confirmation reuses the same ID and cannot install twice.
        if (submitted) {
          try {
            const current = await api("/local/updates");
            if (current.job?.requestId === requestId) {
              state = current;
              error = "";
              render(true);
              void poll(
                kind,
                entry.target,
                current.job.startedAt || started,
                requestId,
              );
              return;
            }
          } catch {
            /* Keep the original error and all unsaved content. */
          }
        }
        const slot = document.querySelector("#confirm-error");
        if (slot) slot.textContent = explain(e);
        else {
          error = explain(e);
          render(true);
        }
        event.target.disabled = false;
      }
    };
  }
  async function open() {
    try {
      await verifyConnection();
      state = await api("/local/updates");
      connectionError = null;
      error = "";
      render(true);
      if (state.job && !["done", "failed"].includes(state.job.state))
        void poll(
          state.job.kind,
          state.job.target,
          state.job.startedAt || Date.now(),
          state.job.requestId,
        );
    } catch (e) {
      connectionError = e;
      error = explain(e);
      render(true);
    }
  }
  return {
    open,
    connectionChanged(next) {
      const changed =
        connectionError?.code !== next?.code ||
        connectionError?.statusCode !== next?.statusCode ||
        !!connectionError !== !!next;
      connectionError = next;
      if (next) error = explain(next);
      else if (changed) error = "连接已恢复，请重新检查更新以确认最新状态";
      hint();
      if (changed) render();
    },
    async automatic() {
      try {
        state = await api("/local/updates");
        hint();
        const notice = state.notices?.find((n) => !n.seen);
        if (notice && !document.querySelector("#dialog")?.open)
          showNotice(notice);
        if (state.settings.autoCheck) await check(true);
      } catch {
        /* Offline startup must not interrupt study or change saved preferences. */
      }
    },
  };
}
