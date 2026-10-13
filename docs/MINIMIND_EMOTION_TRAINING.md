# MiniMind Emotion, Empathy, and Reasoning Training Plan

This integration adds a reproducible **training pipeline plan** for Manus Remix using the upstream [MiniMind](https://github.com/jingyaogong/minimind) research implementation. It does not claim to copy ChatGPT's weights or instantly make a small model equivalent to a frontier model.

## Goals

- Improve helpfulness, instruction following, reasoning discipline, conversational continuity, and emotionally aware responses.
- Teach the model to recognize expressed emotion from text and respond with empathy without pretending to literally feel emotions or diagnosing users.
- Keep the existing Manus Remix UI and production inference provider unchanged until an evaluated fine-tuned model is explicitly configured.
- Keep training workloads separate from Netlify serverless functions; train on a GPU machine/Colab, store artifacts securely, and deploy inference to a suitable model-serving host.

## Architecture

1. **Dataset preparation:** JSONL examples with `messages` in chat format; remove secrets and personally identifying data, deduplicate, validate role order, and split train/validation sets.
2. **Supervised fine-tuning (SFT):** start from a compatible MiniMind checkpoint/configuration and train on high-quality assistant conversations, empathy examples, factual QA, tool-use examples, refusals, and multi-turn follow-ups.
3. **Evaluation:** compare the base and tuned checkpoints on held-out instruction following, factuality, emotional-context recognition, harmful-content handling, hallucination rate, and latency. Do not evaluate only on training examples.
4. **Optional preference optimization:** only after SFT and evaluation, use curated preference pairs with a compatible MiniMind training recipe. Never optimize for flattery, manipulation, or emotional dependency.
5. **Serving:** export the tested checkpoint and serve it behind an authenticated inference API. Manus Remix calls it only when `MINIMIND_INFERENCE_URL` is configured; keep API keys server-side. Do not load model weights inside Netlify Functions.

## Dataset format

Each line is one JSON object:

```json
{"messages":[{"role":"user","content":"I failed my exam and feel disappointed."},{"role":"assistant","content":"That sounds disappointing. One exam doesn't define your ability. Want to review what felt hardest and make a practical plan?"}]}
```

Use diverse, consented or appropriately licensed data. Include examples where the best response is to ask a clarifying question, admit uncertainty, correct a mistake, or encourage reaching out to a trusted person. Avoid fabricated personal memories and claims that the AI has human feelings.

## Training setup

1. Review the upstream MiniMind README and select a model size and training recipe that match available hardware.
2. Clone the upstream project in a separate training workspace; do not vendor its entire repository into the web app.
3. Create a virtual environment and install the exact dependencies documented upstream.
4. Prepare `data/emotion_sft.jsonl`, validate it, and map it to the dataset format expected by the chosen MiniMind training script.
5. Run the upstream pre-training/SFT entry point with a small smoke-test subset first, then a full run on an available GPU. The exact script/flags vary by upstream revision, so verify them against that checkout rather than relying on guessed commands.
6. Save checkpoints outside the web repository; version the dataset manifest, hyperparameters, evaluation results, and model license.
7. Run the evaluation gate before deploying. Keep the current provider as fallback and add a feature flag for gradual rollout.

## Safety and quality gates

- No training on private conversations without valid permission and an appropriate data policy.
- Strip credentials, access tokens, phone numbers, addresses, and other sensitive data.
- Split by conversation/source before train-validation splitting to reduce leakage.
- Include tests for emotional over-inference, false claims of sentience, medical/mental-health boundaries, bias, prompt injection, and refusal quality.
- Human-like warmth means tone and perspective-taking, not claiming actual human consciousness or feelings.
- Never silently replace the production model; use an explicit configuration switch and rollback path.

## Environment variables

- `MINIMIND_INFERENCE_URL`: server-side URL for the separately hosted inference service.
- `MINIMIND_INFERENCE_TOKEN`: optional server-side bearer token, if required by that service.
- `MINIMIND_MODEL_ID`: deployed checkpoint/version identifier.

These variables are documentation for a future serving adapter. The presence of this plan does not mean training has run or an inference endpoint exists.
