import { createServer } from "node:http";

// Native Chromium downloads may retry outside Playwright's page routing. Serve
// real attachment bytes behind Vite's same-origin proxy for all three engines.
const path = "/api/v1/sat-answered-pdf/downloads/0123456789abcdef0123456789abcdef";
const pdf = Buffer.from("%PDF-1.7\n%%EOF\n");
createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200).end("ready");
  } else if (request.url === path && (request.method === "GET" || request.method === "HEAD")) {
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
      "Content-Disposition":
        'attachment; filename="Mina Chen - SAT Practice 04 - Answered exam.pdf"',
      "Cache-Control": "private, no-store",
    });
    response.end(request.method === "HEAD" ? undefined : pdf);
  } else {
    response.writeHead(404).end();
  }
}).listen(Number(process.env.SAT_PRINT_E2E_API_PORT ?? "33171"), "127.0.0.1");
