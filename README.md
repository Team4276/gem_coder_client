# Gem Coder

Gem Coder is Team 4276's private robot-code assistant. It connects to a DGX
Spark running vLLM and can work safely with one project folder on the student's
own computer. Its built-in subsystem skill teaches the team's WPILib
architecture and provides subsystem and constants templates.

For the DGX Spark administrator guide, see [DGX Spark setup](DGX_SPARK_SETUP.md).

## Student quick start (Windows)

1. Connect to the classroom Wi-Fi.
2. Open the **Gem Coder** folder your instructor shared with you.
3. Double-click **Start Gem Coder.cmd**.
4. Keep the small black window open while using Gem Coder. The app opens in
   the browser automatically.
5. Ask a coding question.

No terminal commands, server address, workspace URL, or workspace token are
needed for the normal student workflow.

### Work with a project

1. Select **Connect a project** in the sidebar.
2. Select **Choose folder**.
3. Pick the folder where the project is saved, then select **Connect project**.

Gem Coder can inspect, search, edit, and build only inside the selected folder.
It keeps file and search activity out of the conversation. Before it edits a
file or runs a build, it asks the student to approve or reject that action.
It answers only coding-related questions and briefly redirects unrelated
questions back to coding. Its built-in instructions emphasize teaching the
student how to reason through a problem instead of simply completing the work.

### Requirements

Node.js 18 or newer is the only local prerequisite for the normal Gem Coder
browser workflow. No package installation is required. If Node.js is missing,
ask an instructor or school IT for help.

```powershell
node --version
```

### Skills

Gem Coder includes the **4276-subsystem-code** skill. It is available
automatically and contains Team 4276's subsystem conventions, base-class
reference, and Java templates. Students do not need to install it.

Gem Coder chooses a relevant skill automatically. To select one explicitly,
start the message with its name prefixed by `$`:

```text
$4276-subsystem-code Create an elevator subsystem.
```

An explicit `$skill-name` reference is validated and its full `SKILL.md` is
loaded before the request is sent to the model. Type `$` in the chat box to
open the skill picker; use the arrow keys and Enter or Tab to select a skill.

Additional skills add reusable instructions and supporting text files. To
install one:

1. Select **Skills** in the sidebar.
2. Select **Choose SKILL.md** under **Install a skill**.
3. Choose the skill's `SKILL.md` file. Supporting files in the same folder are
   installed with it.
4. Select **Install skill**.

A minimal skill looks like this:

```text
explain-code/
└── SKILL.md
```

```markdown
---
name: explain-code
description: Explain unfamiliar code in student-friendly language.
---

When asked to explain code, start with its purpose, then walk through the
important parts and define unfamiliar terms.
```

Gem Coder shows each available skill's name and description to the model, but
does not load every skill's full instructions. It loads a skill only when the
request clearly matches its description or the student names it. For example,
start a new chat with `Use explain-code to help me understand this function.`
Skills may include references and templates in subfolders; Gem Coder can read
those text files when `SKILL.md` refers to them. Installing a skill does not run
scripts from the skill folder. To uninstall one, open **Skills** and select
**Remove** beside its name; this deletes only Gem Coder's installed copy.

Bundled skills live in `bundled-skills` alongside the app and cannot be removed
from the Skills screen. Additional skills are stored per Windows user in
`%LOCALAPPDATA%\GemCoder\skills`. On
Linux and macOS they are stored under `$XDG_DATA_HOME/GemCoder/skills`, or
`~/.local/share/GemCoder/skills` when `XDG_DATA_HOME` is not set. Advanced
users can override the location with:

```bash
node companion.mjs --serve-app --skills-dir /path/to/skills
```

### Linux and macOS

The Windows launcher is a `.cmd` file. On Linux or macOS, open a terminal in
the Gem Coder folder and run:

```bash
node companion.mjs --serve-app
```

Then open `http://127.0.0.1:8787` in a browser. Windows has a native modern
folder picker; on other platforms, enter the project folder path in the
connection dialog. The same applies to the skill-folder picker.

## Verify a development checkout

Run the built-in integration test (no package installation is required):

```bash
node --test companion.test.mjs
```

## Instructor setup

Distribute the complete Gem Coder folder, including `Start Gem Coder.cmd`,
`companion.mjs`, `pick-folder.ps1`, and `index.html`. The default browser app
configuration is:

```text
DGX Spark IP: 192.168.1.180
Model:        gem-coder
```
Gem Coder automatically turns that address into
`http://192.168.1.180:8000/v1`. Replace the example with the current Spark IP,
which you can find by running `hostname -I` on the DGX Spark.

The local companion binds only to `127.0.0.1`; it is not exposed to the local
network. It scopes file access to the folder the student selects.

Start vLLM on the DGX Spark:

```bash
cd ~/git/code_gem
source .venv/bin/activate
export VLLM_USE_DEEP_GEMM=0

vllm serve ./models/Qwen/Qwen3.6-35B-A3B-FP8 \
  --host 0.0.0.0 \
  --port 8000 \
  --served-model-name gem-coder \
  --max-model-len 32768 \
  --max-num-seqs 2 \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_xml
```
