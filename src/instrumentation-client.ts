import { initBotId } from "botid/client/core";

initBotId({
  protect: [
    { path: "/api/chat", method: "POST" },
    { path: "/api/summarize", method: "POST" },
    { path: "/api/explore", method: "POST" },
    { path: "/api/generate-lesson", method: "POST" },
  ],
});
