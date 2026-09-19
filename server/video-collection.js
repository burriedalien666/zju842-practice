import { gunzipSync, brotliDecompressSync } from "node:zlib";
import { videoUrl } from "../src/curriculum.js";
import { resolveNetwork, requestHTTPS } from "./update-network.js";

// Parse public embedded JSON only; never evaluate script or import login cookies.
export function parsePublicCollection(html, inputUrl) {
  const marker = /(?:window\.)?__INITIAL_STATE__\s*=\s*/g.exec(html);
  if (!marker)
    throw new Error(
      "页面没有公开选集数据，可能需要验证或结构已变；请在浏览器核对公开链接列表",
    );
  const start = marker.index + marker[0].length;
  if (html[start] !== "{") throw new Error("公开页面数据格式不受支持");
  let depth = 0,
    quoted = false,
    escaped = false,
    end = -1;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  if (end === -1) throw new Error("公开页面数据不完整");
  const data = JSON.parse(html.slice(start, end)).videoData;
  if (
    !data ||
    typeof data.title !== "string" ||
    !Array.isArray(data.pages) ||
    !data.pages.length
  )
    throw new Error("无法识别公开视频目录");
  const sourceUrl = videoUrl(inputUrl);
  const bvid = new URL(sourceUrl).pathname.split("/").filter(Boolean)[1];
  if (data.bvid && data.bvid !== bvid)
    throw new Error("返回的视频与请求链接不一致");
  if (Number.isInteger(data.videos) && data.videos !== data.pages.length)
    throw new Error("页面分P目录不完整，不能作为完整选集导入");
  const items = [];
  if (data.pages.length > 1) {
    for (const p of data.pages) {
      if (
        !Number.isInteger(p.page) ||
        p.page !== items.length + 1 ||
        typeof p.part !== "string"
      )
        throw new Error("分P目录不完整");
      items.push({
        key: `${bvid}-p${p.page}`,
        title: p.part,
        url: videoUrl(`https://www.bilibili.com/video/${bvid}?p=${p.page}`),
      });
    }
  } else if (data.ugc_season?.sections?.length) {
    const season = data.ugc_season;
    for (const section of season.sections)
      for (const ep of section.episodes || []) {
        const bv = ep.bvid || ep.arc?.bvid;
        const pages = ep.pages || ep.arc?.pages;
        if (!bv || typeof ep.title !== "string")
          throw new Error("合集未暴露完整链接");
        if (Array.isArray(pages) && pages.length > 1)
          throw new Error("合集含多P子视频，请逐个读取以免漏掉分P");
        items.push({
          key: `${bv}-p1`,
          title: ep.title,
          url: videoUrl(`https://www.bilibili.com/video/${bv}`),
        });
      }
    if (season.ep_count && items.length !== season.ep_count)
      throw new Error("页面只有部分合集，不能按完整合集导入");
  } else
    items.push({
      key: `${bvid}-p1`,
      title: data.title,
      url: videoUrl(`https://www.bilibili.com/video/${bvid}`),
    });
  if (
    !items.length ||
    items.length > 5000 ||
    new Set(items.map((i) => i.key)).size !== items.length
  )
    throw new Error("选集为空、重复或超出上限");
  return {
    format: 1,
    title:
      data.pages.length > 1 ? data.title : data.ugc_season?.title || data.title,
    ...(data.owner?.name ? { author: data.owner.name } : {}),
    sourceUrl,
    items,
  };
}

export async function discoverPublicCollection(inputUrl) {
  const url = videoUrl(inputUrl);
  if (!/\/BV[a-zA-Z0-9]{10}/.test(new URL(url).pathname))
    throw new Error("请提供公开BV页；主页用于选择合集，不自动关联整个账号");
  const signal = AbortSignal.timeout(25000);
  const route = await resolveNetwork({ signal });
  const response = await requestHTTPS(url, {
    signal,
    proxyEnv: route.proxyEnv,
    headers: { "User-Agent": "Mozilla/5.0", "Accept-Encoding": "gzip, br" },
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(`B站返回${response.status}，请用浏览器核对；不会绕过验证`);
  }
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) throw new Error("视频页超过读取上限");
      chunks.push(chunk);
    }
  } catch (e) {
    await response.body?.cancel().catch(() => {});
    throw e;
  }
  let bytes = Buffer.concat(chunks);
  const encoding = response.headers.get("content-encoding");
  if (encoding === "gzip")
    bytes = gunzipSync(bytes, { maxOutputLength: 12 * 1024 * 1024 });
  else if (encoding === "br")
    bytes = brotliDecompressSync(bytes, { maxOutputLength: 12 * 1024 * 1024 });
  else if (encoding && encoding !== "identity")
    throw new Error("视频页压缩格式不支持");
  return parsePublicCollection(bytes.toString("utf8"), url);
}
