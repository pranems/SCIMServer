const http = require("node:http");
const https = require("node:https");

function liveFetch(urlValue, options = {}) {
  const url = new URL(urlValue);
  const client = url.protocol === "https:" ? https : http;
  const timeoutMs = 10_000;

  return new Promise((resolve, reject) => {
    const request = client.request(url, {
      method: options.method ?? "GET",
      headers: options.headers ?? {},
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        const payload = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: response.statusCode ?? 0,
          headers: {
            get(name) {
              const value = response.headers[String(name).toLowerCase()];
              return Array.isArray(value) ? value.join(", ") : value ?? null;
            },
          },
          text: async () => payload,
          json: async () => payload ? JSON.parse(payload) : undefined,
        });
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });
    if (options.signal) {
      if (options.signal.aborted) {
        request.destroy(options.signal.reason);
      } else {
        options.signal.addEventListener("abort", () => request.destroy(options.signal.reason), {
          once: true,
        });
      }
    }
    request.on("error", reject);
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

module.exports = { liveFetch };
