const MODEL = "gemini-2.5-flash";

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/health") {
      return response({
        status: "running",
        name: "GPT أبو نمر 👑"
      });
    }

    if (!env.API_TOKEN ||
        request.headers.get("Authorization") !== `Bearer ${env.API_TOKEN}`) {
      return response({ error: "مفتاح الدخول غير صحيح" }, 401);
    }

    if (url.pathname === "/v1/models") {
      return response({
        object: "list",
        data: [{ id: "abu-nemer-gpt", object: "model" }]
      });
    }

    if (url.pathname !== "/v1/chat/completions" ||
        request.method !== "POST") {
      return response({ error: "المسار غير موجود" }, 404);
    }

    if (!env.GEMINI_API_KEY) {
      return response({ error: "مفتاح Gemini غير مضبوط" }, 503);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return response({ error: "بيانات الطلب غير صحيحة" }, 400);
    }

    if (!Array.isArray(body.messages)) {
      return response({ error: "messages مطلوبة" }, 400);
    }

    const system = [];
    const contents = [];

    for (const msg of body.messages) {
      if (!msg || typeof msg.content !== "string") continue;

      if (msg.role === "system" || msg.role === "developer") {
        system.push(msg.content);
      } else if (msg.role === "user") {
        contents.push({
          role: "user",
          parts: [{ text: msg.content }]
        });
      } else if (msg.role === "assistant") {
        contents.push({
          role: "model",
          parts: [{ text: msg.content }]
        });
      }
    }

    if (!contents.length) {
      return response({ error: "لا توجد رسالة صالحة" }, 400);
    }

    const model = env.GEMINI_MODEL || MODEL;
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

    const payload = { contents };

    if (system.length) {
      payload.systemInstruction = {
        parts: [{ text: system.join("\n\n") }]
      };
    }

    if (Number.isFinite(body.temperature)) {
      payload.generationConfig = {
        temperature: Math.max(0, Math.min(2, body.temperature))
      };
    }

    let result;

    try {
      const upstream = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      result = await upstream.json();

      if (!upstream.ok) {
        return response({
          error: result.error?.message || "خطأ من Gemini"
        }, 502);
      }
    } catch {
      return response({ error: "تعذر الاتصال بـ Gemini" }, 502);
    }

    const answer = (result.candidates?.[0]?.content?.parts || [])
      .map(part => part.text || "")
      .join("");

    return response({
      id: "chatcmpl-" + crypto.randomUUID(),
      object: "chat.completion",
      model: "abu-nemer-gpt",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: answer || "لم يصل رد من Gemini"
        },
        finish_reason: "stop"
      }]
    });
  }
};
