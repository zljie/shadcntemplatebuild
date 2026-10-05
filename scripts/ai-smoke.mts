// Real-model smoke test of the chat→page agent (reads .env.local / env).
// Usage: npx tsx --env-file=.env.local scripts/ai-smoke.mts "生成一个订单管理页面…"
import { runPageAgent } from "../src/ai/page-agent";
import { getProvider } from "../src/llm/registry";
import { createDocument } from "../src/core/document";

const prompt =
  process.argv[2] ??
  "生成一个订单管理页面：订单号、客户、金额、状态（待支付/已支付/已取消），支持搜索订单号和客户、按状态筛选，可新增和编辑";
const started = Date.now();
const result = await runPageAgent({
  provider: getProvider(),
  messages: [{ role: "user", content: prompt }],
  document: createDocument(),
  onEvent: (e) => {
    if (e.type !== "progress" && e.type !== "reasoning")
      console.error("[event]", JSON.stringify(e).slice(0, 400));
  },
});
console.error(
  `done in ${((Date.now() - started) / 1000).toFixed(1)}s, attempts=${result.attempts}, mode=${result.mode}, usage=${JSON.stringify(result.usage)}`,
);
console.log(
  JSON.stringify(
    {
      reply: result.reply,
      name: result.document.name,
      listDetail: result.document.listDetail,
      nodes: result.document.root.map((r) =>
        r.slots.children.map((c) => c.componentRef),
      ),
    },
    null,
    2,
  ),
);
