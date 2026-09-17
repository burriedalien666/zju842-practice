// A single-flight outbox. Failures remain visible and recoverable after reload.
// 使用调用方提供的标签页独立存储；仅在用户明确选择时丢弃未保存内容。
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export class StudySaver {
  constructor({ send, storage, key, revision, onChange = () => {} }) {
    if (typeof revision !== "string" || !revision)
      throw new Error("保存协议版本不匹配，请重启本地服务并刷新页面");
    this.send = send;
    this.storage = storage;
    this.key = key;
    this.revision = revision;
    this.onChange = onChange;
    this.pending = null;
    this.error = null;
    this.running = null;
    this.durable = true;
  }
  get dirty() {
    return this.pending !== null;
  }
  readPending() {
    let value;
    try {
      value = this.storage.getItem(this.key);
    } catch {
      this.durable = false;
      return null;
    }
    if (!value) return null;
    const item = JSON.parse(value);
    if (
      !item ||
      item.version !== 1 ||
      typeof item.payload !== "string" ||
      typeof item.revision !== "string"
    )
      throw new Error("未保存记录的暂存文件格式不正确");
    return item;
  }
  restore(item, currentStudy) {
    if (
      JSON.stringify(canonical(JSON.parse(item.payload))) ===
      JSON.stringify(canonical(currentStudy))
    ) {
      this.checkpoint();
      return false; // The server committed but its response was interrupted.
    }
    const conflict = item.revision !== this.revision;
    this.pending = item.payload;
    this.revision = item.revision;
    this.error = Object.assign(
      new Error(
        conflict
          ? "磁盘记录已更新，请先导出本页记录再读取最新版本"
          : "已找回上次未写入磁盘的记录，请重试保存",
      ),
      { statusCode: conflict ? 409 : 0 },
    );
    this.onChange();
    return true;
  }
  checkpoint() {
    try {
      if (this.pending !== null)
        this.storage.setItem(
          this.key,
          JSON.stringify({
            version: 1,
            revision: this.revision,
            payload: this.pending,
          }),
        );
      else this.storage.removeItem(this.key);
      this.durable = true;
    } catch {
      this.durable = false;
    }
    this.onChange();
  }
  queue(study) {
    this.pending = JSON.stringify(study);
    this.checkpoint(); // Write before starting a request, never after it fails.
    return this.flush();
  }
  flush() {
    if (this.running) return this.running;
    if (!this.dirty || this.error) return Promise.resolve();
    // Defer execution so `running` is set even if send() throws synchronously.
    this.running = Promise.resolve()
      .then(async () => {
        while (this.dirty && !this.error) {
          const payload = this.pending;
          try {
            const result = await this.send(payload, this.revision);
            if (typeof result?.revision !== "string" || !result.revision)
              throw new Error("服务器未确认保存版本，请刷新后核对记录");
            this.revision = result.revision;
            if (this.pending === payload) this.pending = null;
            this.checkpoint();
          } catch (error) {
            this.error = error;
            this.checkpoint();
          }
        }
      })
      .finally(() => {
        this.running = null;
        this.onChange();
      });
    this.onChange();
    return this.running;
  }
  retry() {
    if (this.error?.statusCode === 409) return Promise.resolve();
    this.error = null;
    return this.flush();
  }
  reset(revision) {
    if (this.running) throw new Error("请等待当前保存结束");
    this.revision = revision;
    this.pending = null;
    this.error = null;
    this.checkpoint();
  }
}
