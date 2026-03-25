const express = require("express");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const wss = new WebSocket.Server({ server });

let lastPayload = null;

// Send data to all connected overlays
function broadcast(data) {
  const message = JSON.stringify(data);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Only send if something changed
function broadcastIfChanged(data) {
  const next = JSON.stringify(data);
  const prev = lastPayload ? JSON.stringify(lastPayload) : null;

  if (next !== prev) {
    lastPayload = data;
    console.log("LIVE UPDATE:", data);
    broadcast(data);
  }
}

// ESPN draft endpoint
const DRAFT_URL = "https://site.api.espn.com/apis/v2/sports/football/nfl/draft";

// Poll the draft feed
async function checkDraft() {
  try {
    const res = await fetch(DRAFT_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    const data = await res.json();
    const pick = data?.draft?.rounds?.[0]?.picks?.[0];

    if (!pick) {
      return;
    }

    const team = pick?.team?.displayName || "Denver Broncos";
    const rawStatus = pick?.status?.type?.name || "";

    const status = rawStatus.toLowerCase().includes("on")
      ? "onClock"
      : "picked";

    broadcastIfChanged({
      team,
      status
    });
  } catch (err) {
    console.error("Draft fetch error:", err.message);
  }
}

// Send current state when a client connects
wss.on("connection", (ws) => {
  if (lastPayload) {
    ws.send(JSON.stringify(lastPayload));
  } else {
    ws.send(
      JSON.stringify({
        team: "Denver Broncos",
        status: "onClock"
      })
    );
  }
});

// Start polling
checkDraft();
setInterval(checkDraft, 5000);

// Serve static files from /public
app.use(express.static("public"));