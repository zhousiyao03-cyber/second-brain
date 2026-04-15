const decoder = new TextDecoder();

export function parseDaemonNotificationSseChunk(buffer, chunk) {
  const nextBuffer = `${buffer}${decoder.decode(chunk, { stream: true })}`;
  const frames = nextBuffer.split("\n\n");
  const remainder = frames.pop() ?? "";
  const events = [];

  for (const frame of frames) {
    const lines = frame
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0 && !line.startsWith(":"));

    const eventName = lines
      .filter((line) => line.startsWith("event:"))
      .map((line) => line.slice("event:".length).trim())
      .at(-1);

    const dataLines = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim());

    if (!eventName || dataLines.length === 0) continue;

    try {
      events.push({
        event: eventName,
        data: JSON.parse(dataLines.join("\n")),
      });
    } catch {
      // ignore malformed frames and continue parsing later events
    }
  }

  return { buffer: remainder, events };
}

export async function consumeDaemonNotificationStream(response, onEvent) {
  if (!response.body) {
    throw new Error("SSE response body missing");
  }

  const reader = response.body.getReader();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      return;
    }

    const parsed = parseDaemonNotificationSseChunk(buffer, value);
    buffer = parsed.buffer;
    for (const event of parsed.events) {
      onEvent(event);
    }
  }
}

const daemonNotificationsModule = {
  consumeDaemonNotificationStream,
  parseDaemonNotificationSseChunk,
};

export default daemonNotificationsModule;
