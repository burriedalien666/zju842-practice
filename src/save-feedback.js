export function saveFeedback(saver) {
  const error = saver.error;
  if (!error)
    return {
      title: saver.dirty ? "正在保存到本机…" : "已保存到本机",
      detail: "",
      retry: false,
    };
  const staged = saver.durable
    ? "本页改动仍暂存在当前标签页；关闭前请先保存或导出。"
    : "浏览器暂存也不可用，请立即导出本页记录。";
  if (
    error.code === "LOCAL_CONNECTION" ||
    /Failed to fetch|NetworkError|Load failed/i.test(error.message)
  )
    return {
      title: "与本地题库的连接已断开，改动尚未保存",
      detail:
        "请重新运行题库启动器，打开它生成的新页面，再回到本页点击“重试保存”。" +
        staged,
      retry: true,
    };
  if (error.statusCode === 401)
    return {
      title: "本地启动会话已失效，改动尚未保存",
      detail:
        "服务可能已经重启。请打开启动器生成的新页面，再回到本页重试；不要先刷新或关闭本页。" +
        staged,
      retry: true,
    };
  if (error.statusCode === 409)
    return {
      title: "记录有冲突，本页尚未覆盖磁盘记录",
      detail: "先导出本页记录，再核对其他标签页的修改。" + staged,
      retry: false,
    };
  return {
    title: "本页改动尚未保存到本机",
    detail: error.message + "。" + staged,
    retry: true,
  };
}
