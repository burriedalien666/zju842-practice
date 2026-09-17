import "./updates.css";

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
export function createUpdateCenter({
  api,
  dialog,
  esc,
  toast,
  requireSaved,
  revision,
}) {
  let state,
    error = "",
    checking = false,
    polling = false;
  function hint() {
    const button = document.querySelector('[data-action="local-updates"]');
    const count = Object.values(state?.entries || {}).filter(
      (e) => e.available,
    ).length;
    if (button)
      button.textContent = count ? `更新中心 · ${count}项可更新` : "更新中心";
  }
  function markup() {
    const job = state?.job,
      running = job && !["done", "failed"].includes(job.state);
    return `<section id="update-center"><p class="muted">三个版本分别更新，只有点击确认后才下载和安装。</p>
      <div class="update-tools"><label><input id="update-auto" type="checkbox" ${state?.settings.autoCheck ? "checked" : ""} ${running ? "disabled" : ""}> 启动时自动检查（仅提示）</label>
      <button id="update-check" ${checking || running ? "disabled" : ""}>${checking ? "正在检查…" : "检查更新"}</button></div>
      <p class="small muted">${state?.checkedAt ? "上次检查：" + esc(new Date(state.checkedAt).toLocaleString()) : "尚未检查新版"} · 关闭自动检查后仅手动联网</p>
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
      ${state?.lastResult ? `<p class="small muted">上次程序更新：${esc(state.lastResult.message)}</p>` : ""}
      <p class="small muted">下载仍需连接 GitHub；连接失败不影响离线刷题。程序内升级不会自动发布你的个人答案。</p>
      <a href="https://github.com/burriedalien666/zju842-practice/releases/latest" target="_blank" rel="noopener">备用：手动下载发布包</a></section>`;
  }
  function render(open = false) {
    hint();
    if (
      !open &&
      (!document.querySelector("#dialog")?.open ||
        !document.querySelector("#update-center"))
    )
      return;
    dialog("更新中心", markup(), true);
    document.querySelector("#update-check").onclick = () => check(false);
    document.querySelector("#update-auto").onchange = async (event) => {
      try {
        state = await api("/local/updates/settings", {
          method: "PUT",
          body: JSON.stringify({ autoCheck: event.target.checked }),
        });
        error = "";
      } catch (e) {
        error = e.message;
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
      error = e.message;
    } finally {
      checking = false;
      if (!automatic) render();
    }
  }
  async function poll(kind, target, started) {
    if (polling) return;
    polling = true;
    let disconnectedAt = 0;
    try {
      while (true) {
        await new Promise((r) => setTimeout(r, 1000));
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
        if (state.job?.state === "failed") {
          toast(state.job.message);
          break;
        }
        if (state.lastResult?.at >= started && !state.lastResult.ok) {
          toast(state.lastResult.message);
          break;
        }
        if (
          state.job?.state === "done" ||
          (kind === "program" && state.entries.program.current === target)
        ) {
          await requireSaved();
          location.reload();
          break;
        }
        if (!state.job && kind !== "program")
          throw new Error("更新进程已结束，请重新检查版本");
        if (!state.job && kind === "program" && Date.now() - started > 120000)
          throw new Error("程序未确认升级完成，请重新检查版本");
      }
    } catch (e) {
      error = e.message;
      render();
      toast(error);
    } finally {
      polling = false;
    }
  }
  function confirm(kind) {
    const entry = state.entries[kind];
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
      try {
        await requireSaved();
        const started = Date.now();
        state = await api("/local/updates/install", {
          method: "POST",
          headers: { "If-Match": revision() },
          body: JSON.stringify({ kind, target: entry.target }),
        });
        error = "";
        render(true);
        void poll(kind, entry.target, started);
      } catch (e) {
        document.querySelector("#confirm-error").textContent = e.message;
        event.target.disabled = false;
      }
    };
  }
  return {
    async open() {
      try {
        state = await api("/local/updates");
        render(true);
        if (state.job && !["done", "failed"].includes(state.job.state))
          void poll(state.job.kind, state.job.target, Date.now());
      } catch (e) {
        toast(e.message);
      }
    },
    async automatic() {
      try {
        state = await api("/local/updates");
        hint();
        if (state.settings.autoCheck) await check(true);
      } catch {
        /* Offline startup must not interrupt study or change saved preferences. */
      }
    },
  };
}
