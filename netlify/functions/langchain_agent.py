"""Optional LangChain runtime endpoint for Manus Remix."""
import json
import os


def handler(event, context):
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Vary": "Origin",
    }
    method = event.get("httpMethod", "GET").upper()
    if method == "OPTIONS":
        return {"statusCode": 204, "headers": headers, "body": ""}
    if method != "POST":
        return {"statusCode": 405, "headers": headers, "body": json.dumps({"error": "Use POST."})}

    if not os.environ.get("OPENAI_API_KEY"):
        return {
            "statusCode": 503,
            "headers": headers,
            "body": json.dumps({"error": "LangChain runtime is not configured. Set OPENAI_API_KEY in server-side environment variables."}),
        }

    try:
        payload = json.loads(event.get("body") or "{}")
        prompt = payload.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            return {"statusCode": 400, "headers": headers, "body": json.dumps({"error": "A non-empty prompt is required."})}
        if len(prompt) > 20000:
            return {"statusCode": 413, "headers": headers, "body": json.dumps({"error": "Prompt is too long (20,000 character limit)."})}

        from langchain.chat_models import init_chat_model
        model_name = os.environ.get("LANGCHAIN_MODEL", "openai:gpt-4.1-mini")
        model = init_chat_model(model_name)
        result = model.invoke(prompt.strip())
        content = getattr(result, "content", str(result))
        if not isinstance(content, str):
            content = json.dumps(content, ensure_ascii=False, default=str)
        return {"statusCode": 200, "headers": headers, "body": json.dumps({"text": content, "provider": "langchain", "model": model_name}, ensure_ascii=False)}
    except Exception:
        return {"statusCode": 502, "headers": headers, "body": json.dumps({"error": "LangChain request failed. Check server-side model configuration and function logs."})}
