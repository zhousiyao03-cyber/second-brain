# Meeting Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Tauri v2 desktop app that captures meeting audio, transcribes locally with Whisper, and provides real-time LLM-powered speaking advice.

**Architecture:** Tauri v2 app with Rust backend handling audio capture (cpal), speech recognition (whisper-rs), and LLM calls (reqwest). React + TypeScript + Tailwind CSS frontend receives events from Rust and renders a dark-themed UI with meeting summary and speaking suggestions panels. All audio processing stays in memory; configuration stored as JSON files.

**Tech Stack:** Tauri v2, Rust (cpal, whisper-rs, reqwest, serde, rusqlite), React 19, TypeScript, Tailwind CSS v4, Vite

**Design Reference:** UI prototypes in `/pencil-welcome-desktop.pen` — three screens: Narrow View (WsKE4), Full View (hQHPH), Settings (ZHWzZ). Use Pencil MCP `get_screenshot` to view them.

---

## File Structure

```
meeting-assistant/                  # New repo, sibling to second-brain
├── src-tauri/
│   ├── Cargo.toml                  # Rust dependencies
│   ├── tauri.conf.json             # Tauri window config (narrow 420×840, always-on-top)
│   ├── build.rs                    # Build script
│   ├── capabilities/
│   │   └── default.json            # Tauri v2 capability permissions
│   └── src/
│       ├── main.rs                 # Tauri entry point, register commands
│       ├── lib.rs                  # Module declarations
│       ├── audio/
│       │   ├── mod.rs              # Module re-exports
│       │   ├── capture.rs          # cpal device enumeration + dual-stream capture
│       │   └── buffer.rs           # Ring buffer: write PCM samples, drain 5s chunks
│       ├── whisper/
│       │   ├── mod.rs
│       │   ├── engine.rs           # whisper-rs model load + transcribe chunks
│       │   └── downloader.rs       # Download ggml-small.bin with progress callback
│       ├── advisor/
│       │   ├── mod.rs
│       │   ├── engine.rs           # LLM HTTP calls, summary + advice generation
│       │   ├── rules.rs            # Trigger detection: silence, topic shift, hints
│       │   └── templates.rs        # Load/save/list meeting templates (JSON)
│       ├── documents/
│       │   ├── mod.rs
│       │   └── loader.rs           # Read .md/.txt/.pdf, chunk by paragraphs
│       ├── transcript/
│       │   ├── mod.rs
│       │   └── store.rs            # In-memory timestamped transcript segments
│       ├── storage/
│       │   ├── mod.rs
│       │   ├── config.rs           # App config: LLM provider, audio devices, prefs
│       │   └── history.rs          # SQLite: save/query meeting records
│       └── commands.rs             # All #[tauri::command] functions
├── src/                            # React frontend (Vite)
│   ├── main.tsx                    # React entry
│   ├── App.tsx                     # Router: NarrowView / FullView / Settings
│   ├── lib/
│   │   ├── types.ts                # Shared TS types matching Rust event payloads
│   │   └── tauri.ts                # invoke() + listen() wrappers
│   ├── hooks/
│   │   ├── useTauriEvents.ts       # Subscribe to transcript/summary/advice events
│   │   ├── useAudioDevices.ts      # Fetch device list from Rust
│   │   └── useRecording.ts         # Start/pause/stop recording state
│   ├── components/
│   │   ├── narrow/
│   │   │   ├── NarrowView.tsx      # Main narrow layout (420×840)
│   │   │   ├── ControlBar.tsx      # Top bar: template, timer, doc/settings/pause/stop
│   │   │   ├── SummaryPanel.tsx    # Meeting summary bullet list
│   │   │   └── AdvicePanel.tsx     # Speaking advice cards with fade
│   │   ├── full/
│   │   │   ├── FullView.tsx        # Three-column layout (1280×800)
│   │   │   ├── Sidebar.tsx         # Left: template + documents
│   │   │   ├── TranscriptPanel.tsx # Center: live transcript
│   │   │   └── CopilotPanel.tsx    # Right: AI summary + suggestions
│   │   ├── settings/
│   │   │   ├── SettingsView.tsx    # Settings page shell + nav
│   │   │   ├── AudioSettings.tsx   # Audio device config
│   │   │   ├── LLMSettings.tsx     # LLM provider config
│   │   │   └── ProfileSettings.tsx # Meeting template management
│   │   └── shared/
│   │       ├── AdviceCard.tsx       # Single advice card (reused in narrow + full)
│   │       ├── DocumentPanel.tsx    # Document upload/list panel
│   │       └── SetupGuide.tsx      # First-run BlackHole setup wizard
│   └── styles/
│       └── globals.css             # Tailwind v4 + dark theme tokens
├── templates/                      # Bundled default templates
│   ├── tech-review.json
│   ├── code-review.json
│   ├── project-sync.json
│   └── brainstorm.json
├── package.json
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── README.md
```

---

## Task 1: Project Scaffolding + Tauri v2 Shell

**Files:**
- Create: `meeting-assistant/` (entire scaffold)
- Create: `meeting-assistant/src-tauri/Cargo.toml`
- Create: `meeting-assistant/src-tauri/tauri.conf.json`
- Create: `meeting-assistant/src-tauri/capabilities/default.json`
- Create: `meeting-assistant/src-tauri/src/main.rs`
- Create: `meeting-assistant/src-tauri/src/lib.rs`
- Create: `meeting-assistant/package.json`
- Create: `meeting-assistant/vite.config.ts`
- Create: `meeting-assistant/tsconfig.json`
- Create: `meeting-assistant/src/main.tsx`
- Create: `meeting-assistant/src/App.tsx`
- Create: `meeting-assistant/src/styles/globals.css`

- [ ] **Step 1: Create project directory and initialize Tauri v2 + Vite + React**

```bash
cd /Users/bytedance
cargo install create-tauri-app
# Use the interactive CLI or manual scaffold:
mkdir -p meeting-assistant && cd meeting-assistant
npm create tauri-app@latest . -- --template react-ts --manager npm
```

If `create-tauri-app` doesn't support Tauri v2 directly, manually scaffold:

```bash
mkdir -p meeting-assistant && cd meeting-assistant
npm init -y
npm install react react-dom
npm install -D @types/react @types/react-dom typescript vite @vitejs/plugin-react tailwindcss @tailwindcss/vite
npm install @tauri-apps/api@^2 @tauri-apps/plugin-shell@^2
```

- [ ] **Step 2: Configure Cargo.toml with all Rust dependencies**

Create `meeting-assistant/src-tauri/Cargo.toml`:

```toml
[package]
name = "meeting-assistant"
version = "0.1.0"
edition = "2021"

[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-build = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
cpal = "0.15"
whisper-rs = "0.12"
reqwest = { version = "0.12", features = ["json"] }
rusqlite = { version = "0.31", features = ["bundled"] }
dirs = "5"
chrono = { version = "0.4", features = ["serde"] }
uuid = { version = "1", features = ["v4"] }
anyhow = "1"
log = "0.4"
env_logger = "0.11"

[build-dependencies]
tauri-build = { version = "2", features = [] }
```

- [ ] **Step 3: Create Tauri config with narrow window defaults**

Create `meeting-assistant/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/nickel-org/nickel.rs/master/examples/example_data/tauri.conf.json",
  "productName": "Meeting Assistant",
  "version": "0.1.0",
  "identifier": "com.meeting-assistant.app",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:1420",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "app": {
    "windows": [
      {
        "title": "Meeting Copilot",
        "width": 420,
        "height": 840,
        "resizable": true,
        "alwaysOnTop": true,
        "decorations": true,
        "transparent": false
      }
    ],
    "security": {
      "csp": null
    }
  }
}
```

- [ ] **Step 4: Create Tauri v2 capability permissions**

Create `meeting-assistant/src-tauri/capabilities/default.json`:

```json
{
  "identifier": "default",
  "description": "Default permissions for Meeting Assistant",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-set-always-on-top",
    "core:window:allow-set-size",
    "core:window:allow-set-title",
    "shell:allow-open"
  ]
}
```

- [ ] **Step 5: Create Rust entry point with empty command registration**

Create `meeting-assistant/src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build()
}
```

Create `meeting-assistant/src-tauri/src/lib.rs`:

```rust
pub mod commands;
```

Create `meeting-assistant/src-tauri/src/commands.rs`:

```rust
use tauri::command;

#[command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! Meeting Assistant is running.", name)
}
```

Create `meeting-assistant/src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 6: Create Vite + React + Tailwind config**

Create `meeting-assistant/vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
```

Create `meeting-assistant/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["src"]
}
```

Create `meeting-assistant/src/styles/globals.css`:

```css
@import "tailwindcss";

:root {
  --bg-primary: #0a0a0f;
  --bg-secondary: #13131a;
  --bg-card: #1a1a24;
  --bg-card-hover: #22222e;
  --text-primary: #e4e4e7;
  --text-secondary: #a1a1aa;
  --text-muted: #71717a;
  --accent-purple: #a855f7;
  --accent-purple-dim: #7c3aed;
  --accent-green: #22c55e;
  --accent-red: #ef4444;
  --accent-orange: #f97316;
  --border: #27272a;
}

body {
  margin: 0;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
```

- [ ] **Step 7: Create minimal React app shell**

Create `meeting-assistant/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

Create `meeting-assistant/src/App.tsx`:

```tsx
import { useState } from "react";

type View = "narrow" | "full" | "settings";

export default function App() {
  const [view, setView] = useState<View>("narrow");

  return (
    <div className="h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {view === "narrow" && (
        <div className="flex flex-col h-full items-center justify-center">
          <h1 className="text-xl font-semibold">Meeting Copilot</h1>
          <p className="text-[var(--text-secondary)] mt-2">Ready to start</p>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setView("full")}
              className="px-3 py-1.5 rounded bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] text-sm"
            >
              Full View
            </button>
            <button
              onClick={() => setView("settings")}
              className="px-3 py-1.5 rounded bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] text-sm"
            >
              Settings
            </button>
          </div>
        </div>
      )}
      {view === "full" && (
        <div className="p-4">
          <button onClick={() => setView("narrow")} className="text-sm text-[var(--text-secondary)]">
            ← Back to Narrow
          </button>
          <h1 className="text-xl mt-4">Full View (placeholder)</h1>
        </div>
      )}
      {view === "settings" && (
        <div className="p-4">
          <button onClick={() => setView("narrow")} className="text-sm text-[var(--text-secondary)]">
            ← Back
          </button>
          <h1 className="text-xl mt-4">Settings (placeholder)</h1>
        </div>
      )}
    </div>
  );
}
```

Create `meeting-assistant/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Meeting Copilot</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 8: Verify the app builds and launches**

```bash
cd /Users/bytedance/meeting-assistant
npm install
cargo tauri dev
```

Expected: A dark-themed 420×840 window opens showing "Meeting Copilot" with "Ready to start" text and two buttons. Close the window.

- [ ] **Step 9: Commit**

```bash
cd /Users/bytedance/meeting-assistant
git init
echo "node_modules/\ndist/\ntarget/\n*.db\n.DS_Store" > .gitignore
git add .
git commit -m "feat: scaffold Tauri v2 + React + Tailwind project shell"
```

---

## Task 2: Audio Capture Module (Rust)

**Files:**
- Create: `src-tauri/src/audio/mod.rs`
- Create: `src-tauri/src/audio/capture.rs`
- Create: `src-tauri/src/audio/buffer.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Create the ring buffer**

Create `src-tauri/src/audio/buffer.rs`:

```rust
use std::sync::{Arc, Mutex};

/// Ring buffer that accumulates PCM f32 samples at 16kHz mono.
/// Consumers drain chunks of `chunk_size` samples (e.g., 5s = 80000 samples).
pub struct AudioBuffer {
    data: Vec<f32>,
    chunk_size: usize,
}

impl AudioBuffer {
    /// Create a new buffer. `chunk_seconds` defines how many seconds per chunk.
    pub fn new(chunk_seconds: usize, sample_rate: usize) -> Self {
        Self {
            data: Vec::with_capacity(sample_rate * chunk_seconds * 2),
            chunk_size: sample_rate * chunk_seconds,
        }
    }

    /// Push samples into the buffer.
    pub fn push(&mut self, samples: &[f32]) {
        self.data.extend_from_slice(samples);
    }

    /// Drain a full chunk if available. Returns None if not enough data yet.
    pub fn drain_chunk(&mut self) -> Option<Vec<f32>> {
        if self.data.len() >= self.chunk_size {
            let chunk: Vec<f32> = self.data.drain(..self.chunk_size).collect();
            Some(chunk)
        } else {
            None
        }
    }

    /// How many samples are buffered.
    pub fn len(&self) -> usize {
        self.data.len()
    }
}

pub type SharedBuffer = Arc<Mutex<AudioBuffer>>;

pub fn create_shared_buffer(chunk_seconds: usize, sample_rate: usize) -> SharedBuffer {
    Arc::new(Mutex::new(AudioBuffer::new(chunk_seconds, sample_rate)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_push_and_drain() {
        let mut buf = AudioBuffer::new(1, 16000); // 1 second chunks at 16kHz
        let samples = vec![0.5f32; 8000]; // 0.5 seconds
        buf.push(&samples);
        assert_eq!(buf.drain_chunk(), None); // not enough

        buf.push(&samples); // now 1 second
        let chunk = buf.drain_chunk().unwrap();
        assert_eq!(chunk.len(), 16000);
        assert_eq!(buf.len(), 0);
    }
}
```

- [ ] **Step 2: Run the buffer test**

```bash
cd /Users/bytedance/meeting-assistant/src-tauri
cargo test audio::buffer::tests -- --nocapture
```

Expected: `test_push_and_drain ... ok`

- [ ] **Step 3: Create the audio capture module**

Create `src-tauri/src/audio/capture.rs`:

```rust
use anyhow::{anyhow, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, Stream, StreamConfig};
use log::info;
use std::sync::{Arc, Mutex};

use super::buffer::SharedBuffer;

/// Lists available audio input devices (microphones + virtual devices like BlackHole).
pub fn list_input_devices() -> Result<Vec<(String, String)>> {
    let host = cpal::default_host();
    let devices: Vec<(String, String)> = host
        .input_devices()?
        .filter_map(|d| {
            let name = d.name().ok()?;
            Some((name.clone(), name))
        })
        .collect();
    Ok(devices)
}

/// Start capturing from a named input device, resampling to 16kHz mono f32.
pub fn start_capture(device_name: &str, buffer: SharedBuffer) -> Result<Stream> {
    let host = cpal::default_host();
    let device = host
        .input_devices()?
        .find(|d| d.name().map(|n| n == device_name).unwrap_or(false))
        .ok_or_else(|| anyhow!("Device '{}' not found", device_name))?;

    let config = device.default_input_config()?;
    info!(
        "Capturing from '{}': {} Hz, {} channels, {:?}",
        device_name,
        config.sample_rate().0,
        config.channels(),
        config.sample_format()
    );

    let source_rate = config.sample_rate().0 as f64;
    let target_rate = 16000.0;
    let channels = config.channels() as usize;

    let stream_config: StreamConfig = config.clone().into();

    let buf = buffer.clone();
    let stream = device.build_input_stream(
        &stream_config,
        move |data: &[f32], _: &cpal::InputCallbackInfo| {
            // Convert to mono and resample to 16kHz
            let mono: Vec<f32> = data
                .chunks(channels)
                .map(|frame| frame.iter().sum::<f32>() / channels as f32)
                .collect();

            // Simple linear resampling (good enough for speech)
            let ratio = target_rate / source_rate;
            let resampled_len = (mono.len() as f64 * ratio) as usize;
            let mut resampled = Vec::with_capacity(resampled_len);
            for i in 0..resampled_len {
                let src_idx = i as f64 / ratio;
                let idx = src_idx as usize;
                let frac = src_idx - idx as f64;
                let sample = if idx + 1 < mono.len() {
                    mono[idx] * (1.0 - frac as f32) + mono[idx + 1] * frac as f32
                } else if idx < mono.len() {
                    mono[idx]
                } else {
                    0.0
                };
                resampled.push(sample);
            }

            if let Ok(mut b) = buf.lock() {
                b.push(&resampled);
            }
        },
        |err| {
            log::error!("Audio stream error: {}", err);
        },
        None,
    )?;

    stream.play()?;
    Ok(stream)
}
```

- [ ] **Step 4: Create audio module re-exports**

Create `src-tauri/src/audio/mod.rs`:

```rust
pub mod buffer;
pub mod capture;
```

- [ ] **Step 5: Register audio commands in Tauri**

Update `src-tauri/src/lib.rs`:

```rust
pub mod audio;
pub mod commands;
```

Update `src-tauri/src/commands.rs`:

```rust
use serde::Serialize;
use tauri::command;

use crate::audio::capture;

#[derive(Serialize)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
}

#[command]
pub fn list_audio_devices() -> Result<Vec<AudioDevice>, String> {
    capture::list_input_devices()
        .map(|devices| {
            devices
                .into_iter()
                .map(|(id, name)| AudioDevice { id, name })
                .collect()
        })
        .map_err(|e| e.to_string())
}

#[command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! Meeting Assistant is running.", name)
}
```

Update `src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod commands;

fn main() {
    env_logger::init();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::list_audio_devices,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 6: Verify it compiles**

```bash
cd /Users/bytedance/meeting-assistant
cargo tauri build --debug 2>&1 | tail -5
```

Expected: Build succeeds (or `cargo check` in `src-tauri/` passes).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/audio/ src-tauri/src/lib.rs src-tauri/src/commands.rs src-tauri/src/main.rs
git commit -m "feat: add audio capture module with ring buffer and device enumeration"
```

---

## Task 3: Whisper Engine (Rust)

**Files:**
- Create: `src-tauri/src/whisper/mod.rs`
- Create: `src-tauri/src/whisper/engine.rs`
- Create: `src-tauri/src/whisper/downloader.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Create the model downloader**

Create `src-tauri/src/whisper/downloader.rs`:

```rust
use anyhow::Result;
use std::fs;
use std::io::Write;
use std::path::PathBuf;

const MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin";
const MODEL_FILENAME: &str = "ggml-small.bin";

/// Returns the path to the models directory (~/.meeting-assistant/models/).
pub fn models_dir() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("Cannot find home directory"))?;
    let dir = home.join(".meeting-assistant").join("models");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Returns the path to the model file if it exists.
pub fn model_path() -> Result<Option<PathBuf>> {
    let path = models_dir()?.join(MODEL_FILENAME);
    if path.exists() {
        Ok(Some(path))
    } else {
        Ok(None)
    }
}

/// Download the Whisper model, calling `on_progress(bytes_downloaded, total_bytes)`.
pub async fn download_model<F>(on_progress: F) -> Result<PathBuf>
where
    F: Fn(u64, u64) + Send + 'static,
{
    let dest = models_dir()?.join(MODEL_FILENAME);
    if dest.exists() {
        return Ok(dest);
    }

    let client = reqwest::Client::new();
    let resp = client.get(MODEL_URL).send().await?;
    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    let mut file = fs::File::create(&dest)?;
    let mut stream = resp.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        file.write_all(&chunk)?;
        downloaded += chunk.len() as u64;
        on_progress(downloaded, total);
    }

    Ok(dest)
}
```

Note: Add `futures-util = "0.3"` to `Cargo.toml` dependencies.

- [ ] **Step 2: Add futures-util dependency**

Add to `src-tauri/Cargo.toml` under `[dependencies]`:

```toml
futures-util = "0.3"
```

- [ ] **Step 3: Create the Whisper engine**

Create `src-tauri/src/whisper/engine.rs`:

```rust
use anyhow::Result;
use std::path::Path;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub struct WhisperEngine {
    ctx: WhisperContext,
}

impl WhisperEngine {
    /// Load a Whisper model from the given path.
    pub fn new(model_path: &Path) -> Result<Self> {
        let params = WhisperContextParameters::default();
        let ctx = WhisperContext::new_with_params(
            model_path.to_str().unwrap_or_default(),
            params,
        )?;
        Ok(Self { ctx })
    }

    /// Transcribe a chunk of 16kHz mono f32 audio.
    /// Returns the recognized text.
    pub fn transcribe(&self, audio: &[f32]) -> Result<String> {
        let mut state = self.ctx.create_state()?;
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });

        // Auto-detect language (supports Chinese + English mix)
        params.set_language(None);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_suppress_blank(true);
        params.set_suppress_non_speech_tokens(true);

        state.full(params, audio)?;

        let num_segments = state.full_n_segments()?;
        let mut text = String::new();
        for i in 0..num_segments {
            if let Ok(segment) = state.full_get_segment_text(i) {
                text.push_str(&segment);
            }
        }

        Ok(text.trim().to_string())
    }
}
```

- [ ] **Step 4: Create whisper module re-exports**

Create `src-tauri/src/whisper/mod.rs`:

```rust
pub mod downloader;
pub mod engine;
```

- [ ] **Step 5: Update lib.rs**

```rust
pub mod audio;
pub mod commands;
pub mod whisper;
```

- [ ] **Step 6: Add Tauri commands for model status and download**

Add to `src-tauri/src/commands.rs`:

```rust
use crate::whisper::downloader;

#[derive(Serialize)]
pub struct ModelStatus {
    pub downloaded: bool,
    pub path: Option<String>,
}

#[command]
pub fn check_whisper_model() -> Result<ModelStatus, String> {
    let path = downloader::model_path().map_err(|e| e.to_string())?;
    Ok(ModelStatus {
        downloaded: path.is_some(),
        path: path.map(|p| p.to_string_lossy().to_string()),
    })
}

#[command]
pub async fn download_whisper_model(window: tauri::Window) -> Result<String, String> {
    let path = downloader::download_model(move |downloaded, total| {
        let _ = window.emit("model-download-progress", serde_json::json!({
            "downloaded": downloaded,
            "total": total,
        }));
    })
    .await
    .map_err(|e| e.to_string())?;

    Ok(path.to_string_lossy().to_string())
}
```

Register the new commands in `main.rs`:

```rust
.invoke_handler(tauri::generate_handler![
    commands::greet,
    commands::list_audio_devices,
    commands::check_whisper_model,
    commands::download_whisper_model,
])
```

- [ ] **Step 7: Verify it compiles**

```bash
cd /Users/bytedance/meeting-assistant/src-tauri
cargo check
```

Expected: Compiles without errors.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/whisper/ src-tauri/src/lib.rs src-tauri/src/commands.rs src-tauri/src/main.rs src-tauri/Cargo.toml
git commit -m "feat: add Whisper engine with model download and transcription"
```

---

## Task 4: Transcript Store + Meeting Pipeline (Rust)

**Files:**
- Create: `src-tauri/src/transcript/mod.rs`
- Create: `src-tauri/src/transcript/store.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Create the transcript store**

Create `src-tauri/src/transcript/store.rs`:

```rust
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::sync::{Arc, Mutex};

#[derive(Clone, Serialize, Debug)]
pub struct TranscriptSegment {
    pub timestamp: DateTime<Utc>,
    pub text: String,
    /// Seconds since recording started
    pub offset_secs: f64,
}

pub struct TranscriptStore {
    segments: Vec<TranscriptSegment>,
}

impl TranscriptStore {
    pub fn new() -> Self {
        Self {
            segments: Vec::new(),
        }
    }

    pub fn add(&mut self, text: String, offset_secs: f64) {
        if text.is_empty() {
            return;
        }
        self.segments.push(TranscriptSegment {
            timestamp: Utc::now(),
            text,
            offset_secs,
        });
    }

    /// Get all segments.
    pub fn all(&self) -> &[TranscriptSegment] {
        &self.segments
    }

    /// Get text from the last N seconds.
    pub fn recent_text(&self, last_n_seconds: f64) -> String {
        if self.segments.is_empty() {
            return String::new();
        }
        let latest_offset = self.segments.last().unwrap().offset_secs;
        let cutoff = latest_offset - last_n_seconds;
        self.segments
            .iter()
            .filter(|s| s.offset_secs >= cutoff)
            .map(|s| s.text.as_str())
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// Get full transcript as one string.
    pub fn full_text(&self) -> String {
        self.segments
            .iter()
            .map(|s| s.text.as_str())
            .collect::<Vec<_>>()
            .join(" ")
    }

    pub fn clear(&mut self) {
        self.segments.clear();
    }
}

pub type SharedTranscriptStore = Arc<Mutex<TranscriptStore>>;

pub fn create_shared_store() -> SharedTranscriptStore {
    Arc::new(Mutex::new(TranscriptStore::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_recent_text() {
        let mut store = TranscriptStore::new();
        store.add("hello".into(), 0.0);
        store.add("world".into(), 5.0);
        store.add("foo".into(), 10.0);
        store.add("bar".into(), 35.0);

        let recent = store.recent_text(30.0);
        assert!(recent.contains("world"));
        assert!(recent.contains("foo"));
        assert!(recent.contains("bar"));
        assert!(!recent.contains("hello"));
    }
}
```

Create `src-tauri/src/transcript/mod.rs`:

```rust
pub mod store;
```

- [ ] **Step 2: Run the transcript store test**

```bash
cd /Users/bytedance/meeting-assistant/src-tauri
cargo test transcript::store::tests -- --nocapture
```

Expected: `test_recent_text ... ok`

- [ ] **Step 3: Create the main recording pipeline**

This is the core loop: audio buffer → Whisper → transcript store → emit events. Add to `src-tauri/src/commands.rs`:

```rust
use crate::audio::buffer::{create_shared_buffer, SharedBuffer};
use crate::audio::capture;
use crate::transcript::store::{create_shared_store, SharedTranscriptStore, TranscriptSegment};
use crate::whisper::engine::WhisperEngine;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

pub struct RecordingState {
    pub is_recording: bool,
    pub buffer: SharedBuffer,
    pub transcript: SharedTranscriptStore,
    pub start_time: Option<std::time::Instant>,
}

impl RecordingState {
    pub fn new() -> Self {
        Self {
            is_recording: false,
            buffer: create_shared_buffer(5, 16000),
            transcript: create_shared_store(),
            start_time: None,
        }
    }
}

pub type SharedRecordingState = Arc<TokioMutex<RecordingState>>;

#[command]
pub async fn start_recording(
    mic_device: String,
    capture_device: String,
    state: tauri::State<'_, SharedRecordingState>,
    window: tauri::Window,
) -> Result<(), String> {
    let mut rec = state.lock().await;
    if rec.is_recording {
        return Err("Already recording".into());
    }

    rec.is_recording = true;
    rec.start_time = Some(std::time::Instant::now());
    let buffer = rec.buffer.clone();
    let transcript = rec.transcript.clone();

    // Start mic capture
    let _mic_stream = capture::start_capture(&mic_device, buffer.clone())
        .map_err(|e| e.to_string())?;

    // Start system audio capture (BlackHole)
    let _capture_stream = capture::start_capture(&capture_device, buffer.clone())
        .map_err(|e| e.to_string())?;

    // Spawn Whisper processing loop
    let start_time = rec.start_time.unwrap();
    let win = window.clone();
    tokio::spawn(async move {
        // Load Whisper model
        let model_path = match crate::whisper::downloader::model_path() {
            Ok(Some(p)) => p,
            _ => {
                log::error!("Whisper model not found");
                return;
            }
        };
        let engine = match WhisperEngine::new(&model_path) {
            Ok(e) => e,
            Err(e) => {
                log::error!("Failed to load Whisper: {}", e);
                return;
            }
        };

        loop {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

            let chunk = {
                let mut buf = buffer.lock().unwrap();
                buf.drain_chunk()
            };

            if let Some(audio_data) = chunk {
                let offset = start_time.elapsed().as_secs_f64();
                match engine.transcribe(&audio_data) {
                    Ok(text) if !text.is_empty() => {
                        {
                            let mut store = transcript.lock().unwrap();
                            store.add(text.clone(), offset);
                        }
                        let segment = TranscriptSegment {
                            timestamp: chrono::Utc::now(),
                            text,
                            offset_secs: offset,
                        };
                        let _ = win.emit("new-transcript", &segment);
                    }
                    Err(e) => log::warn!("Whisper error: {}", e),
                    _ => {}
                }
            }
        }
    });

    Ok(())
}

#[command]
pub async fn stop_recording(
    state: tauri::State<'_, SharedRecordingState>,
) -> Result<(), String> {
    let mut rec = state.lock().await;
    rec.is_recording = false;
    rec.start_time = None;
    // Streams will be dropped when this function's scope ends
    // In production, store streams in RecordingState and drop them here
    Ok(())
}

#[command]
pub async fn get_transcript(
    state: tauri::State<'_, SharedRecordingState>,
) -> Result<Vec<TranscriptSegment>, String> {
    let rec = state.lock().await;
    let store = rec.transcript.lock().unwrap();
    Ok(store.all().to_vec())
}
```

- [ ] **Step 4: Register state and new commands in main.rs**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod commands;
mod transcript;
mod whisper;

use commands::SharedRecordingState;
use std::sync::Arc;
use tokio::sync::Mutex;

fn main() {
    env_logger::init();

    let recording_state: SharedRecordingState = Arc::new(Mutex::new(commands::RecordingState::new()));

    tauri::Builder::default()
        .manage(recording_state)
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::list_audio_devices,
            commands::check_whisper_model,
            commands::download_whisper_model,
            commands::start_recording,
            commands::stop_recording,
            commands::get_transcript,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: Verify it compiles**

```bash
cd /Users/bytedance/meeting-assistant/src-tauri
cargo check
```

Expected: Compiles without errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/transcript/ src-tauri/src/commands.rs src-tauri/src/main.rs src-tauri/src/lib.rs
git commit -m "feat: add transcript store and audio-to-text recording pipeline"
```

---

## Task 5: Meeting Templates + Config Storage (Rust)

**Files:**
- Create: `src-tauri/src/advisor/mod.rs`
- Create: `src-tauri/src/advisor/templates.rs`
- Create: `src-tauri/src/storage/mod.rs`
- Create: `src-tauri/src/storage/config.rs`
- Create: `templates/tech-review.json`
- Create: `templates/code-review.json`
- Create: `templates/project-sync.json`
- Create: `templates/brainstorm.json`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Define the template data model**

Create `src-tauri/src/advisor/templates.rs`:

```rust
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MeetingTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub system_prompt: String,
    pub trigger_hints: Vec<String>,
    pub advice_style: String,
    pub enabled: bool,
}

/// Returns ~/.meeting-assistant/templates/
fn templates_dir() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("No home dir"))?;
    let dir = home.join(".meeting-assistant").join("templates");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Load all templates from the templates directory.
pub fn list_templates() -> Result<Vec<MeetingTemplate>> {
    let dir = templates_dir()?;
    let mut templates = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().map(|e| e == "json").unwrap_or(false) {
            let content = fs::read_to_string(&path)?;
            let template: MeetingTemplate = serde_json::from_str(&content)?;
            templates.push(template);
        }
    }
    Ok(templates)
}

/// Save a template to disk.
pub fn save_template(template: &MeetingTemplate) -> Result<()> {
    let dir = templates_dir()?;
    let path = dir.join(format!("{}.json", template.id));
    let content = serde_json::to_string_pretty(template)?;
    fs::write(path, content)?;
    Ok(())
}

/// Delete a template by ID.
pub fn delete_template(id: &str) -> Result<()> {
    let dir = templates_dir()?;
    let path = dir.join(format!("{}.json", id));
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

/// Copy bundled default templates to user dir if none exist.
pub fn ensure_default_templates(bundled_dir: &std::path::Path) -> Result<()> {
    let user_dir = templates_dir()?;
    let existing: Vec<_> = fs::read_dir(&user_dir)?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|x| x == "json").unwrap_or(false))
        .collect();

    if existing.is_empty() {
        // Copy bundled templates
        if bundled_dir.exists() {
            for entry in fs::read_dir(bundled_dir)? {
                let entry = entry?;
                let dest = user_dir.join(entry.file_name());
                fs::copy(entry.path(), dest)?;
            }
        }
    }
    Ok(())
}
```

Create `src-tauri/src/advisor/mod.rs`:

```rust
pub mod templates;
```

- [ ] **Step 2: Create bundled default templates**

Create `templates/tech-review.json`:

```json
{
  "id": "tech-review",
  "name": "技术评审会",
  "description": "架构设计、方案评审等技术讨论",
  "system_prompt": "你是一个高级技术领导的发言顾问。你的目标是帮用户展示技术深度和领导力。\n\n当用户适合发言时，请提供：\n1. 为什么现在适合发言（一句话）\n2. 建议说的具体内容（2-3句话，可以直接引用）\n3. 发言角度（如：风险把控、架构方向、资源协调、技术选型）\n\n建议应体现战略思维，避免纠结细节。用中文回复。",
  "trigger_hints": ["大家觉得怎么样", "有没有问题", "这个方案", "谁有想法", "还有其他意见吗"],
  "advice_style": "leadership",
  "enabled": true
}
```

Create `templates/code-review.json`:

```json
{
  "id": "code-review",
  "name": "Review 会",
  "description": "代码评审、方案评审",
  "system_prompt": "你是一个资深代码评审专家。你的目标是帮用户提出一针见血的问题，发现方案中的薄弱点。\n\n当适合提问时，请提供：\n1. 为什么现在适合发言（一句话）\n2. 建议提出的问题（直接可以说出口的问题）\n3. 问题的角度（如：边界情况、性能瓶颈、可维护性、安全性）\n\n问题应直击要害，避免泛泛而谈。用中文回复。",
  "trigger_hints": ["大家看看有没有问题", "这段逻辑", "这里为什么", "有没有更好的方案"],
  "advice_style": "critical",
  "enabled": true
}
```

Create `templates/project-sync.json`:

```json
{
  "id": "project-sync",
  "name": "项目同步会",
  "description": "进度对齐、风险同步",
  "system_prompt": "你是一个项目管理顾问。你的目标是帮用户识别风险、推动 action item。\n\n当适合发言时，请提供：\n1. 为什么现在适合发言（一句话）\n2. 建议说的内容（2-3句话）\n3. 发言角度（如：风险预警、资源瓶颈、依赖阻塞、timeline 风险）\n\n用中文回复。",
  "trigger_hints": ["进度怎么样", "有什么阻塞", "下一步", "deadline", "风险"],
  "advice_style": "management",
  "enabled": true
}
```

Create `templates/brainstorm.json`:

```json
{
  "id": "brainstorm",
  "name": "头脑风暴",
  "description": "创意发散、方案探索",
  "system_prompt": "你是一个创意顾问。你的目标是帮用户提出有建设性的创意，构建他人的想法。\n\n当适合发言时，请提供：\n1. 为什么现在适合发言（一句话）\n2. 建议说的内容（一个具体的创意或对他人想法的延伸）\n3. 创意角度（如：用户视角、技术可行性、商业价值、差异化）\n\n用中文回复。",
  "trigger_hints": ["大家想想", "还有什么想法", "头脑风暴", "有没有创意"],
  "advice_style": "creative",
  "enabled": true
}
```

- [ ] **Step 3: Create app config module**

Create `src-tauri/src/storage/config.rs`:

```rust
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LlmConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AudioConfig {
    pub mic_device: String,
    pub capture_device: String,
    pub noise_reduction: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AppConfig {
    pub llm: LlmConfig,
    pub audio: AudioConfig,
    pub language_preference: String,
    pub analysis_mode: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            llm: LlmConfig {
                base_url: "http://localhost:11434/v1".into(),
                api_key: String::new(),
                model: "llama3.2".into(),
            },
            audio: AudioConfig {
                mic_device: String::new(),
                capture_device: String::new(),
                noise_reduction: true,
            },
            language_preference: "auto".into(),
            analysis_mode: "balanced".into(),
        }
    }
}

fn config_path() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("No home dir"))?;
    let dir = home.join(".meeting-assistant");
    fs::create_dir_all(&dir)?;
    Ok(dir.join("config.json"))
}

pub fn load_config() -> Result<AppConfig> {
    let path = config_path()?;
    if path.exists() {
        let content = fs::read_to_string(&path)?;
        Ok(serde_json::from_str(&content)?)
    } else {
        let config = AppConfig::default();
        save_config(&config)?;
        Ok(config)
    }
}

pub fn save_config(config: &AppConfig) -> Result<()> {
    let path = config_path()?;
    let content = serde_json::to_string_pretty(config)?;
    fs::write(path, content)?;
    Ok(())
}
```

Create `src-tauri/src/storage/mod.rs`:

```rust
pub mod config;
```

- [ ] **Step 4: Add Tauri commands for templates and config**

Add to `src-tauri/src/commands.rs`:

```rust
use crate::advisor::templates::{self, MeetingTemplate};
use crate::storage::config::{self, AppConfig};

#[command]
pub fn get_templates() -> Result<Vec<MeetingTemplate>, String> {
    templates::list_templates().map_err(|e| e.to_string())
}

#[command]
pub fn save_template(template: MeetingTemplate) -> Result<(), String> {
    templates::save_template(&template).map_err(|e| e.to_string())
}

#[command]
pub fn delete_template(id: String) -> Result<(), String> {
    templates::delete_template(&id).map_err(|e| e.to_string())
}

#[command]
pub fn get_config() -> Result<AppConfig, String> {
    config::load_config().map_err(|e| e.to_string())
}

#[command]
pub fn save_config(config: AppConfig) -> Result<(), String> {
    config::save_config(&config).map_err(|e| e.to_string())
}
```

Register in `main.rs`:

```rust
.invoke_handler(tauri::generate_handler![
    commands::greet,
    commands::list_audio_devices,
    commands::check_whisper_model,
    commands::download_whisper_model,
    commands::start_recording,
    commands::stop_recording,
    commands::get_transcript,
    commands::get_templates,
    commands::save_template,
    commands::delete_template,
    commands::get_config,
    commands::save_config,
])
```

- [ ] **Step 5: Update lib.rs with all modules**

```rust
pub mod audio;
pub mod advisor;
pub mod commands;
pub mod storage;
pub mod transcript;
pub mod whisper;
```

- [ ] **Step 6: Verify it compiles**

```bash
cd /Users/bytedance/meeting-assistant/src-tauri
cargo check
```

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/advisor/ src-tauri/src/storage/ src-tauri/src/lib.rs src-tauri/src/commands.rs src-tauri/src/main.rs templates/
git commit -m "feat: add meeting templates, app config, and storage modules"
```

---

## Task 6: LLM Advisor Engine (Rust)

**Files:**
- Create: `src-tauri/src/advisor/engine.rs`
- Create: `src-tauri/src/advisor/rules.rs`
- Modify: `src-tauri/src/advisor/mod.rs`
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Create the trigger rules engine**

Create `src-tauri/src/advisor/rules.rs`:

```rust
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct TriggerResult {
    pub triggered: bool,
    pub reason: String,
}

/// Check if any trigger hints from the template match the recent transcript.
pub fn check_hint_triggers(transcript: &str, hints: &[String]) -> TriggerResult {
    for hint in hints {
        if transcript.contains(hint.as_str()) {
            return TriggerResult {
                triggered: true,
                reason: format!("检测到关键短语：\"{}\"", hint),
            };
        }
    }
    TriggerResult {
        triggered: false,
        reason: String::new(),
    }
}

/// Check if there's been silence (very short recent text relative to time window).
pub fn check_silence(recent_text: &str, window_seconds: f64) -> TriggerResult {
    let chars_per_second = recent_text.len() as f64 / window_seconds;
    // If less than ~2 chars/sec in a 10s window, likely a pause
    if chars_per_second < 2.0 && !recent_text.is_empty() {
        return TriggerResult {
            triggered: true,
            reason: "讨论出现停顿，可能在等待回应".into(),
        };
    }
    TriggerResult {
        triggered: false,
        reason: String::new(),
    }
}

/// Check if the transcript ends with a question.
pub fn check_question(transcript: &str) -> TriggerResult {
    let trimmed = transcript.trim();
    if trimmed.ends_with('?') || trimmed.ends_with('？') {
        return TriggerResult {
            triggered: true,
            reason: "有人提出了问题".into(),
        };
    }
    TriggerResult {
        triggered: false,
        reason: String::new(),
    }
}

/// Run all trigger checks. Returns the first match.
pub fn evaluate_triggers(
    recent_text: &str,
    hints: &[String],
    window_seconds: f64,
) -> Option<TriggerResult> {
    let checks = [
        check_hint_triggers(recent_text, hints),
        check_question(recent_text),
        check_silence(recent_text, window_seconds),
    ];

    checks.into_iter().find(|r| r.triggered)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hint_trigger() {
        let hints = vec!["大家觉得怎么样".into(), "有没有问题".into()];
        let result = check_hint_triggers("我觉得这个方案不错，大家觉得怎么样", &hints);
        assert!(result.triggered);
    }

    #[test]
    fn test_question_trigger() {
        let result = check_question("这样做性能会不会有问题？");
        assert!(result.triggered);
    }
}
```

- [ ] **Step 2: Run the trigger rules tests**

```bash
cd /Users/bytedance/meeting-assistant/src-tauri
cargo test advisor::rules::tests -- --nocapture
```

Expected: Both tests pass.

- [ ] **Step 3: Create the LLM advisor engine**

Create `src-tauri/src/advisor/engine.rs`:

```rust
use anyhow::Result;
use serde::{Deserialize, Serialize};

use super::templates::MeetingTemplate;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LlmMessage {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct SpeakingAdvice {
    pub reason: String,
    pub suggestion: String,
    pub angle: String,
    pub timestamp: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct MeetingSummary {
    pub points: Vec<String>,
    pub current_topic: String,
}

pub struct AdvisorEngine {
    client: reqwest::Client,
    base_url: String,
    api_key: String,
    model: String,
}

impl AdvisorEngine {
    pub fn new(base_url: &str, api_key: &str, model: &str) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key: api_key.to_string(),
            model: model.to_string(),
        }
    }

    /// Call the LLM with the given messages. Returns the assistant's response text.
    async fn chat(&self, messages: &[LlmMessage]) -> Result<String> {
        let url = format!("{}/chat/completions", self.base_url);

        let body = serde_json::json!({
            "model": self.model,
            "messages": messages,
            "temperature": 0.7,
            "max_tokens": 500,
        });

        let mut req = self.client.post(&url).json(&body);
        if !self.api_key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", self.api_key));
        }

        let resp = req.send().await?;
        let json: serde_json::Value = resp.json().await?;
        let content = json["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();
        Ok(content)
    }

    /// Generate a meeting summary from recent transcript.
    pub async fn generate_summary(
        &self,
        transcript: &str,
        reference_docs: &str,
    ) -> Result<MeetingSummary> {
        let mut system = String::from(
            "你是一个会议记录助手。请根据以下会议转录内容，提取关键要点并总结当前正在讨论的话题。\n\
             输出格式：\n\
             要点：\n- 要点1\n- 要点2\n\n\
             当前讨论：一句话描述当前焦点话题"
        );

        if !reference_docs.is_empty() {
            system.push_str(&format!("\n\n参考文档：\n{}", reference_docs));
        }

        let messages = vec![
            LlmMessage { role: "system".into(), content: system },
            LlmMessage { role: "user".into(), content: format!("会议转录：\n{}", transcript) },
        ];

        let response = self.chat(&messages).await?;
        Ok(parse_summary(&response))
    }

    /// Generate speaking advice based on transcript, template, and trigger reason.
    pub async fn generate_advice(
        &self,
        template: &MeetingTemplate,
        transcript: &str,
        trigger_reason: &str,
        reference_docs: &str,
        offset_secs: f64,
    ) -> Result<SpeakingAdvice> {
        let mut system = template.system_prompt.clone();
        if !reference_docs.is_empty() {
            system.push_str(&format!("\n\n参考文档（用于提供背景上下文）：\n{}", reference_docs));
        }

        let user_msg = format!(
            "会议转录：\n{}\n\n触发原因：{}\n\n请给出发言建议。",
            transcript, trigger_reason
        );

        let messages = vec![
            LlmMessage { role: "system".into(), content: system },
            LlmMessage { role: "user".into(), content: user_msg },
        ];

        let response = self.chat(&messages).await?;
        Ok(parse_advice(&response, trigger_reason, offset_secs))
    }
}

fn parse_summary(text: &str) -> MeetingSummary {
    let mut points = Vec::new();
    let mut current_topic = String::new();
    let mut in_points = false;

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("- ") || trimmed.starts_with("• ") {
            points.push(trimmed.trim_start_matches("- ").trim_start_matches("• ").to_string());
            in_points = true;
        } else if trimmed.starts_with("当前讨论") || trimmed.starts_with("当前话题") {
            current_topic = trimmed
                .split_once(['：', ':'])
                .map(|(_, v)| v.trim().to_string())
                .unwrap_or_default();
        }
    }

    if points.is_empty() {
        points.push(text.trim().to_string());
    }

    MeetingSummary {
        points,
        current_topic,
    }
}

fn parse_advice(text: &str, trigger_reason: &str, offset_secs: f64) -> SpeakingAdvice {
    // Best-effort parsing: extract suggestion and angle from LLM response
    let lines: Vec<&str> = text.lines().collect();
    let suggestion = text.trim().to_string();
    let angle = lines
        .iter()
        .find(|l| l.contains("角度") || l.contains("视角"))
        .map(|l| {
            l.split_once(['：', ':'])
                .map(|(_, v)| v.trim().to_string())
                .unwrap_or_default()
        })
        .unwrap_or_default();

    SpeakingAdvice {
        reason: trigger_reason.to_string(),
        suggestion,
        angle,
        timestamp: offset_secs,
    }
}
```

- [ ] **Step 4: Update advisor mod.rs**

```rust
pub mod engine;
pub mod rules;
pub mod templates;
```

- [ ] **Step 5: Add the advisor loop to the recording pipeline**

Add to `src-tauri/src/commands.rs`, inside the `start_recording` function's spawned task, after the Whisper loop setup. The advisor runs as a separate concurrent task:

```rust
// In start_recording, after spawning the whisper loop, spawn the advisor loop:
let transcript_for_advisor = transcript.clone();
let win_for_advisor = window.clone();
tokio::spawn(async move {
    let config = config::load_config().unwrap_or_default();
    let advisor = crate::advisor::engine::AdvisorEngine::new(
        &config.llm.base_url,
        &config.llm.api_key,
        &config.llm.model,
    );

    // TODO: load selected template from state
    let templates = templates::list_templates().unwrap_or_default();
    let template = templates.first().cloned();

    let mut summary_interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
    let mut advice_interval = tokio::time::interval(tokio::time::Duration::from_secs(10));

    loop {
        tokio::select! {
            _ = summary_interval.tick() => {
                let text = {
                    let store = transcript_for_advisor.lock().unwrap();
                    store.full_text()
                };
                if !text.is_empty() {
                    if let Ok(summary) = advisor.generate_summary(&text, "").await {
                        let _ = win_for_advisor.emit("meeting-summary", &summary);
                    }
                }
            }
            _ = advice_interval.tick() => {
                if let Some(ref tmpl) = template {
                    let recent = {
                        let store = transcript_for_advisor.lock().unwrap();
                        store.recent_text(30.0)
                    };
                    if !recent.is_empty() {
                        if let Some(trigger) = crate::advisor::rules::evaluate_triggers(
                            &recent, &tmpl.trigger_hints, 10.0
                        ) {
                            let offset = start_time.elapsed().as_secs_f64();
                            if let Ok(advice) = advisor.generate_advice(
                                tmpl, &recent, &trigger.reason, "", offset
                            ).await {
                                let _ = win_for_advisor.emit("speaking-advice", &advice);
                            }
                        }
                    }
                }
            }
        }
    }
});
```

- [ ] **Step 6: Verify it compiles**

```bash
cd /Users/bytedance/meeting-assistant/src-tauri
cargo check
```

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/advisor/
git commit -m "feat: add LLM advisor engine with trigger rules and summary generation"
```

---

## Task 7: Document Loader (Rust)

**Files:**
- Create: `src-tauri/src/documents/mod.rs`
- Create: `src-tauri/src/documents/loader.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Create the document loader**

Create `src-tauri/src/documents/loader.rs`:

```rust
use anyhow::Result;
use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Clone, Debug, Serialize)]
pub struct LoadedDocument {
    pub filename: String,
    pub content: String,
    pub format: String,
}

/// Load a document file. Supports .md, .txt, .pdf (text extraction only).
pub fn load_document(path: &Path) -> Result<LoadedDocument> {
    let filename = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let content = match ext.as_str() {
        "md" | "txt" | "text" => fs::read_to_string(path)?,
        "pdf" => {
            // Basic PDF text extraction - in production use a proper PDF library
            // For now, fallback to reading raw bytes and extracting text-like content
            let bytes = fs::read(path)?;
            extract_pdf_text(&bytes).unwrap_or_else(|| {
                "[PDF 文件 - 无法提取文本，请转换为 Markdown 或纯文本格式]".into()
            })
        }
        _ => return Err(anyhow::anyhow!("Unsupported format: {}", ext)),
    };

    Ok(LoadedDocument {
        filename,
        content,
        format: ext,
    })
}

/// Very basic PDF text extraction (looks for text between BT/ET markers).
/// For production, use `pdf-extract` or `lopdf` crate.
fn extract_pdf_text(bytes: &[u8]) -> Option<String> {
    // Placeholder: return None to trigger the fallback message.
    // A real implementation would use a PDF parsing library.
    None
}

/// Chunk a document into paragraphs for context window management.
pub fn chunk_document(content: &str, max_chunk_chars: usize) -> Vec<String> {
    let paragraphs: Vec<&str> = content.split("\n\n").collect();
    let mut chunks = Vec::new();
    let mut current = String::new();

    for para in paragraphs {
        if current.len() + para.len() > max_chunk_chars && !current.is_empty() {
            chunks.push(current.clone());
            current.clear();
        }
        if !current.is_empty() {
            current.push_str("\n\n");
        }
        current.push_str(para);
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

/// Select the most relevant chunk based on keyword overlap with the transcript.
pub fn select_relevant_chunk(chunks: &[String], transcript: &str) -> String {
    if chunks.is_empty() {
        return String::new();
    }
    if chunks.len() == 1 {
        return chunks[0].clone();
    }

    // Simple keyword scoring: count how many transcript words appear in each chunk
    let transcript_words: Vec<&str> = transcript.split_whitespace().collect();
    let mut best_idx = 0;
    let mut best_score = 0;

    for (i, chunk) in chunks.iter().enumerate() {
        let chunk_lower = chunk.to_lowercase();
        let score = transcript_words
            .iter()
            .filter(|w| w.len() > 2 && chunk_lower.contains(&w.to_lowercase()))
            .count();
        if score > best_score {
            best_score = score;
            best_idx = i;
        }
    }

    chunks[best_idx].clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chunk_document() {
        let doc = "Para one.\n\nPara two.\n\nPara three which is longer.";
        let chunks = chunk_document(doc, 30);
        assert!(chunks.len() >= 2);
    }

    #[test]
    fn test_select_relevant() {
        let chunks = vec![
            "数据库设计和 schema 优化方案".into(),
            "前端 React 组件的测试策略".into(),
        ];
        let transcript = "我们来讨论一下数据库的 schema 怎么设计";
        let selected = select_relevant_chunk(&chunks, transcript);
        assert!(selected.contains("数据库"));
    }
}
```

Create `src-tauri/src/documents/mod.rs`:

```rust
pub mod loader;
```

- [ ] **Step 2: Run document loader tests**

```bash
cd /Users/bytedance/meeting-assistant/src-tauri
cargo test documents::loader::tests -- --nocapture
```

Expected: Both tests pass.

- [ ] **Step 3: Add document commands**

Add to `src-tauri/src/commands.rs`:

```rust
use crate::documents::loader::{self, LoadedDocument};

#[command]
pub fn load_document(path: String) -> Result<LoadedDocument, String> {
    loader::load_document(std::path::Path::new(&path)).map_err(|e| e.to_string())
}
```

Update `lib.rs`:

```rust
pub mod audio;
pub mod advisor;
pub mod commands;
pub mod documents;
pub mod storage;
pub mod transcript;
pub mod whisper;
```

Register in `main.rs` invoke_handler.

- [ ] **Step 4: Verify and commit**

```bash
cd /Users/bytedance/meeting-assistant/src-tauri
cargo check
```

```bash
git add src-tauri/src/documents/ src-tauri/src/lib.rs src-tauri/src/commands.rs
git commit -m "feat: add document loader with chunking and relevance selection"
```

---

## Task 8: Frontend — TypeScript Types + Tauri Bindings

**Files:**
- Create: `src/lib/types.ts`
- Create: `src/lib/tauri.ts`

- [ ] **Step 1: Define shared TypeScript types**

Create `src/lib/types.ts`:

```typescript
export interface AudioDevice {
  id: string;
  name: string;
}

export interface TranscriptSegment {
  timestamp: string;
  text: string;
  offset_secs: number;
}

export interface MeetingSummary {
  points: string[];
  current_topic: string;
}

export interface SpeakingAdvice {
  reason: string;
  suggestion: string;
  angle: string;
  timestamp: number;
}

export interface MeetingTemplate {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  trigger_hints: string[];
  advice_style: string;
  enabled: boolean;
}

export interface LlmConfig {
  base_url: string;
  api_key: string;
  model: string;
}

export interface AudioConfig {
  mic_device: string;
  capture_device: string;
  noise_reduction: boolean;
}

export interface AppConfig {
  llm: LlmConfig;
  audio: AudioConfig;
  language_preference: string;
  analysis_mode: string;
}

export interface ModelStatus {
  downloaded: boolean;
  path: string | null;
}

export interface LoadedDocument {
  filename: string;
  content: string;
  format: string;
}

export interface ModelDownloadProgress {
  downloaded: number;
  total: number;
}
```

- [ ] **Step 2: Create Tauri invoke/listen wrappers**

Create `src/lib/tauri.ts`:

```typescript
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AudioDevice,
  TranscriptSegment,
  MeetingSummary,
  SpeakingAdvice,
  MeetingTemplate,
  AppConfig,
  ModelStatus,
  LoadedDocument,
  ModelDownloadProgress,
} from "./types";

// Commands
export const listAudioDevices = () =>
  invoke<AudioDevice[]>("list_audio_devices");

export const checkWhisperModel = () =>
  invoke<ModelStatus>("check_whisper_model");

export const downloadWhisperModel = () =>
  invoke<string>("download_whisper_model");

export const startRecording = (micDevice: string, captureDevice: string) =>
  invoke<void>("start_recording", {
    micDevice,
    captureDevice,
  });

export const stopRecording = () => invoke<void>("stop_recording");

export const getTranscript = () =>
  invoke<TranscriptSegment[]>("get_transcript");

export const getTemplates = () =>
  invoke<MeetingTemplate[]>("get_templates");

export const saveTemplate = (template: MeetingTemplate) =>
  invoke<void>("save_template", { template });

export const deleteTemplate = (id: string) =>
  invoke<void>("delete_template", { id });

export const getConfig = () => invoke<AppConfig>("get_config");

export const saveConfig = (config: AppConfig) =>
  invoke<void>("save_config", { config });

export const loadDocument = (path: string) =>
  invoke<LoadedDocument>("load_document", { path });

// Event listeners
export const onNewTranscript = (
  handler: (segment: TranscriptSegment) => void,
): Promise<UnlistenFn> =>
  listen<TranscriptSegment>("new-transcript", (e) => handler(e.payload));

export const onMeetingSummary = (
  handler: (summary: MeetingSummary) => void,
): Promise<UnlistenFn> =>
  listen<MeetingSummary>("meeting-summary", (e) => handler(e.payload));

export const onSpeakingAdvice = (
  handler: (advice: SpeakingAdvice) => void,
): Promise<UnlistenFn> =>
  listen<SpeakingAdvice>("speaking-advice", (e) => handler(e.payload));

export const onModelDownloadProgress = (
  handler: (progress: ModelDownloadProgress) => void,
): Promise<UnlistenFn> =>
  listen<ModelDownloadProgress>("model-download-progress", (e) =>
    handler(e.payload),
  );
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/
git commit -m "feat: add TypeScript types and Tauri invoke/listen bindings"
```

---

## Task 9: Frontend — Narrow View (Main Meeting UI)

**Files:**
- Create: `src/hooks/useTauriEvents.ts`
- Create: `src/hooks/useRecording.ts`
- Create: `src/components/shared/AdviceCard.tsx`
- Create: `src/components/narrow/ControlBar.tsx`
- Create: `src/components/narrow/SummaryPanel.tsx`
- Create: `src/components/narrow/AdvicePanel.tsx`
- Create: `src/components/narrow/NarrowView.tsx`
- Modify: `src/App.tsx`

Reference the Pencil prototype screenshot of frame `WsKE4` for exact layout. Use Pencil MCP `get_screenshot("WsKE4")` to view it.

- [ ] **Step 1: Create the Tauri events hook**

Create `src/hooks/useTauriEvents.ts`:

```typescript
import { useEffect, useState, useRef } from "react";
import type {
  TranscriptSegment,
  MeetingSummary,
  SpeakingAdvice,
} from "../lib/types";
import {
  onNewTranscript,
  onMeetingSummary,
  onSpeakingAdvice,
} from "../lib/tauri";

export function useTauriEvents() {
  const [transcripts, setTranscripts] = useState<TranscriptSegment[]>([]);
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  const [advices, setAdvices] = useState<SpeakingAdvice[]>([]);
  const unlisteners = useRef<(() => void)[]>([]);

  useEffect(() => {
    const setup = async () => {
      const u1 = await onNewTranscript((segment) => {
        setTranscripts((prev) => [...prev, segment]);
      });
      const u2 = await onMeetingSummary((s) => {
        setSummary(s);
      });
      const u3 = await onSpeakingAdvice((advice) => {
        setAdvices((prev) => [advice, ...prev]);
      });
      unlisteners.current = [u1, u2, u3];
    };
    setup();

    return () => {
      unlisteners.current.forEach((u) => u());
    };
  }, []);

  const clearAll = () => {
    setTranscripts([]);
    setSummary(null);
    setAdvices([]);
  };

  return { transcripts, summary, advices, clearAll };
}
```

- [ ] **Step 2: Create the recording state hook**

Create `src/hooks/useRecording.ts`:

```typescript
import { useState, useRef, useCallback } from "react";
import { startRecording, stopRecording } from "../lib/tauri";

export type RecordingStatus = "idle" | "recording" | "paused";

export function useRecording() {
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(
    async (micDevice: string, captureDevice: string) => {
      await startRecording(micDevice, captureDevice);
      setStatus("recording");
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    },
    [],
  );

  const stop = useCallback(async () => {
    await stopRecording();
    setStatus("idle");
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const pause = useCallback(() => {
    setStatus("paused");
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resume = useCallback(() => {
    setStatus("recording");
    timerRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
  }, []);

  const formatTime = (secs: number) => {
    const h = String(Math.floor(secs / 3600)).padStart(2, "0");
    const m = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
    const s = String(secs % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  };

  return {
    status,
    elapsed,
    formattedTime: formatTime(elapsed),
    start,
    stop,
    pause,
    resume,
  };
}
```

- [ ] **Step 3: Create the AdviceCard shared component**

Create `src/components/shared/AdviceCard.tsx`:

```tsx
import type { SpeakingAdvice } from "../../lib/types";

interface AdviceCardProps {
  advice: SpeakingAdvice;
  isNew?: boolean;
}

export function AdviceCard({ advice, isNew = false }: AdviceCardProps) {
  return (
    <div
      className={`rounded-lg p-3 transition-opacity duration-1000 ${
        isNew
          ? "bg-[var(--accent-purple)]/15 border border-[var(--accent-purple)]/40"
          : "bg-[var(--bg-card)] opacity-60"
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[var(--accent-purple)] text-sm">✦</span>
        <span className="text-sm text-[var(--text-secondary)]">
          {advice.reason}
        </span>
      </div>
      <div className="text-sm leading-relaxed mb-2">
        <span className="text-[var(--text-muted)] text-xs">建议说：</span>
        <p className="mt-1 text-[var(--text-primary)]">
          "{advice.suggestion}"
        </p>
      </div>
      {advice.angle && (
        <div className="text-xs text-[var(--accent-purple)]">
          角度：{advice.angle}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create the ControlBar component**

Create `src/components/narrow/ControlBar.tsx`:

```tsx
import type { RecordingStatus } from "../../hooks/useRecording";

interface ControlBarProps {
  templateName: string;
  formattedTime: string;
  status: RecordingStatus;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSettings: () => void;
  onDocuments: () => void;
}

export function ControlBar({
  templateName,
  formattedTime,
  status,
  onPause,
  onResume,
  onStop,
  onSettings,
  onDocuments,
}: ControlBarProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
      <div className="flex items-center gap-2">
        {status === "recording" && (
          <span className="w-2 h-2 rounded-full bg-[var(--accent-red)] animate-pulse" />
        )}
        <span className="text-sm font-medium">{templateName}</span>
      </div>
      <span className="text-sm text-[var(--text-muted)] font-mono">
        {formattedTime}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={onDocuments}
          className="p-1.5 rounded hover:bg-[var(--bg-card)] text-sm"
          title="参考文档"
        >
          📎
        </button>
        <button
          onClick={onSettings}
          className="p-1.5 rounded hover:bg-[var(--bg-card)] text-sm"
          title="设置"
        >
          ⚙
        </button>
        {status === "recording" ? (
          <button
            onClick={onPause}
            className="p-1.5 rounded hover:bg-[var(--bg-card)] text-sm"
            title="暂停"
          >
            ⏸
          </button>
        ) : status === "paused" ? (
          <button
            onClick={onResume}
            className="p-1.5 rounded hover:bg-[var(--bg-card)] text-sm"
            title="继续"
          >
            ▶
          </button>
        ) : null}
        <button
          onClick={onStop}
          className="p-1.5 rounded hover:bg-[var(--bg-card)] text-sm text-[var(--accent-red)]"
          title="停止"
        >
          ■
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create the SummaryPanel component**

Create `src/components/narrow/SummaryPanel.tsx`:

```tsx
import type { MeetingSummary } from "../../lib/types";

interface SummaryPanelProps {
  summary: MeetingSummary | null;
}

export function SummaryPanel({ summary }: SummaryPanelProps) {
  return (
    <div className="px-4 py-3 border-b border-[var(--border)]">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium text-[var(--text-secondary)]">
          会议摘要
        </h2>
        {summary && (
          <span className="text-xs text-[var(--text-muted)]">
            {summary.points.length} 条要点
          </span>
        )}
      </div>
      {summary ? (
        <div className="space-y-1.5">
          {summary.points.map((point, i) => (
            <div key={i} className="flex gap-2 text-sm">
              <span className="text-[var(--text-muted)] shrink-0">•</span>
              <span className="text-[var(--text-primary)]">{point}</span>
            </div>
          ))}
          {summary.current_topic && (
            <div className="mt-2 pt-2 border-t border-[var(--border)]">
              <span className="text-xs text-[var(--text-muted)]">
                当前讨论：
              </span>
              <span className="text-xs text-[var(--accent-purple)]">
                {summary.current_topic}
              </span>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          等待会议内容...
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Create the AdvicePanel component**

Create `src/components/narrow/AdvicePanel.tsx`:

```tsx
import type { SpeakingAdvice } from "../../lib/types";
import { AdviceCard } from "../shared/AdviceCard";

interface AdvicePanelProps {
  advices: SpeakingAdvice[];
}

export function AdvicePanel({ advices }: AdvicePanelProps) {
  return (
    <div className="px-4 py-3 flex-1 overflow-y-auto">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium text-[var(--text-secondary)]">
          发言建议
        </h2>
        {advices.length > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-[var(--accent-purple)]/20 text-[var(--accent-purple)]">
            新建议!
          </span>
        )}
      </div>
      {advices.length > 0 ? (
        <div className="space-y-3">
          {advices.map((advice, i) => (
            <AdviceCard key={i} advice={advice} isNew={i === 0} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          等待合适的发言时机...
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Create the NarrowView layout**

Create `src/components/narrow/NarrowView.tsx`:

```tsx
import { ControlBar } from "./ControlBar";
import { SummaryPanel } from "./SummaryPanel";
import { AdvicePanel } from "./AdvicePanel";
import { useTauriEvents } from "../../hooks/useTauriEvents";
import { useRecording } from "../../hooks/useRecording";

interface NarrowViewProps {
  onSettings: () => void;
  onFullView: () => void;
}

export function NarrowView({ onSettings, onFullView }: NarrowViewProps) {
  const { summary, advices } = useTauriEvents();
  const recording = useRecording();

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-primary)]">
      <ControlBar
        templateName="技术评审会"
        formattedTime={recording.formattedTime}
        status={recording.status}
        onPause={recording.pause}
        onResume={recording.resume}
        onStop={recording.stop}
        onSettings={onSettings}
        onDocuments={() => {}}
      />
      <SummaryPanel summary={summary} />
      <AdvicePanel advices={advices} />
    </div>
  );
}
```

- [ ] **Step 8: Update App.tsx to use NarrowView**

Update `src/App.tsx`:

```tsx
import { useState } from "react";
import { NarrowView } from "./components/narrow/NarrowView";

type View = "narrow" | "full" | "settings";

export default function App() {
  const [view, setView] = useState<View>("narrow");

  return (
    <div className="h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {view === "narrow" && (
        <NarrowView
          onSettings={() => setView("settings")}
          onFullView={() => setView("full")}
        />
      )}
      {view === "full" && (
        <div className="p-4">
          <button onClick={() => setView("narrow")} className="text-sm text-[var(--text-secondary)]">
            ← Back to Narrow
          </button>
          <h1 className="text-xl mt-4">Full View (Task 10)</h1>
        </div>
      )}
      {view === "settings" && (
        <div className="p-4">
          <button onClick={() => setView("narrow")} className="text-sm text-[var(--text-secondary)]">
            ← Back
          </button>
          <h1 className="text-xl mt-4">Settings (Task 11)</h1>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 9: Verify the frontend compiles**

```bash
cd /Users/bytedance/meeting-assistant
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 10: Commit**

```bash
git add src/
git commit -m "feat: implement narrow view UI with control bar, summary, and advice panels"
```

---

## Task 10: Frontend — Full View (Three-Column Layout)

**Files:**
- Create: `src/components/full/FullView.tsx`
- Create: `src/components/full/Sidebar.tsx`
- Create: `src/components/full/TranscriptPanel.tsx`
- Create: `src/components/full/CopilotPanel.tsx`
- Create: `src/components/shared/DocumentPanel.tsx`
- Modify: `src/App.tsx`

Reference Pencil prototype frame `hQHPH` for layout.

- [ ] **Step 1: Create the Sidebar (left column)**

Create `src/components/full/Sidebar.tsx`:

```tsx
import { useState, useEffect } from "react";
import type { MeetingTemplate, LoadedDocument } from "../../lib/types";
import { getTemplates } from "../../lib/tauri";

interface SidebarProps {
  onStop: () => void;
  onSettings: () => void;
  documents: LoadedDocument[];
  onAddDocument: () => void;
}

export function Sidebar({
  onStop,
  onSettings,
  documents,
  onAddDocument,
}: SidebarProps) {
  const [templates, setTemplates] = useState<MeetingTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");

  useEffect(() => {
    getTemplates().then((t) => {
      setTemplates(t);
      if (t.length > 0) setSelectedTemplate(t[0].id);
    });
  }, []);

  return (
    <div className="w-64 border-r border-[var(--border)] flex flex-col bg-[var(--bg-secondary)]">
      <div className="p-4 border-b border-[var(--border)]">
        <h1 className="text-lg font-semibold">Meeting Copilot</h1>
        <span className="text-xs text-[var(--accent-green)]">● LIVE</span>
      </div>

      <div className="p-4 flex-1 overflow-y-auto">
        <h3 className="text-xs text-[var(--text-muted)] uppercase mb-2">
          会议类型
        </h3>
        <div className="space-y-1 mb-6">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedTemplate(t.id)}
              className={`w-full text-left px-3 py-2 rounded text-sm ${
                selectedTemplate === t.id
                  ? "bg-[var(--accent-purple)]/20 text-[var(--accent-purple)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-card)]"
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>

        <h3 className="text-xs text-[var(--text-muted)] uppercase mb-2">
          参考文档
        </h3>
        <div className="space-y-1">
          {documents.map((doc, i) => (
            <div
              key={i}
              className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--bg-card)] text-sm"
            >
              <span>📄</span>
              <span className="truncate text-[var(--text-secondary)]">
                {doc.filename}
              </span>
            </div>
          ))}
          <button
            onClick={onAddDocument}
            className="w-full text-left px-3 py-2 rounded text-sm text-[var(--text-muted)] hover:bg-[var(--bg-card)]"
          >
            + Add document
          </button>
        </div>
      </div>

      <div className="p-4 border-t border-[var(--border)] space-y-2">
        <button
          onClick={onStop}
          className="w-full py-2 rounded bg-[var(--accent-red)]/20 text-[var(--accent-red)] text-sm hover:bg-[var(--accent-red)]/30"
        >
          ⏹ Stop Recording
        </button>
        <button
          onClick={onSettings}
          className="w-full py-2 rounded bg-[var(--bg-card)] text-[var(--text-secondary)] text-sm hover:bg-[var(--bg-card-hover)]"
        >
          Settings
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the TranscriptPanel (center column)**

Create `src/components/full/TranscriptPanel.tsx`:

```tsx
import { useEffect, useRef } from "react";
import type { TranscriptSegment } from "../../lib/types";

interface TranscriptPanelProps {
  transcripts: TranscriptSegment[];
}

export function TranscriptPanel({ transcripts }: TranscriptPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts]);

  const formatOffset = (secs: number) => {
    const m = String(Math.floor(secs / 60)).padStart(2, "0");
    const s = String(Math.floor(secs % 60)).padStart(2, "0");
    return `${m}:${s}`;
  };

  return (
    <div className="flex-1 flex flex-col border-r border-[var(--border)]">
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
        <h2 className="text-sm font-medium">Live Transcript</h2>
        <span className="text-xs text-[var(--accent-green)]">● LIVE</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {transcripts.map((seg, i) => (
          <div key={i} className="flex gap-3">
            <span className="text-xs text-[var(--text-muted)] shrink-0 pt-0.5 font-mono">
              {formatOffset(seg.offset_secs)}
            </span>
            <p className="text-sm text-[var(--text-primary)] leading-relaxed">
              {seg.text}
            </p>
          </div>
        ))}
        {transcripts.length === 0 && (
          <p className="text-sm text-[var(--text-muted)] text-center mt-8">
            Transcribing...
          </p>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create the CopilotPanel (right column)**

Create `src/components/full/CopilotPanel.tsx`:

```tsx
import type { MeetingSummary, SpeakingAdvice } from "../../lib/types";
import { AdviceCard } from "../shared/AdviceCard";

interface CopilotPanelProps {
  summary: MeetingSummary | null;
  advices: SpeakingAdvice[];
}

export function CopilotPanel({ summary, advices }: CopilotPanelProps) {
  return (
    <div className="w-80 flex flex-col">
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <h2 className="text-sm font-medium">AI Copilot</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Summary section */}
        <div>
          <h3 className="text-xs text-[var(--accent-orange)] uppercase mb-2">
            ● Meeting Summary
          </h3>
          {summary ? (
            <div className="text-sm text-[var(--text-secondary)] space-y-1">
              {summary.points.map((p, i) => (
                <p key={i}>• {p}</p>
              ))}
              {summary.current_topic && (
                <p className="text-[var(--accent-purple)] mt-2">
                  当前：{summary.current_topic}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">
              Analyzing discussion...
            </p>
          )}
        </div>

        {/* Advice section */}
        <div>
          <h3 className="text-xs text-[var(--accent-purple)] uppercase mb-2">
            ✦ Speaking Suggestions
          </h3>
          <div className="space-y-3">
            {advices.map((advice, i) => (
              <AdviceCard key={i} advice={advice} isNew={i === 0} />
            ))}
            {advices.length === 0 && (
              <p className="text-sm text-[var(--text-muted)]">
                Waiting for the right moment...
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create the FullView layout**

Create `src/components/full/FullView.tsx`:

```tsx
import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { TranscriptPanel } from "./TranscriptPanel";
import { CopilotPanel } from "./CopilotPanel";
import { useTauriEvents } from "../../hooks/useTauriEvents";
import type { LoadedDocument } from "../../lib/types";

interface FullViewProps {
  onNarrowView: () => void;
  onSettings: () => void;
}

export function FullView({ onNarrowView, onSettings }: FullViewProps) {
  const { transcripts, summary, advices } = useTauriEvents();
  const [documents, setDocuments] = useState<LoadedDocument[]>([]);

  return (
    <div className="flex h-screen bg-[var(--bg-primary)]">
      <Sidebar
        onStop={onNarrowView}
        onSettings={onSettings}
        documents={documents}
        onAddDocument={() => {
          // TODO: open file dialog via Tauri
        }}
      />
      <TranscriptPanel transcripts={transcripts} />
      <CopilotPanel summary={summary} advices={advices} />
    </div>
  );
}
```

- [ ] **Step 5: Update App.tsx**

```tsx
import { useState } from "react";
import { NarrowView } from "./components/narrow/NarrowView";
import { FullView } from "./components/full/FullView";

type View = "narrow" | "full" | "settings";

export default function App() {
  const [view, setView] = useState<View>("narrow");

  return (
    <div className="h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {view === "narrow" && (
        <NarrowView
          onSettings={() => setView("settings")}
          onFullView={() => setView("full")}
        />
      )}
      {view === "full" && (
        <FullView
          onNarrowView={() => setView("narrow")}
          onSettings={() => setView("settings")}
        />
      )}
      {view === "settings" && (
        <div className="p-4">
          <button
            onClick={() => setView("narrow")}
            className="text-sm text-[var(--text-secondary)]"
          >
            ← Back
          </button>
          <h1 className="text-xl mt-4">Settings (Task 11)</h1>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit
git add src/
git commit -m "feat: implement full view three-column layout with transcript and copilot panels"
```

---

## Task 11: Frontend — Settings View

**Files:**
- Create: `src/components/settings/SettingsView.tsx`
- Create: `src/components/settings/AudioSettings.tsx`
- Create: `src/components/settings/LLMSettings.tsx`
- Create: `src/components/settings/ProfileSettings.tsx`
- Modify: `src/App.tsx`

Reference Pencil prototype frame `ZHWzZ` for layout.

- [ ] **Step 1: Create AudioSettings**

Create `src/components/settings/AudioSettings.tsx`:

```tsx
import { useState, useEffect } from "react";
import type { AudioDevice, AppConfig } from "../../lib/types";
import { listAudioDevices } from "../../lib/tauri";

interface AudioSettingsProps {
  config: AppConfig;
  onChange: (config: AppConfig) => void;
}

export function AudioSettings({ config, onChange }: AudioSettingsProps) {
  const [devices, setDevices] = useState<AudioDevice[]>([]);

  useEffect(() => {
    listAudioDevices().then(setDevices).catch(console.error);
  }, []);

  const update = (partial: Partial<AppConfig["audio"]>) => {
    onChange({ ...config, audio: { ...config.audio, ...partial } });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">Audio Settings</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Configure audio capture for real-time speech recognition during
          meetings.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[var(--bg-card)] rounded-lg p-4">
          <label className="text-sm font-medium block mb-2">
            System Audio Source
          </label>
          <select
            value={config.audio.capture_device}
            onChange={(e) => update({ capture_device: e.target.value })}
            className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-3 py-2 text-sm"
          >
            <option value="">Select device...</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            选择黑洞等虚拟音频设备 (BlackHole) 来捕获会议音频流
          </p>
        </div>

        <div className="bg-[var(--bg-card)] rounded-lg p-4">
          <label className="text-sm font-medium block mb-2">
            Microphone Input
          </label>
          <select
            value={config.audio.mic_device}
            onChange={(e) => update({ mic_device: e.target.value })}
            className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-3 py-2 text-sm"
          >
            <option value="">Select device...</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            选择你的麦克风以捕获自己的声音
          </p>
        </div>

        <div className="bg-[var(--bg-card)] rounded-lg p-4">
          <label className="text-sm font-medium block mb-2">
            Audio Quality
          </label>
          <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-3 py-2 text-sm text-[var(--text-muted)]">
            16kHz Mono (Whisper)
          </div>
        </div>

        <div className="bg-[var(--bg-card)] rounded-lg p-4">
          <label className="text-sm font-medium block mb-2">
            Noise Reduction
          </label>
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--text-secondary)]">
              Apply real-time noise reduction
            </span>
            <button
              onClick={() =>
                update({ noise_reduction: !config.audio.noise_reduction })
              }
              className={`w-10 h-6 rounded-full transition-colors ${
                config.audio.noise_reduction
                  ? "bg-[var(--accent-purple)]"
                  : "bg-[var(--border)]"
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white mx-1 transition-transform ${
                  config.audio.noise_reduction ? "translate-x-4" : ""
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create LLMSettings**

Create `src/components/settings/LLMSettings.tsx`:

```tsx
import type { AppConfig } from "../../lib/types";

interface LLMSettingsProps {
  config: AppConfig;
  onChange: (config: AppConfig) => void;
}

export function LLMSettings({ config, onChange }: LLMSettingsProps) {
  const updateLlm = (partial: Partial<AppConfig["llm"]>) => {
    onChange({ ...config, llm: { ...config.llm, ...partial } });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">AI / LLM Settings</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Configure the language model for real-time meeting analysis and
          suggestion generation.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[var(--bg-card)] rounded-lg p-4">
          <label className="text-sm font-medium block mb-2">
            Model Provider
          </label>
          <select
            value={config.llm.base_url}
            onChange={(e) => updateLlm({ base_url: e.target.value })}
            className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-3 py-2 text-sm"
          >
            <option value="http://localhost:11434/v1">Ollama (Local)</option>
            <option value="https://api.openai.com/v1">OpenAI</option>
            <option value="https://api.anthropic.com/v1">Anthropic</option>
          </select>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            支持 OpenAI 兼容 API 格式，默认走本地 Ollama (localhost:11434)
          </p>
        </div>

        <div className="bg-[var(--bg-card)] rounded-lg p-4">
          <label className="text-sm font-medium block mb-2">API Key</label>
          <input
            type="password"
            value={config.llm.api_key}
            onChange={(e) => updateLlm({ api_key: e.target.value })}
            placeholder="sk-ant-..."
            className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-3 py-2 text-sm"
          />
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Your API key is stored locally and never sent to our servers.
          </p>
        </div>

        <div className="bg-[var(--bg-card)] rounded-lg p-4">
          <label className="text-sm font-medium block mb-2">Model</label>
          <input
            value={config.llm.model}
            onChange={(e) => updateLlm({ model: e.target.value })}
            placeholder="llama3.2"
            className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-3 py-2 text-sm"
          />
        </div>

        <div className="bg-[var(--bg-card)] rounded-lg p-4">
          <label className="text-sm font-medium block mb-2">
            Language Preference
          </label>
          <select
            value={config.language_preference}
            onChange={(e) =>
              onChange({ ...config, language_preference: e.target.value })
            }
            className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-3 py-2 text-sm"
          >
            <option value="auto">Auto (中英混合)</option>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create ProfileSettings**

Create `src/components/settings/ProfileSettings.tsx`:

```tsx
import { useState, useEffect } from "react";
import type { MeetingTemplate } from "../../lib/types";
import { getTemplates, saveTemplate as saveTemplateApi } from "../../lib/tauri";

export function ProfileSettings() {
  const [templates, setTemplates] = useState<MeetingTemplate[]>([]);

  useEffect(() => {
    getTemplates().then(setTemplates).catch(console.error);
  }, []);

  const toggleTemplate = async (id: string) => {
    const updated = templates.map((t) =>
      t.id === id ? { ...t, enabled: !t.enabled } : t,
    );
    setTemplates(updated);
    const target = updated.find((t) => t.id === id);
    if (target) await saveTemplateApi(target);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-1">Meeting Profiles</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Configure meeting templates for different scenarios.
        </p>
      </div>

      <div className="space-y-3">
        {templates.map((t) => (
          <div
            key={t.id}
            className="bg-[var(--bg-card)] rounded-lg p-4 flex items-center justify-between"
          >
            <div>
              <h3 className="text-sm font-medium">{t.name}</h3>
              <p className="text-xs text-[var(--text-muted)]">
                {t.description}
              </p>
            </div>
            <button
              onClick={() => toggleTemplate(t.id)}
              className={`w-10 h-6 rounded-full transition-colors ${
                t.enabled
                  ? "bg-[var(--accent-purple)]"
                  : "bg-[var(--border)]"
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white mx-1 transition-transform ${
                  t.enabled ? "translate-x-4" : ""
                }`}
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create SettingsView shell with navigation**

Create `src/components/settings/SettingsView.tsx`:

```tsx
import { useState, useEffect } from "react";
import type { AppConfig } from "../../lib/types";
import { getConfig, saveConfig as saveConfigApi } from "../../lib/tauri";
import { AudioSettings } from "./AudioSettings";
import { LLMSettings } from "./LLMSettings";
import { ProfileSettings } from "./ProfileSettings";

type SettingsTab = "audio" | "llm" | "profiles" | "hotkeys" | "about";

interface SettingsViewProps {
  onBack: () => void;
}

export function SettingsView({ onBack }: SettingsViewProps) {
  const [tab, setTab] = useState<SettingsTab>("audio");
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    getConfig().then(setConfig).catch(console.error);
  }, []);

  const handleConfigChange = async (newConfig: AppConfig) => {
    setConfig(newConfig);
    await saveConfigApi(newConfig);
  };

  const tabs: { id: SettingsTab; label: string; icon: string }[] = [
    { id: "audio", label: "Audio Settings", icon: "🎙" },
    { id: "llm", label: "AI / LLM", icon: "🤖" },
    { id: "profiles", label: "Meeting Profiles", icon: "📋" },
    { id: "hotkeys", label: "Hotkeys", icon: "⌨" },
    { id: "about", label: "About", icon: "○" },
  ];

  return (
    <div className="flex h-screen bg-[var(--bg-primary)]">
      {/* Sidebar nav */}
      <div className="w-56 border-r border-[var(--border)] bg-[var(--bg-secondary)] p-4">
        <div className="mb-6">
          <button
            onClick={onBack}
            className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            ← Meeting Copilot
          </button>
          <h2 className="text-xs text-[var(--text-muted)] mt-4">Settings</h2>
        </div>
        <div className="space-y-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full text-left px-3 py-2 rounded text-sm flex items-center gap-2 ${
                tab === t.id
                  ? "bg-[var(--accent-purple)]/20 text-[var(--accent-purple)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-card)]"
              }`}
            >
              <span>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-8 overflow-y-auto">
        {config && tab === "audio" && (
          <AudioSettings config={config} onChange={handleConfigChange} />
        )}
        {config && tab === "llm" && (
          <LLMSettings config={config} onChange={handleConfigChange} />
        )}
        {tab === "profiles" && <ProfileSettings />}
        {tab === "hotkeys" && (
          <div>
            <h2 className="text-xl font-semibold">Hotkeys</h2>
            <p className="text-sm text-[var(--text-muted)] mt-2">
              Coming soon.
            </p>
          </div>
        )}
        {tab === "about" && (
          <div>
            <h2 className="text-xl font-semibold">About</h2>
            <p className="text-sm text-[var(--text-secondary)] mt-2">
              Meeting Copilot v0.1.0
            </p>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              本地优先的 AI 会议助手。音频处理和语音识别全部在本地完成。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Update App.tsx to use SettingsView**

```tsx
import { useState } from "react";
import { NarrowView } from "./components/narrow/NarrowView";
import { FullView } from "./components/full/FullView";
import { SettingsView } from "./components/settings/SettingsView";

type View = "narrow" | "full" | "settings";

export default function App() {
  const [view, setView] = useState<View>("narrow");

  return (
    <div className="h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {view === "narrow" && (
        <NarrowView
          onSettings={() => setView("settings")}
          onFullView={() => setView("full")}
        />
      )}
      {view === "full" && (
        <FullView
          onNarrowView={() => setView("narrow")}
          onSettings={() => setView("settings")}
        />
      )}
      {view === "settings" && (
        <SettingsView onBack={() => setView("narrow")} />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit
git add src/
git commit -m "feat: implement settings view with audio, LLM, and profile configuration"
```

---

## Task 12: First-Run Setup Guide + Integration Testing

**Files:**
- Create: `src/components/shared/SetupGuide.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create the SetupGuide component**

Create `src/components/shared/SetupGuide.tsx`:

```tsx
import { useState, useEffect } from "react";
import { checkWhisperModel, downloadWhisperModel, onModelDownloadProgress } from "../../lib/tauri";

type SetupStep = "blackhole" | "model" | "config" | "test" | "done";

interface SetupGuideProps {
  onComplete: () => void;
}

export function SetupGuide({ onComplete }: SetupGuideProps) {
  const [step, setStep] = useState<SetupStep>("blackhole");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const unsub = onModelDownloadProgress((p) => {
      if (p.total > 0) {
        setDownloadProgress(Math.round((p.downloaded / p.total) * 100));
      }
    });
    return () => { unsub.then(u => u()); };
  }, []);

  const handleDownloadModel = async () => {
    setDownloading(true);
    try {
      await downloadWhisperModel();
      setStep("config");
    } catch (e) {
      console.error("Download failed:", e);
    }
    setDownloading(false);
  };

  const checkModel = async () => {
    const status = await checkWhisperModel();
    if (status.downloaded) {
      setStep("config");
    } else {
      setStep("model");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-[var(--bg-primary)] p-8">
      <h1 className="text-2xl font-bold mb-8">Welcome to Meeting Copilot</h1>

      {step === "blackhole" && (
        <div className="max-w-md text-center space-y-4">
          <h2 className="text-lg font-medium">Step 1: 安装 BlackHole 虚拟音频</h2>
          <p className="text-sm text-[var(--text-secondary)]">
            BlackHole 是免费的 macOS 虚拟音频驱动，用于捕获远程会议的音频。
          </p>
          <ol className="text-sm text-[var(--text-secondary)] text-left space-y-2">
            <li>1. 下载并安装 BlackHole 2ch</li>
            <li>2. 打开 macOS "Audio MIDI Setup"</li>
            <li>3. 创建 "多输出设备"，包含你的耳机 + BlackHole 2ch</li>
            <li>4. 将系统音频输出设为该多输出设备</li>
          </ol>
          <div className="flex gap-3 justify-center mt-4">
            <button
              onClick={() => setStep("model")}
              className="px-4 py-2 rounded bg-[var(--accent-purple)] text-white text-sm"
            >
              已完成，继续 →
            </button>
            <button
              onClick={() => setStep("model")}
              className="px-4 py-2 rounded bg-[var(--bg-card)] text-[var(--text-secondary)] text-sm"
            >
              稍后设置
            </button>
          </div>
        </div>
      )}

      {step === "model" && (
        <div className="max-w-md text-center space-y-4">
          <h2 className="text-lg font-medium">Step 2: 下载语音识别模型</h2>
          <p className="text-sm text-[var(--text-secondary)]">
            Whisper small 模型 (~466MB)，用于本地语音转文字。
          </p>
          {downloading ? (
            <div className="w-full bg-[var(--bg-card)] rounded-full h-3">
              <div
                className="bg-[var(--accent-purple)] h-3 rounded-full transition-all"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
          ) : (
            <button
              onClick={handleDownloadModel}
              className="px-4 py-2 rounded bg-[var(--accent-purple)] text-white text-sm"
            >
              开始下载
            </button>
          )}
          <p className="text-xs text-[var(--text-muted)]">
            {downloading ? `${downloadProgress}%` : "下载后模型将保存在本地"}
          </p>
        </div>
      )}

      {step === "config" && (
        <div className="max-w-md text-center space-y-4">
          <h2 className="text-lg font-medium">Step 3: 配置 LLM</h2>
          <p className="text-sm text-[var(--text-secondary)]">
            默认使用本地 Ollama。确保 Ollama 已运行并加载了模型。
          </p>
          <button
            onClick={onComplete}
            className="px-4 py-2 rounded bg-[var(--accent-purple)] text-white text-sm"
          >
            开始使用 →
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add first-run check to App.tsx**

```tsx
import { useState, useEffect } from "react";
import { NarrowView } from "./components/narrow/NarrowView";
import { FullView } from "./components/full/FullView";
import { SettingsView } from "./components/settings/SettingsView";
import { SetupGuide } from "./components/shared/SetupGuide";
import { checkWhisperModel } from "./lib/tauri";

type View = "setup" | "narrow" | "full" | "settings";

export default function App() {
  const [view, setView] = useState<View>("narrow");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkWhisperModel()
      .then((status) => {
        if (!status.downloaded) {
          setView("setup");
        }
      })
      .catch(() => {
        // If check fails, go to setup
        setView("setup");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--bg-primary)] text-[var(--text-muted)]">
        Loading...
      </div>
    );
  }

  return (
    <div className="h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {view === "setup" && (
        <SetupGuide onComplete={() => setView("narrow")} />
      )}
      {view === "narrow" && (
        <NarrowView
          onSettings={() => setView("settings")}
          onFullView={() => setView("full")}
        />
      )}
      {view === "full" && (
        <FullView
          onNarrowView={() => setView("narrow")}
          onSettings={() => setView("settings")}
        />
      )}
      {view === "settings" && (
        <SettingsView onBack={() => setView("narrow")} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Full build verification**

```bash
cd /Users/bytedance/meeting-assistant
npx tsc --noEmit
cargo tauri build --debug 2>&1 | tail -10
```

Expected: Both TypeScript and Rust compile without errors.

- [ ] **Step 4: Manual smoke test**

```bash
cargo tauri dev
```

Verify:
1. App opens showing either SetupGuide (if no Whisper model) or NarrowView
2. Settings page opens and shows audio devices
3. Views switch correctly between narrow/full/settings

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "feat: add first-run setup guide and complete view routing"
```

---

## Task 13: Meeting History (Optional SQLite Storage)

**Files:**
- Create: `src-tauri/src/storage/history.rs`
- Modify: `src-tauri/src/storage/mod.rs`
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Create the history module**

Create `src-tauri/src/storage/history.rs`:

```rust
use anyhow::Result;
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Clone, Debug, Serialize)]
pub struct MeetingRecord {
    pub id: String,
    pub template_name: String,
    pub started_at: String,
    pub duration_secs: i64,
    pub transcript: String,
    pub summary: String,
    pub advices_json: String,
}

fn db_path() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("No home dir"))?;
    let dir = home.join(".meeting-assistant");
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("history.db"))
}

pub fn init_db() -> Result<Connection> {
    let conn = Connection::open(db_path()?)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS meetings (
            id TEXT PRIMARY KEY,
            template_name TEXT NOT NULL,
            started_at TEXT NOT NULL,
            duration_secs INTEGER NOT NULL,
            transcript TEXT NOT NULL,
            summary TEXT NOT NULL,
            advices_json TEXT NOT NULL
        )",
    )?;
    Ok(conn)
}

pub fn save_meeting(record: &MeetingRecord) -> Result<()> {
    let conn = init_db()?;
    conn.execute(
        "INSERT OR REPLACE INTO meetings (id, template_name, started_at, duration_secs, transcript, summary, advices_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            record.id,
            record.template_name,
            record.started_at,
            record.duration_secs,
            record.transcript,
            record.summary,
            record.advices_json,
        ],
    )?;
    Ok(())
}

pub fn list_meetings() -> Result<Vec<MeetingRecord>> {
    let conn = init_db()?;
    let mut stmt = conn.prepare(
        "SELECT id, template_name, started_at, duration_secs, transcript, summary, advices_json
         FROM meetings ORDER BY started_at DESC LIMIT 50",
    )?;
    let records = stmt
        .query_map([], |row| {
            Ok(MeetingRecord {
                id: row.get(0)?,
                template_name: row.get(1)?,
                started_at: row.get(2)?,
                duration_secs: row.get(3)?,
                transcript: row.get(4)?,
                summary: row.get(5)?,
                advices_json: row.get(6)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(records)
}
```

- [ ] **Step 2: Update storage mod.rs**

```rust
pub mod config;
pub mod history;
```

- [ ] **Step 3: Add Tauri commands for history**

Add to `src-tauri/src/commands.rs`:

```rust
use crate::storage::history::{self, MeetingRecord};

#[command]
pub fn save_meeting(record: MeetingRecord) -> Result<(), String> {
    history::save_meeting(&record).map_err(|e| e.to_string())
}

#[command]
pub fn list_meetings() -> Result<Vec<MeetingRecord>, String> {
    history::list_meetings().map_err(|e| e.to_string())
}
```

Register in `main.rs`.

- [ ] **Step 4: Verify and commit**

```bash
cargo check
git add src-tauri/src/storage/ src-tauri/src/commands.rs src-tauri/src/main.rs
git commit -m "feat: add meeting history SQLite storage"
```

---

## Task 14: Final Integration + Polish

**Files:**
- Modify: Various files for wiring everything together

- [ ] **Step 1: Wire document loading with file dialog**

Install Tauri dialog plugin:

```bash
cd /Users/bytedance/meeting-assistant
npm install @tauri-apps/plugin-dialog
```

Add to `src-tauri/Cargo.toml`:

```toml
tauri-plugin-dialog = "2"
```

Register in `main.rs`:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    // ... rest
```

Update `capabilities/default.json` to include dialog permissions:

```json
"permissions": [
    "core:default",
    "core:window:allow-set-always-on-top",
    "core:window:allow-set-size",
    "core:window:allow-set-title",
    "dialog:allow-open",
    "shell:allow-open"
]
```

- [ ] **Step 2: Update FullView to use file dialog for document adding**

Update `src/components/full/FullView.tsx` — replace the `onAddDocument` callback:

```tsx
import { open } from "@tauri-apps/plugin-dialog";
import { loadDocument } from "../../lib/tauri";

// Inside FullView component:
const handleAddDocument = async () => {
  const selected = await open({
    multiple: false,
    filters: [
      { name: "Documents", extensions: ["md", "txt", "pdf"] },
    ],
  });
  if (selected) {
    try {
      const doc = await loadDocument(selected as string);
      setDocuments((prev) => [...prev, doc]);
    } catch (e) {
      console.error("Failed to load document:", e);
    }
  }
};
```

- [ ] **Step 3: Copy bundled templates on first launch**

In `main.rs`, before building Tauri, copy default templates:

```rust
// Copy bundled templates on first launch
let exe_dir = std::env::current_exe()
    .ok()
    .and_then(|p| p.parent().map(|p| p.to_path_buf()));
if let Some(dir) = exe_dir {
    let bundled = dir.join("../Resources/templates"); // macOS bundle path
    let _ = crate::advisor::templates::ensure_default_templates(&bundled);
}
// Fallback: try relative to project root (dev mode)
let _ = crate::advisor::templates::ensure_default_templates(std::path::Path::new("../templates"));
```

- [ ] **Step 4: Full build and smoke test**

```bash
cd /Users/bytedance/meeting-assistant
npx tsc --noEmit
cargo tauri build --debug
```

Launch and verify:
1. First-run setup guide works
2. Settings page shows audio devices
3. Templates are loaded
4. Views switch correctly
5. Window is 420×840 and always-on-top

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat: complete meeting assistant v1 with all features integrated"
```

---

## Summary

| Task | Description | Est. |
|------|-------------|------|
| 1 | Project scaffold (Tauri + React + Tailwind) | foundational |
| 2 | Audio capture module (cpal + ring buffer) | core |
| 3 | Whisper engine (model download + transcription) | core |
| 4 | Transcript store + recording pipeline | core |
| 5 | Meeting templates + config storage | data layer |
| 6 | LLM advisor engine (trigger rules + advice gen) | core |
| 7 | Document loader (chunking + relevance) | feature |
| 8 | TypeScript types + Tauri bindings | frontend setup |
| 9 | Narrow view UI (control bar + summary + advice) | UI |
| 10 | Full view UI (three-column layout) | UI |
| 11 | Settings view (audio + LLM + profiles) | UI |
| 12 | Setup guide + integration testing | integration |
| 13 | Meeting history (SQLite) | optional feature |
| 14 | Final integration + polish | wiring |

Total: 14 tasks, building from foundation → core backend → frontend → integration.
