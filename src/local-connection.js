export function connectionFeedback(error) {
  if (error?.code === "LOCAL_UNAVAILABLE")
    return {
      title: "本地题库服务暂不可用，暂时无法保存或更新",
      detail:
        "程序可能正在停止、重启或尚未就绪。请等待启动完成后重新检查连接；若服务已停止，请重新运行原启动器。不要先刷新或关闭本页，有未保存改动请先导出。",
    };
  if (error?.code === "LOCAL_CONNECTION")
    return {
      title: "本地题库服务已断开，暂时无法保存或更新",
      detail:
        "正在安装更新时请先等待自动重启；否则请重新双击原程序目录的“启动题库”，保持启动窗口运行，并在同一个浏览器打开启动器生成的页面。不要先刷新或关闭本页；有未保存改动请先导出。若新页面地址的端口不同，不要把两个地址当作同一服务。",
    };
  if (error?.statusCode === 401)
    return {
      title: "启动会话已失效，请从启动器重新打开",
      detail:
        "请在同一个浏览器打开启动器生成的新页面，再回到本页检查连接。仅重新输入旧网址不能建立会话；不要先刷新或关闭有未保存改动的页面。",
    };
  if (error?.code === "LOCAL_DIRECTORY")
    return {
      title: "当前连接的不是原资料目录",
      detail:
        "请启动原程序和资料目录，或先导出本页记录后在正确的页面导入。本页不会自动迁移记录。",
    };
  return null;
}

export async function requestApi(
  url,
  options = {},
  { local = false, onError = () => {} } = {},
) {
  let response;
  try {
    response = await fetch("/api" + url, {
      ...options,
      headers: {
        ...(options.body && !(options.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...options.headers,
      },
    });
  } catch (cause) {
    const error = local
      ? Object.assign(
          new Error(
            "本地题库服务未连接，请重新运行原程序目录的启动器；这不是 GitHub 下载失败",
          ),
          { code: "LOCAL_CONNECTION", cause },
        )
      : cause;
    onError(error);
    throw error;
  }
  // During graceful shutdown Fastify can return 503 before the socket closes.
  // This is a local lifecycle state, not a GitHub download failure.
  if (local && response.status === 503) {
    await response.body?.cancel();
    const error = Object.assign(
      new Error("本地题库服务暂不可用，请等待启动或重启完成后重试"),
      {
        code: "LOCAL_UNAVAILABLE",
        statusCode: 503,
      },
    );
    onError(error);
    throw error;
  }
  const data = await response.json();
  if (!response.ok) {
    const error = Object.assign(new Error(data.error || "操作失败"), {
      statusCode: response.status,
    });
    onError(error);
    throw error;
  }
  return data;
}

export function createLocalConnection({ readInfo, dataDir, onChange }) {
  let error = null,
    running = null;
  function report(next) {
    error = next;
    onChange(error);
  }
  return {
    get error() {
      return error;
    },
    failed(next) {
      if (connectionFeedback(next)) report(next);
    },
    check() {
      if (running) return running;
      running = Promise.resolve().then(async () => {
        try {
          const info = await readInfo();
          if (info.dataDir !== dataDir)
            throw Object.assign(new Error("当前服务使用了不同的资料目录"), {
              code: "LOCAL_DIRECTORY",
            });
          report(null);
          return true;
        } catch (next) {
          report(next);
          return false;
        } finally {
          running = null;
        }
      });
      return running;
    },
  };
}
