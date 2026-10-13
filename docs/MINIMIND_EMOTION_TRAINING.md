# MiniMind Emotion, Empathy, and Reasoning Training

This repository now includes runnable dataset preparation and a launcher for MiniMind's native supervised fine-tuning (SFT) trainer. It does not include model weights, a GPU runtime, or a claim that training has already completed.

## What this trains

Use high-quality examples to improve instruction following, common-sense responses, emotional-context recognition, empathy, factual QA, multi-turn consistency, and safe boundaries. This teaches conversational behavior; it does not give the model literal human feelings or consciousness. MiniMind is a small-model research project and will not automatically reach ChatGPT-level capability.

## 1. Prepare a dataset

Create a JSONL file with one example per line. Input may use either `messages` or `conversations`:

```json
{"messages":[{"role":"user","content":"I failed an exam and feel disappointed."},{"role":"assistant","content":"That sounds disappointing. One exam does not define your ability. Want to identify what felt hardest and plan a next step?"}]}
```

Use data you have permission to train on. Remove passwords, tokens, private conversations, phone numbers, addresses, and other sensitive information. Prefer diverse, well-reviewed examples; include corrections, uncertainty, clarifying questions, non-English conversations, and examples that avoid emotional over-inference.

## 2. Set up a GPU machine / Google Colab

Run training outside Netlify and outside the Manus Remix web server. In a terminal or Colab cell:

```bash
git clone --depth 1 https://github.com/jingyaogong/minimind
cd minimind
pip install -r requirements.txt
```

Use the MiniMind README to obtain a compatible base checkpoint and its matching architecture. The default launcher configuration below expects `out/pretrain_512.pth` (hidden size 512). If your checkpoint has another architecture, pass the matching `--hidden-size` and `--num-hidden-layers` values. Never combine weights and model dimensions that do not match.

## 3. Prepare the data from the Manus Remix repository

From the Manus Remix repository root (upload/copy your data file into the training workspace first):

```bash
python training/minimind_emotion/prepare_dataset.py path/to/emotion_examples.jsonl --output-dir training/minimind_emotion/prepared
```

This writes `train.jsonl` and `validation.jsonl` in MiniMind's required `{"conversations":[...]}` schema. The training launcher accepts a single JSONL input and performs validation/deduplication; use the prepared `train.jsonl` for training and keep `validation.jsonl` held out for evaluation.

## 4. Start supervised fine-tuning

After both repositories are available in the same GPU workspace, run from the Manus Remix repository root:

```bash
python training/minimind_emotion/train_minimind_sft.py \
  --data training/minimind_emotion/prepared/train.jsonl \
  --minimind-dir ../minimind \
  --hidden-size 512 \
  --num-hidden-layers 8 \
  --epochs 2 \
  --batch-size 2 \
  --max-seq-len 512
```

To verify data and print the training command without launching the GPU job, add `--dry-run`. If memory runs out, reduce `--batch-size` or `--max-seq-len`. The default expects a compatible `../minimind/out/pretrain_512.pth` checkpoint. The script saves fine-tuned weights to MiniMind's `out/emotion_sft_512.pth` and keeps training artifacts outside the web app.

MiniMind's native trainer uses full-parameter SFT. GPU availability and memory requirements depend on model size and sequence length. The code launcher is committed, but no training run, checkpoint, benchmark, or inference service has been produced by this commit.

## 5. Evaluate before connecting it to Manus Remix

- Evaluate only on held-out `validation.jsonl` plus a separate safety and factuality test set.
- Compare base and tuned checkpoints on helpfulness, factuality, emotional-context accuracy, bias, refusal quality, hallucinations, and multi-turn consistency.
- Keep the existing production model/provider as fallback until the candidate passes evaluation.
- Host the resulting model behind an authenticated inference service; keep tokens server-side. Do not load large model weights inside Netlify Functions.
- Add a feature flag and rollback path before any production integration.

## Upstream

MiniMind source and training implementation: https://github.com/jingyaogong/minimind (Apache-2.0; review upstream license and the licenses of every dataset/model artifact separately).
