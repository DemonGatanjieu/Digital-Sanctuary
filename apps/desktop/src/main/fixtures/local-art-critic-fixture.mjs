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
        choices: [{ message: { content: JSON.stringify({ dimensions, summary: "本地测试解读" }) } }],
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
