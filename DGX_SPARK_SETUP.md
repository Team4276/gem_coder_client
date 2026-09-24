# DGX Spark setup for Gem Coder

This guide is for the instructor or administrator running the model server.
Students run Gem Coder locally; the DGX Spark hosts the model with vLLM.

## Architecture

```text
Student browser ── classroom LAN ──> DGX Spark vLLM :8000
       │
       └── local companion :8787 (only the selected project folder)
```

The student companion binds only to `127.0.0.1`; student project files are not
sent to the Spark by the companion.

## 1. Prepare the Spark

1. Complete NVIDIA's [first-boot setup](https://docs.nvidia.com/dgx/dgx-spark/first-boot.html)
   and install all offered updates.
2. Connect the Spark to the same trusted classroom LAN as the student devices.
   Ethernet is preferred for the Spark.
3. Assign a stable address, preferably a DHCP reservation.
4. Create an administrator account and verify local or SSH access.

On the Spark, record its LAN address and verify GPU software:

```bash
hostname -I
nvidia-smi
```

Use that address as `<SPARK_IP>` below. Do not use `127.0.0.1` in student
settings: it would refer to the student's own computer.

## 2. Use the known-good vLLM environment

This deployment deliberately uses a native, project-local vLLM environment;
it does **not** use NVIDIA's generic Docker recipe. The container recipe was
too memory-heavy for this classroom workload. Do not replace this environment
with a newer vLLM, CUDA, or container image without a measured test.

The verified baseline (September 22, 2026) is Ubuntu 24.04.4, NVIDIA GB10,
driver 580.173.02 (CUDA 13.0 reported by `nvidia-smi`), Python 3.12.3,
uv-managed `~/git/code_gem/.venv` (uv 0.12.5), vLLM 0.27.1, and the local
35 GB `Qwen3.6-35B-A3B-FP8` model. The active vLLM package is installed in
`.venv`; that environment has no `pip`, so use `uv` for inspection or repair.
Its original installation command was not captured. Capture a dependency lock
before attempting to recreate `.venv` from scratch.

Activate and verify the existing environment:

```bash
cd ~/git/code_gem
source .venv/bin/activate
vllm --version
python -c 'import vllm; print(vllm.__version__); print(vllm.__file__)'
```

Expected vLLM version: `0.27.1`.

Gem Coder uses vLLM's OpenAI-compatible server. See the official
[vLLM serving guide](https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html).

Put the model in a local folder or make its Hugging Face model ID available to
the account that starts vLLM. For the existing classroom model:

```bash
export MODEL_PATH="$HOME/git/code_gem/models/Qwen/Qwen3.6-35B-A3B-FP8"
```

## 3. Start the model server

This is the command running successfully on the Spark. It is launched from a
VS Code integrated terminal, not systemd; it will stop if that terminal or
session ends. Adjust capacity only after measuring it with real classroom traffic.

```bash
export VLLM_USE_DEEP_GEMM=0

vllm serve "$MODEL_PATH" \
  --host 0.0.0.0 \
  --port 8000 \
  --served-model-name gem-coder \
  --max-model-len 32768 \
  --max-num-seqs 2 \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_xml
```

`--host 0.0.0.0` makes the service reachable on the LAN. The known-good
process does not set `--allowed-origins`; it returns
`Access-Control-Allow-Origin: *`. CORS is not a network security boundary:
keep port 8000 restricted to the trusted classroom subnet. See the [vLLM serve reference](https://docs.vllm.ai/en/latest/cli/serve/)
for current arguments.

`VLLM_USE_DEEP_GEMM=0`, the context length, concurrency, and parser are
deployment choices from the existing classroom setup, not general vLLM
requirements. The live process confirms `VLLM_USE_DEEP_GEMM=0`. It leaves
model thinking enabled; do not add a disabling chat-template flag unless it is
tested with this model and vLLM version.

## 4. Verify the server

On the Spark:

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/v1/models
curl http://127.0.0.1:8000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"gem-coder","messages":[{"role":"user","content":"Reply with ready"}],"max_tokens":16}'
```

`/v1/models` must list `gem-coder`. From a student computer, test:

```text
http://<SPARK_IP>:8000/v1/models
```

If that cannot be reached, check the LAN/Wi-Fi, Spark firewall, classroom VLAN
or client-isolation policy, and the IP address before changing the app.

## 5. Configure the student app

In Gem Coder, open **Settings**:

```text
DGX Spark IP: <SPARK_IP>
Model name:   gem-coder
API key:      blank
```

Choose **Test connection**. This setting is saved in that browser only, so
preconfigure shared devices or give students the Spark IP. Gem Coder adds
`http://` and `:8000/v1` automatically.

## Security

- Treat vLLM as a trusted-LAN service. Never expose port 8000 to the internet.
- Restrict inbound port 8000 to the classroom subnet with the Spark or network
  firewall; coordinate this with school IT.
- vLLM supports `--api-key`, but its documentation warns that this does not
  secure every server endpoint. Keep network restrictions even if you use one.
- An API key entered in Gem Coder is stored in the student's browser, so a
  trusted classroom LAN is usually preferable to sharing a key widely.

## Optional: start automatically with systemd

The current server is not managed by systemd. This is an untested persistence
template: validate it outside class time before relying on it.

```ini
# /etc/systemd/system/gem-coder-vllm.service
[Unit]
Description=Gem Coder vLLM server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=<SPARK_USER>
WorkingDirectory=/home/<SPARK_USER>/git/code_gem
Environment=VLLM_USE_DEEP_GEMM=0
ExecStart=/home/<SPARK_USER>/git/code_gem/.venv/bin/vllm serve /home/<SPARK_USER>/git/code_gem/models/Qwen/Qwen3.6-35B-A3B-FP8 --host 0.0.0.0 --port 8000 --served-model-name gem-coder --max-model-len 32768 --max-num-seqs 2 --enable-auto-tool-choice --tool-call-parser qwen3_xml
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gem-coder-vllm
sudo systemctl status gem-coder-vllm
journalctl -u gem-coder-vllm -f
```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Browser connection fails | Verify `http://<SPARK_IP>:8000/v1`, LAN reachability, firewall rules, and that vLLM is running. |
| No model is listed | Confirm `--served-model-name gem-coder` and `/v1/models`. |
| CORS error | The known-good server returns `Access-Control-Allow-Origin: *`. Confirm the documented launch command and that no reverse proxy replaces CORS headers. |
| Slow responses | Start with one student, inspect `nvidia-smi`, then tune concurrency and context length gradually. |
| Project tools fail | Check the student's local companion and selected folder; this is separate from vLLM reachability. |
