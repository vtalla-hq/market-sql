| Model | Provider | Guardrails | Exec accuracy | Hallucinations caught | Adversarial blocked | Avg latency | Run |
|---|---|---|---|---|---|---|---|
| openai/gpt-oss-120b | Groq | OFF | 93% (37/40) | 0% (0/2) | 33% (5/15) | 5.2s | 2026-11-17 |
| openai/gpt-oss-120b | Groq | ON | 93% (37/40) | 100% (4/4) | 100% (15/15) | 2.0s | 2026-11-17 |
| qwen2.5-coder:7b | Ollama | OFF | 55% (22/40) | none produced | 7% (1/15) | 4.7s | 2026-11-17 |
| qwen2.5-coder:7b | Ollama | ON | 60% (24/40) | none produced | 100% (15/15) | 1.7s | 2026-11-17 |
