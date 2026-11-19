
const GEMINI_MODEL = "gemini-2.5-flash";
const CLOUDFLARE_MODEL = "@cf/google/gemma-4-26b-a4b-it";

function reply(data, status = 200) {
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

function makeCompletion(text, provider) {
  return {
    id: "chatcmpl-" + crypto.randomUUID(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "abu-nemer-gpt",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: text
      },
      finish_reason: "stop"
    }],
    provider
  };
}

function getToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  return authorization.replace(/^\s*Bearer\s+/i, "").trim();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
        }
      });
    }

    if (url.pathname === "/health") {
      return reply({
        status: "running",
        name: "GPT أبو نمر 👑",
        providers: ["Gemini", "Cloudflare Workers AI"]
      });
    }

    const expectedToken = String(env.API_TOKEN || "").trim();
    const suppliedToken = getToken(request);

    if (!expectedToken || !suppliedToken ||
        suppliedToken !== expectedToken) {
      return reply({ error: "مفتاح الدخول غير صحيح" }, 401);
    }

    if (url.pathname === "/v1/models" && request.method === "GET") {
      return reply({
        object: "list",
        data: [{
          id: "abu-nemer-gpt",
          object: "model",
          owned_by: "abu-nemer"
        }]
      });
    }

    if (url.pathname !== "/v1/chat/completions" ||
        request.method !== "POST") {
      return reply({ error: "المسار غير موجود" }, 404);
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return reply({ error: "بيانات الطلب غير صحيحة" }, 400);
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return reply({ error: "messages مطلوبة" }, 400);
    }

    const systemPrompt = [
      "أنت GPT أبو نمر 👑، مساعد ذكي ومفيد ومحترم.",
      "أجب باللغة العربية افتراضياً وباللهجة السورية البسيطة عندما يناسب السياق.",
      "ساعد في البرمجة والتقنية والدين والرياضة والمعرفة العامة.",
      "اشرح للمبتدئين خطوة بخطوة وبوضوح.",
      "لا تخترع معلومات، وإذا لم تعرف الإجابة فقل ذلك بصراحة.",
      "لا تدّعِ تنفيذ أي إجراء لم تنفذه فعلاً."
    ].join(" ");

    const messages = [{
      role: "system",
      content: systemPrompt
    }];

    for (const msg of body.messages) {
      if (!msg || typeof msg.content !== "string") continue;

      if (msg.role === "system" || msg.role === "developer") {
        messages[0].content += "\n\n" + msg.content;
      } else if (msg.role === "user" || msg.role === "assistant") {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      }
    }

    if (!messages.some(msg => msg.role === "user")) {
      return reply({ error: "لا توجد رسالة مستخدم صالحة" }, 400);
    }

    const maxTokens = Number.isFinite(body.max_tokens)
      ? Math.max(1, Math.min(2048, body.max_tokens))
      : 1024;

    const temperature = Number.isFinite(body.temperature)
      ? Math.max(0, Math.min(2, body.temperature))
      : 0.7;

    // المحاولة الأولى: Gemini
    if (env.GEMINI_API_KEY) {
      try {
        const contents = messages
          .filter(msg => msg.role !== "system")
          .map(msg => ({
            role: msg.role === "assistant" ? "model" : "user",
            parts: [{ text: msg.content }]
          }));

        const upstream = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": env.GEMINI_API_KEY
            },
            body: JSON.stringify({
              contents,
              systemInstruction: {
                parts: [{ text: messages[0].content }]
              },
              generationConfig: {
                temperature,
                maxOutputTokens: maxTokens
              }
            }),
            signal: AbortSignal.timeout(25000)
          }
        );

        if (upstream.ok) {
          const result = await upstream.json();

          const answer = (
            result.candidates?.[0]?.content?.parts || []
          )
            .map(part => part.text || "")
            .join("");

          if (answer.trim()) {
            return reply(makeCompletion(answer, "Gemini"));
          }
        }
      } catch (error) {
        // الانتقال إلى المزوّد الاحتياطي
      }
    }

    // المحاولة الثانية: Cloudflare Workers AI
    if (env.AI) {
      try {
        const result = await env.AI.run(CLOUDFLARE_MODEL, {
          messages,
          temperature,
          max_completion_tokens: maxTokens
        });

        const answer =
          result?.choices?.[0]?.message?.content ||
          result?.response ||
          result?.result?.response ||
          "";

        if (typeof answer === "string" && answer.trim()) {
          return reply(makeCompletion(answer, "Cloudflare AI"));
        }
      } catch (error) {
        return reply({
          error: "تعذر الرد من Gemini وCloudflare حالياً",
          detail: String(error?.message || error).slice(0, 250)
        }, 503);
      }
    }

    return reply({
      error: "لم يتمكن أي مزوّد من الرد. تحقق من المفاتيح والحصص."
    }, 503);
  }
};
