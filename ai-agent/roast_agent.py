#!/usr/bin/env python3
import json
import os
import sys
import urllib.error
import urllib.request


def fail(message: str, code: int = 1) -> None:
    print(message, file=sys.stderr)
    sys.exit(code)


def parse_roast(response_payload: dict) -> str:
    output_text = response_payload.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()

    for item in response_payload.get("output", []):
        if item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if content.get("type") == "output_text":
                text = (content.get("text") or "").strip()
                if text:
                    return text
    return ""


def main() -> None:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        fail("Missing OPENAI_API_KEY in environment.")

    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini").strip() or "gpt-4.1-mini"
    raw_payload = sys.stdin.read().strip() or "{}"

    try:
        payload = json.loads(raw_payload)
    except json.JSONDecodeError:
        fail("Invalid JSON passed to roast agent.")

    intent = str(payload.get("intent", "")).strip()
    tone = str(payload.get("tone", "spicy")).strip() or "spicy"

    if len(intent) < 8:
        fail("Intent is too short for roast generation.", code=2)

    system_prompt = (
        "You are a witty meetup planning assistant. Roast the user's plan in a playful, non-toxic way like Ricky gervais & Jimmy carr, "
        "then provide one sharper rewritten plan sentence they can accept. Keep it concise and practical."
    )
    user_prompt = (
        f"Tone: {tone}\n"
        f"User intent: {intent}\n\n"
        "Return exactly two lines:\n"
        "1) Roast: <funny roast>\n"
        "2) Upgrade: <improved one-sentence plan>"
    )

    request_body = json.dumps({
        "model": model,
        "temperature": 0.8,
        "max_output_tokens": 180,
        "input": [
            {"role": "system", "content": [{"type": "input_text", "text": system_prompt}]},
            {"role": "user", "content": [{"type": "input_text", "text": user_prompt}]}
        ]
    }).encode("utf-8")

    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=request_body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            response_json = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="ignore")
        fail(f"OpenAI HTTP error {error.code}: {details}")
    except urllib.error.URLError as error:
        fail(f"OpenAI request failed: {error.reason}")

    roast = parse_roast(response_json)
    if not roast:
        fail("OpenAI response did not contain roast text.")

    print(json.dumps({
        "roast": roast,
        "model": model
    }))


if __name__ == "__main__":
    main()
