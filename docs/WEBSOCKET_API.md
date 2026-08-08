# MERaLiON-SER 实时语音情感识别 · WebSocket 接口文档

本文档面向**前端对接开发**，完整描述 `/ws` WebSocket 端点的通信协议：
连接地址、客户端上行数据格式、服务端下行数据格式、支持的功能，以及重连注意事项。

---

## 1. 连接信息

| 项目 | 值 |
|---|---|
| WebSocket 地址 | `ws://127.0.0.1:8000/ws` |
| HTTP 页面（调试用） | `http://127.0.0.1:8000/` |
| 默认端口 | `8000` |
| 默认绑定 | `127.0.0.1`（仅本机回环） |
| 协议 | WebSocket（二进制 + 文本混合帧） |
| 数据编码 | JSON（UTF-8） |

> 端口与绑定地址可用命令行参数修改：`python app.py --host <ip> --port <port>`。
> 若部署到远端 / 走 HTTPS，浏览器前端需对应使用 `wss://` 或 `ws://<host>:<port>`。

### 启动服务

```bash
cd app/ser_streaming
python app.py --port 8000
```

启动时加载 SER（情绪）+ funasr（VAD / 流式 ASR / 声纹）模型，加载完成才开始监听。
连接后收到 `ready` 消息即代表服务可处理音频。

---

## 2. 整体流程（握手时序）

```
客户端                              服务端
  |                                  |
  |---- WebSocket 连接建立 ----------->|
  | <------ ready（JSON 文本帧）-------|  服务端先发就绪信息
  |---- {"type":"mode",...} --------->|  可选：切换模式（默认 conversation）
  | <------ ack（确认）---------------|
  |---- 二进制 PCM 音频流（持续）----->|
  | <------ utterance / result -------|  按当前模式持续返回识别结果
  |---- {"type":"reset"} ------------>|  可选：重置当前会话
  |---- {"type":"config",...} ------->|  可选：调整滑窗参数
  |---- 断开连接 --------------------->|
```

- 连接建立后，**服务端第一条消息一定是 `ready`**。前端应在收到 `ready` 后再开始推音频。
- 每个 WebSocket 连接拥有**独立的会话状态**（VAD 缓存、说话人聚类、音频缓冲互不干扰）。
- 断线后服务端释放该连接全部状态；重连即为全新会话（见第 7 节）。

---

## 3. 客户端 → 服务端：上行数据格式

WebSocket 连接内使用两种帧：**二进制帧**推音频，**文本帧**发命令。

### 3.1 音频流（二进制帧）

| 项目 | 要求 |
|---|---|
| 帧内容 | PCM 原始采样，**Int16 小端序**（`signed 16-bit little-endian`） |
| 采样率 | **16000 Hz（16 kHz）** |
| 声道 | 单声道（mono） |
| 数值范围 | `-32768 ~ 32767` |
| 分块大小 | 任意，建议 `3200 ~ 8192` 字节（200ms ~ 512ms），前端每 `~50-100ms` 推一块即可 |

典型转换（浏览器 AudioContext → Int16 PCM）：

```js
// Float32 (-1 ~ 1) → Int16 PCM
const pcm = new Int16Array(float32.length);
for (let i = 0; i < float32.length; i++) {
  pcm[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32767)));
}
ws.send(pcm.buffer);   // ArrayBuffer，二进制帧
```

> 若浏览器采集采样率不是 16 kHz（如 44.1 kHz / 48 kHz），**必须前端重采样到 16 kHz** 再发送，否则识别结果不准确。

### 3.2 命令（文本帧，JSON）

所有命令均为 `{ "type": "...", ... }` 结构。

#### 切换模式 — `mode`

```json
{ "type": "mode", "mode": "conversation" }
```

- `mode`：`"conversation"`（对话时间线，默认）或 `"sliding"`（滑动实时识别）。
- 服务端响应 `ack` 确认，`ack.mode` 为实际生效的模式。
"conversation"————是我们在对话完成之后给家长展示的，每个说话人对应一个情绪时间线。
"sliding"————是在对话过程中，对情绪的实时检测，预警打断



#### 调整滑窗参数 — `config`（仅 sliding 模式生效）

```json
{ "type": "config", "window_s": 3.0, "hop_s": 1.0, "smoothing": 0.5, "threshold": 0.3 }
```

| 字段 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `window_s` | number | `2.0` | 滑窗时长（秒），用于一次推理的音频窗口 |
| `hop_s` | number | `0.5` | 滑动步长（秒），每隔多少音频触发一次推理 |
| `smoothing` | number | `0.7` | 概率平滑系数（0~1），越大越平滑 / 越迟钝 |
| `threshold` | number | `0.0` | 置信度阈值，低于阈值时 `emotion_shown` 为 `null` |

- 所有字段均可省略，省略项保持当前值。
- 服务端响应 `ack`，`ack.params` 返回生效后的完整参数快照。
- 参数变更会重置 hop 节奏（`pending` 归零），下次推理将重新累积。

#### 重置会话 — `reset`

```json
{ "type": "reset" }
```

- 清空当前连接的音频缓冲、平滑状态、说话人聚类与 VAD 缓存。
- conversation 模式还会重建会话处理器（`start_ms` 时间基准从重置后重新累计）。
- 服务端响应 `ack`，`ack.params` 返回参数快照。

---

## 4. 服务端 → 客户端：下行数据格式

服务端所有下行消息均为**文本帧（JSON 字符串）**。共 4 种消息类型，按 `type` 字段区分。

### 4.1 `ready` — 连接就绪

连接建立后服务端主动发送，仅一次。

```json
{
  "type": "ready",
  "emotions": ["Neutral", "Happy", "Sad", "Angry", "Fearful", "Disgusted", "Surprised"],
  "device": "cuda:0",
  "mode": "conversation",
  "params": { "window_s": 2.0, "hop_s": 0.5, "smoothing": 0.7, "threshold": 0.0 }
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | string | 固定 `"ready"` |
| `emotions` | string[7] | 7 类情绪标签（顺序与 `probs` 数组一一对应） |
| `device` | string | 推理设备（`cuda:0` / `cpu`），仅展示用 |
| `mode` | string | 当前模式（默认 `"conversation"`） |
| `params` | object | 滑窗参数快照（字段见 3.2 `config`） |

### 4.2 `ack` — 命令确认

对 `mode` / `config` / `reset` 三类命令的响应。

```json
{ "type": "ack", "mode": "sliding" }
```

```json
{ "type": "ack", "params": { "window_s": 3.0, "hop_s": 1.0, "smoothing": 0.5, "threshold": 0.3 } }
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | string | 固定 `"ack"` |
| `mode` | string | （切换模式时返回）实际生效的模式 |
| `params` | object | （配置 / 重置时返回）生效后的参数快照 |

> 同一帧可能同时带 `mode` 与 `params` 吗？——不会，当前实现按命令类型分别返回；前端以 `msg.mode !== undefined` 判断即可。

### 4.3 `utterance` — 一句话识别结果（conversation 模式）

conversation 模式下，服务端通过流式 VAD 切段，**每说完一句话**返回一条 `utterance`。

```json
{
  "type": "utterance",
  "spk": 0,
  "spk_sim": 0.862,
  "start_ms": 1230,
  "end_ms": 3480,
  "text": "今天天气不错。",
  "emotion": "Happy",
  "emotion_conf": 0.8132,
  "probs": [0.1, 0.7, 0.05, 0.05, 0.03, 0.03, 0.04],
  "vad": [0.62, 0.51, 0.48]
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | string | 固定 `"utterance"` |
| `spk` | int | 说话人 id，按首次出现顺序从 `0` 开始编号（在线聚类，最多 2 人） |
| `spk_sim` | number | 该句与该说话人原型的余弦相似度（0~1），越小越可能是新说话人 |
| `start_ms` | int | 该句起始时间（毫秒，会话绝对时间，见下注） |
| `end_ms` | int | 该句结束时间（毫秒） |
| `text` | string | ASR 转写文本（中文），为空串时不会下发 |
| `emotion` | string \| null | 情绪标签（7 类之一）；段过短（<300ms）或推理失败时为 `null` |
| `emotion_conf` | number | 情绪置信度（0~1），`emotion` 为 `null` 时为 `0` |
| `probs` | number[7] | 7 类情绪概率分布，顺序对应 `ready.emotions`，和为 1 |
| `vad` | number[3] | 维度情绪 `[Valence 效价, Arousal 唤醒, Dominance 支配]`，均 0~1 |

> **时间基准**：`start_ms` / `end_ms` 是「开始识别后」的会话绝对毫秒，从该连接（或上次 `reset`）后第一帧音频到达开始累计。前端可用它做时间线定位，但**重连后重新从 0 开始**。

### 4.4 `result` — 实时情绪（sliding 模式）

sliding 模式下，服务端按 `hop_s` 滑动窗口持续推理，**每个 hop 返回一条** `result`（不包含文本）。

```json
{
  "type": "result",
  "emotion": "Angry",
  "top_idx": 3,
  "emotion_shown": "Angry",
  "conf": 0.642,
  "probs": [0.2, 0.1, 0.02, 0.64, 0.02, 0.01, 0.01],
  "vad": [0.31, 0.72, 0.55],
  "window_s": 2.0,
  "infer_ms": 41.2,
  "uptime_s": 12.5
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | string | 固定 `"result"` |
| `emotion` | string | 当前窗口概率最高的情绪标签 |
| `top_idx` | int | 最高概率对应的下标（0~6，对应 `probs` 顺序） |
| `emotion_shown` | string \| null | 展示用情绪；`conf < threshold` 时为 `null`（表示"置信不足"） |
| `conf` | number | 最高概率置信度（0~1） |
| `probs` | number[7] | 7 类情绪概率（已按 `smoothing` 平滑） |
| `vad` | number[3] | 维度情绪 `[Valence, Arousal, Dominance]` |
| `window_s` | number | 本次推理实际使用的窗口时长（秒） |
| `infer_ms` | number | 单次推理耗时（毫秒） |
| `uptime_s` | number | 该连接已运行时长（秒） |

> 第一次 `result` 需缓冲满一个窗口（默认 2s）后才会出现；之后按 `hop_s`（默认 0.5s）间隔连续输出。

---

## 5. 功能清单

`/ws` 端点支持以下能力：

1. **实时音频流情绪识别**：客户端持续推 16 kHz PCM，服务端流式返回情绪结果。
2. **两种识别模式**：
   - `conversation`（默认）：流式 VAD 切句 → ASR 中文转写 + 说话人分离（在线聚类，最多 2 人）+ 逐句情绪，**每句话**输出一条带文本的 `utterance`。
   - `sliding`：固定窗口滑动推理，**周期性**输出无文本的实时情绪 `result`。
3. **动态参数配置**：运行中可调整滑窗时长、步长、平滑系数、置信度阈值。
4. **会话重置**：随时清空当前连接状态，开始新的会话。
5. **多连接隔离**：每个 WebSocket 连接状态独立，可同时接入多个前端。

---

## 6. 前端最小实现参考

```js
const WS_URL = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";

const ws = new WebSocket(WS_URL);
ws.binaryType = "arraybuffer";        // 音频以二进制接收（本接口上行音频，这里主要为统一设置）

ws.onopen = () => { /* 可发送 mode 命令 */ };

ws.onmessage = (ev) => {
  if (typeof ev.data !== "string") return;   // 忽略二进制下行（服务端不下发二进制）
  const msg = JSON.parse(ev.data);
  switch (msg.type) {
    case "ready":
      console.log("服务就绪", msg.emotions, msg.params);
      break;
    case "ack":
      console.log("确认", msg);
      break;
    case "utterance":
      renderUtterance(msg);   // conversation 模式：一句话
      break;
    case "result":
      renderEmotion(msg);     // sliding 模式：实时情绪
      break;
  }
};

ws.onclose = () => console.warn("连接断开");
```

**推音频示例**（`sendPcm(Float32Array)` 需先将 Float32 转 Int16，见 3.1）：

```js
ws.send(int16PcmBuffer);   // 每块 3200~8192 字节，持续推流
```

---

## 7. 重连注意事项（重要）

服务端 WebSocket 连接的**状态生命周期 = 连接生命周期**。断开即销毁，因此前端重连需遵循以下规则：

1. **断线后一切状态归零**：音频缓冲、VAD 缓存、说话人聚类、`start_ms` 时间基准全部清空。
2. **重连 = 新会话**：重连后 `utterance` 的 `start_ms` / `end_ms` 从新会话重新累计（从 0 开始）。
3. **重连流程必须等待 `ready`**：收到 `ready` 前不要推音频、不要发 `mode`/`config`/`reset`，否则可能因状态未就绪丢失。
4. **模式需重新设置**：服务端默认始终是 `conversation` 模式。若前端需要 `sliding`，每次重连后都要重新发送一次 `mode` 命令并等待 `ack`。
5. **建议的断线重试策略**：指数退避（如 1s → 2s → 4s → …，上限 30s），并在 `onclose`/`onerror` 后自动重连。
6. **前端音频也要重开**：重连成功后需重新 `getUserMedia` 并重采样到 16 kHz 再推流；`reset` 命令可在推音频前调用一次，确保状态干净。

---

## 8. 测试

仓库内置模拟浏览器客户端测试脚本，可验证接口行为：

```bash
cd app/ser_streaming
python test_ws_client.py
```

覆盖用例：默认滑窗参数、运行中改参数、conversation 模式双说话人转写。
