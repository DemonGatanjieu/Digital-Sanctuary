import http from "node:http";

const port = Number(process.argv[2]);
const server = http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"status":"ok"}');
    return;
  }
  if (request.url === "/v1/chat/completions" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const requestBody = JSON.parse(body);
      if (!requestBody?.response_format) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { content: "我看到了参考图，也收到了你的创作要求。" } }] }));
        return;
      }
      if (requestBody.response_format?.type !== "json_object" || !requestBody.response_format?.schema) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end('{"error":"missing structured schema"}');
        return;
      }
      const adaptive = body.includes("恰好六个");
      const dimensions = adaptive
        ? ["story_staging", "palette_air", "line_rhythm", "material_touch", "character_warmth", "detail_echo"].map((key, index) => ({
            key,
            label: `自选维度${index + 1}`,
            score: 70 + index,
            reason: "可见画面证据"
          }))
        : [];
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          observation: "画面中央有一位角色，背景以蓝色为主。",
          visual_focus: ["角色面部", "蓝色背景"],
          interpretation: "冷色调可能营造出安静的感觉。",
          uncertainty: ["无法确认角色身份"],
          dimensions,
          summary: "本地测试解读"
        }) } }],
        usage: { prompt_tokens: 20, completion_tokens: 30 }
      }));
    });
    return;
  }
  response.writeHead(404);
  response.end();
});

server.listen(port, "127.0.0.1");
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => process.exit(0)));
